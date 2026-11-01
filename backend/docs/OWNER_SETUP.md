# Becoming the platform owner

`superadmin` is the only role that sees every event on the installation and can
reach `/api/customers` and `/api/orders`. Nobody holds it until it is granted,
and the API refuses to grant it over HTTP unless the caller already has it — so
the first one has to come from outside the application.

Three ways, in order of how little they need from you.

---

## A. An environment variable (no shell, no SQL)

For hosting without shell access — a free Render instance, for example.

1. In the hosting dashboard, add an environment variable:

   ```
   BOOTSTRAP_SUPERADMIN_EMAIL=you@example.com
   ```

   It must be the address of an account that **already exists**. This promotes
   an account; it does not create one.

2. Restart or redeploy the service.

3. Read the logs. One of three lines will be there:

   ```
   [owner] you@example.com: admin → superadmin. Remove BOOTSTRAP_SUPERADMIN_EMAIL now.
   [owner] someone@else.com is already the platform owner; BOOTSTRAP_SUPERADMIN_EMAIL ignored.
   [owner] BOOTSTRAP_SUPERADMIN_EMAIL is you@example.com, but no account has that address.
   ```

4. Remove the variable.

**Why leaving it set is not a hole, and why to remove it anyway.** It does
nothing once a superadmin exists — the window closes the first time it acts, so
it cannot promote a second account later. It never creates users, never touches
passwords, and never demotes anyone. Remove it regardless: a setting that does
nothing is a setting somebody will eventually misread as one that does.

The role takes effect immediately. `authMw` reads the row from the database on
every request, so there is no need to sign out. The browser keeps a stale
`hh_role` cookie until the next sign-in, but that only decides which menu items
are drawn, not what the API will answer.

---

## B. The database console (no shell, one statement)

Neon, Supabase and most managed Postgres providers have a SQL editor in the
browser. One statement:

```sql
UPDATE users SET role = 'superadmin' WHERE LOWER(email) = 'you@example.com';
```

Check it landed on exactly one row:

```sql
SELECT id, email, role FROM users WHERE role = 'superadmin';
```

This needs migration `0006` to have been applied first — before it, the
`users_role_allowed` constraint rejects `superadmin` and the UPDATE fails with a
check-constraint error rather than doing something surprising.

---

## C. The script (needs a shell)

```bash
node scripts/grant-superadmin.js you@example.com
node scripts/grant-superadmin.js you@example.com --revoke
```

It applies migrations first, so it works against a database that has not yet
booted the new server.

---

## Removing the role

There is no environment variable for demotion, deliberately — an accident in a
dashboard should not be able to strip platform ownership. Use the script, the
database console, or `PATCH /api/users/:id/role` signed in as a superadmin,
which is the only role permitted to change platform-owner access.
