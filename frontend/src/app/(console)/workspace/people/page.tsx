"use client";

/**
 * People — every account on the platform.
 *
 * One request per page (`/api/owner/users`), searched by name, e-mail or #id,
 * filtered by platform role and e-mail confirmation, and sorted on the server.
 * The list used to load the first 500 accounts and stop there.
 */

import Link from "next/link";
import { Badge, ErrorState } from "@/components/ds/primitives";
import { DataTable, type Column } from "@/components/ds/DataTable";
import { PageHead } from "../_shell";
import { PLATFORM_ROLES, ROLE_LABEL, day, type UserListRow } from "@/lib/superadmin/directory";
import { useServerTable } from "@/lib/superadmin/useServerTable";
import { RoleBadge, hrefFor, num } from "../_ui";

export default function PeoplePage() {
  const t = useServerTable<UserListRow>({
    path: "/api/owner/users",
    defaultSort: { id: "created", dir: "desc" },
    facetKeys: ["role", "verified"],
    syncUrl: true,
  });

  const columns: Column<UserListRow>[] = [
    {
      id: "name",
      header: "Name",
      sortable: true,
      value: (r) => r.full_name,
      cell: (r) => (
        <div className="min-w-0">
          <Link prefetch={false} href={hrefFor.person(r.id)} className="block truncate font-medium hover:underline" style={{ color: "var(--ink)" }}>
            {r.full_name || "—"}
          </Link>
          <p className="truncate text-xs" style={{ color: "var(--ink-3)" }}>{r.email}</p>
        </div>
      ),
    },
    {
      id: "role",
      header: "Platform role",
      sortable: true,
      value: (r) => r.role,
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <RoleBadge role={r.role} />
          {!r.email_verified ? <Badge tone="warn">Unconfirmed</Badge> : null}
        </span>
      ),
      width: "200px",
    },
    {
      id: "events",
      header: "Events",
      sortable: true,
      value: (r) => r.participations + r.staff_roles,
      cell: (r) => (
        <span title={`${r.participations} as participant, ${r.staff_roles} as judge, mentor or volunteer`}>
          {num(r.participations + r.staff_roles)}
          {r.staff_roles ? <span className="ml-1 text-xs" style={{ color: "var(--ink-3)" }}>({r.staff_roles} staff)</span> : null}
        </span>
      ),
      align: "right",
      width: "120px",
    },
    { id: "organisations", header: "Organisations", sortable: true, value: (r) => r.organisations, cell: (r) => num(r.organisations), align: "right", width: "120px" },
    { id: "created", header: "Joined", sortable: true, value: (r) => r.created_at, cell: (r) => <span className="text-xs">{day(r.created_at)}</span>, align: "right", width: "120px" },
    { id: "email", header: "E-mail", sortable: true, value: (r) => r.email, optional: true },
  ];

  return (
    <>
      <PageHead
        title="People"
        sub={t.data ? `${t.data.total.toLocaleString("en-US")} account${t.data.total === 1 ? "" : "s"}${t.state.q || Object.values(t.state.facets).some((v) => v.length) ? " match" : " on the platform"}.` : "Every account on the platform."}
      />
      {t.error && !t.data ? (
        <ErrorState title="Could not load the accounts" body={t.error} onRetry={t.reload} />
      ) : (
        <DataTable
          rows={t.rows}
          columns={columns}
          loading={t.loading}
          pageSize={t.pageSize}
          server={t.server}
          getHref={(r) => hrefFor.person(r.id)}
          searchPlaceholder="Search name, e-mail or #id…"
          emptyTitle="No accounts"
          facets={[
            { id: "role", label: "Platform role", options: PLATFORM_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] ?? r })), match: () => true },
            {
              id: "verified",
              label: "E-mail",
              options: [
                { value: "true", label: "Confirmed" },
                { value: "false", label: "Not confirmed" },
              ],
              match: () => true,
            },
          ]}
        />
      )}
    </>
  );
}
