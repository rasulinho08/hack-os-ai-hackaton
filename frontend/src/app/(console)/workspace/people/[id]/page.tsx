"use client";

/**
 * One account: who it is, where it belongs, what it took part in, what it
 * bought, what it did and what was done to it.
 *
 * Read in one request (`/api/owner/users/:id`). No password hash, session
 * version or token is part of that answer, so none can reach this page.
 *
 * Three actions, each recorded in the audit trail:
 *   - e-mail a new confirmation link (the link itself is never shown here),
 *   - sign the account out on every device (its session version goes up),
 *   - change the platform role, through the existing guarded endpoint.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { LogOut, MailCheck, ShieldCheck } from "lucide-react";
import { Badge, Button, ErrorState, Stat } from "@/components/ds/primitives";
import { KeyValues, Panel } from "@/components/ds/board";
import { Confirm } from "@/components/ds/overlays";
import { PageHead } from "../../_shell";
import { PLAN_LABEL } from "@/lib/commerce";
import {
  PLATFORM_ROLES,
  ROLE_LABEL,
  changePlatformRole,
  day,
  loadUserDetail,
  resendVerification,
  signOutEverywhere,
  when,
  type UserDetail,
} from "@/lib/superadmin/directory";
import {
  AuditList,
  BackLink,
  CustomerStatusBadge,
  DetailSkeleton,
  EventLink,
  MiniTable,
  OrderLink,
  OrderStatusBadge,
  OrgLink,
  PhaseBadge,
  RoleBadge,
  money,
  num,
} from "../../_ui";

const EVENT_ROLE: Record<string, [string, "neutral" | "info" | "ok" | "warn" | "brand"]> = {
  participant: ["Participant", "neutral"],
  judge: ["Judge", "info"],
  mentor: ["Mentor", "ok"],
  volunteer: ["Volunteer", "warn"],
  creator: ["Created it", "brand"],
};

const STATUS_TONE: Record<string, "ok" | "warn" | "danger" | "neutral" | "info"> = {
  approved: "ok",
  pending: "warn",
  waitlisted: "info",
  rejected: "danger",
  withdrawn: "neutral",
};

export default function PersonPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params?.id);
  const [data, setData] = useState<UserDetail | null>(null);
  const [error, setError] = useState<{ status?: number; message: string } | null>(null);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!Number.isInteger(id) || id <= 0) return;
    let cancelled = false;
    loadUserDetail(id)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError({ status: (e as { status?: number })?.status, message: e instanceof Error ? e.message : "Could not load" });
      });
    return () => {
      cancelled = true;
    };
  }, [id, nonce]);

  if (!Number.isInteger(id) || id <= 0 || error?.status === 404) {
    return (
      <>
        <BackLink href="/workspace/people">People</BackLink>
        <PageHead title="Account not found" sub="There is no account with this number." />
      </>
    );
  }
  if (error && !data) {
    return (
      <>
        <BackLink href="/workspace/people">People</BackLink>
        <ErrorState title="Could not load this account" body={error.message} onRetry={reload} />
      </>
    );
  }
  if (!data) return <DetailSkeleton />;
  return <Person data={data} reload={reload} />;
}

function Person({ data, reload }: { data: UserDetail; reload: () => void }) {
  const u = data.user;
  const [allRoles, setAllRoles] = useState(false);
  const participations = data.roles.filter((r) => r.role === "participant");
  const staff = data.roles.filter((r) => ["judge", "mentor", "volunteer"].includes(r.role));
  const roles = allRoles ? data.roles : data.roles.slice(0, 12);
  const spent = useMemo(() => {
    const paid = data.orders.filter((o) => o.paid_at);
    return { minor: paid.reduce((n, o) => n + (o.amount_minor ?? 0), 0), currency: paid[0]?.currency ?? "AZN" };
  }, [data.orders]);

  return (
    <>
      <BackLink href="/workspace/people">People</BackLink>
      <PageHead title={u.full_name || u.email} sub={`${u.email} · #${u.id} · joined ${day(u.created_at)}`} />
      <div className="-mt-3 mb-5 flex flex-wrap items-center gap-2">
        <RoleBadge role={u.role} />
        {u.email_verified ? <Badge tone="ok">E-mail confirmed</Badge> : <Badge tone="warn">E-mail not confirmed</Badge>}
        {data.memberships.length ? <Badge tone="info">Member of {data.memberships.length} organisation{data.memberships.length === 1 ? "" : "s"}</Badge> : null}
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Registrations" value={num(participations.length)} hint={`${participations.filter((p) => String(p.status).toLowerCase() === "approved").length} approved`} />
        <Stat label="Staff roles" value={num(staff.length)} hint="Judge, mentor or volunteer" />
        <Stat label="Teams" value={num(data.teams.length)} hint={`${data.teams.filter((t) => t.is_leader).length} as leader`} />
        <Stat label="Orders placed" value={num(data.orders.length)} hint={spent.minor ? `${money(spent.minor, spent.currency)} paid` : "Nothing paid"} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="Account">
            <KeyValues
              rows={[
                { label: "E-mail", value: <a href={`mailto:${u.email}`} className="hover:underline">{u.email}</a> },
                { label: "E-mail confirmed", value: u.email_verified_at ? when(u.email_verified_at) : "Not yet" },
                { label: "Account created", value: when(u.created_at) },
                { label: "Last changed", value: when(u.updated_at) },
                { label: "Last sign-in", value: data.lastSignInAt ? when(data.lastSignInAt) : <span style={{ color: "var(--ink-3)" }}>Not recorded on this installation</span> },
                { label: "Platform role", value: ROLE_LABEL[u.role] ?? u.role },
                { label: "Country", value: u.country || "—" },
                { label: "University", value: u.university || "—" },
                { label: "GitHub", value: u.github_link ? <a href={u.github_link} target="_blank" rel="noreferrer noopener" className="hover:underline">{u.github_link.replace(/^https?:\/\/(www\.)?/, "")}</a> : "—" },
                { label: "LinkedIn", value: u.linkedin ? <a href={u.linkedin} target="_blank" rel="noreferrer noopener" className="hover:underline">{u.linkedin.replace(/^https?:\/\/(www\.)?/, "")}</a> : "—" },
              ]}
            />
          </Panel>

          <AccountActions data={data} onChanged={reload} />

          <Panel title={`Organisations · ${data.memberships.length}`}>
            <MiniTable
              rows={data.memberships}
              rowKey={(m) => m.id}
              empty="Not a member of any organisation."
              columns={[
                {
                  header: "Organisation",
                  cell: (m) => (
                    <div className="min-w-0">
                      <OrgLink id={m.customer_id} name={m.customer_name} />
                      {m.is_primary ? <span className="ml-1.5"><Badge tone="info">Primary</Badge></span> : null}
                      <p className="text-xs" style={{ color: "var(--ink-3)" }}>{m.role_title || "—"} · since {day(m.created_at)}</p>
                    </div>
                  ),
                },
                { header: "Role here", cell: (m) => <span className="text-xs">{m.member_role}</span>, width: "90px" },
                { header: "State", cell: (m) => <CustomerStatusBadge status={m.archived_at ? "archived" : m.customer_status} />, width: "140px" },
              ]}
            />
            {data.invites.length ? (
              <div className="mt-3">
                <p className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.09em]" style={{ color: "var(--ink-3)" }}>Invited, not accepted</p>
                <ul className="flex flex-col gap-1 text-sm">
                  {data.invites.map((i) => (
                    <li key={i.id} className="flex flex-wrap justify-between gap-2">
                      <OrgLink id={i.customer_id} name={i.customer_name} />
                      <span className="text-xs" style={{ color: "var(--ink-3)" }}>{i.grant_role} · until {day(i.expires_at)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Panel>

          <Panel title={`Orders placed · ${data.orders.length}`}>
            <MiniTable
              rows={data.orders}
              rowKey={(o) => o.id}
              empty="This account has not placed an order."
              columns={[
                {
                  header: "Order",
                  cell: (o) => (
                    <div className="min-w-0">
                      <OrderLink id={o.id} code={o.order_code} />
                      <p className="truncate text-xs" style={{ color: "var(--ink-3)" }}>
                        <OrgLink id={o.customer_id} name={o.customer_name} muted /> · {PLAN_LABEL[o.plan] ?? o.plan}
                      </p>
                    </div>
                  ),
                },
                { header: "Status", cell: (o) => <OrderStatusBadge status={o.status} />, width: "150px" },
                { header: "Amount", cell: (o) => <span style={{ color: "var(--ink)" }}>{money(o.amount_minor, o.currency)}</span>, align: "right", width: "110px" },
                { header: "Placed", wide: true, cell: (o) => <span className="whitespace-nowrap text-xs">{day(o.placed_at || o.created_at)}</span>, width: "110px" },
              ]}
            />
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Panel
            title={`Events and roles · ${data.roles.length}`}
            action={
              data.roles.length > 12 ? (
                <Button size="sm" variant="ghost" onClick={() => setAllRoles((v) => !v)}>
                  {allRoles ? "Show fewer" : `Show all ${data.roles.length}`}
                </Button>
              ) : undefined
            }
          >
            <MiniTable
              rows={roles}
              rowKey={(r) => `${r.role}-${r.event_id}`}
              empty="Not part of any event."
              columns={[
                {
                  header: "Event",
                  cell: (r) => (
                    <div className="min-w-0">
                      <EventLink id={r.event_id} name={r.event_name} />
                      <p className="truncate text-xs" style={{ color: "var(--ink-3)" }}>
                        {r.customer_id ? <OrgLink id={r.customer_id} name={r.customer_name} muted /> : "No organisation"}
                        {r.team_name ? ` · team ${r.team_name}` : ""}
                      </p>
                    </div>
                  ),
                },
                {
                  header: "Role",
                  cell: (r) => {
                    const [label, tone] = EVENT_ROLE[r.role] ?? [r.role, "neutral" as const];
                    return (
                      <span className="flex flex-wrap gap-1">
                        <Badge tone={tone}>{label}</Badge>
                        {r.role === "participant" && r.status ? <Badge tone={STATUS_TONE[String(r.status).toLowerCase()] ?? "neutral"}>{r.status}</Badge> : null}
                      </span>
                    );
                  },
                  width: "200px",
                },
                { header: "Phase", wide: true, cell: (r) => <PhaseBadge phase={r.phase} />, width: "100px" },
                { header: "Since", wide: true, cell: (r) => <span className="whitespace-nowrap text-xs">{day(r.since)}</span>, width: "110px" },
              ]}
            />
          </Panel>

          <Panel title={`Teams · ${data.teams.length}`}>
            <MiniTable
              rows={data.teams}
              rowKey={(t) => t.id}
              empty="Not on a team."
              columns={[
                {
                  header: "Team",
                  cell: (t) => (
                    <div className="min-w-0">
                      <span style={{ color: "var(--ink)" }}>{t.name}</span>
                      {t.is_leader ? <span className="ml-1.5"><Badge tone="brand">Leader</Badge></span> : null}
                      <p className="truncate text-xs" style={{ color: "var(--ink-3)" }}><EventLink id={t.event_id} name={t.event_name} muted /></p>
                    </div>
                  ),
                },
                { header: "Members", cell: (t) => num(t.members), align: "right", width: "90px" },
                { header: "Projects", cell: (t) => num(t.submissions), align: "right", width: "90px" },
                { header: "State", wide: true, cell: (t) => <span className="text-xs">{t.status}</span>, width: "90px" },
              ]}
            />
          </Panel>

          <Panel title="What they did">
            <AuditList rows={data.auditBy} empty="Nothing recorded by this account." />
          </Panel>
          <Panel title="What was done to this account">
            <AuditList rows={data.auditAbout} empty="Nothing recorded about this account." />
          </Panel>
        </div>
      </div>
    </>
  );
}

/** The three things the owner can do for or to an account. */
function AccountActions({ data, onChanged }: { data: UserDetail; onChanged: () => void }) {
  const u = data.user;
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "danger" | "warn"; text: string } | null>(null);
  const [confirm, setConfirm] = useState<null | "signout" | "role">(null);
  const [role, setRole] = useState(u.role);
  useEffect(() => setRole(u.role), [u.role]);

  const run = async (key: string, work: () => Promise<string>) => {
    setBusy(key);
    setNote(null);
    try {
      setNote({ tone: "ok", text: await work() });
      onChanged();
    } catch (e) {
      setNote({ tone: "danger", text: e instanceof Error ? e.message : "That did not work" });
    } finally {
      setBusy(null);
    }
  };

  const ownerChange = role === "superadmin" || u.role === "superadmin";
  const select = "min-h-9 rounded-[var(--radius-sm)] border px-2 text-sm";

  return (
    <Panel title="Account actions">
      <ul className="flex flex-col gap-4">
        <li className="grid grid-cols-1 items-start gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <p className="text-sm font-medium" style={{ color: "var(--ink)" }}>Confirmation e-mail</p>
            <p className="text-xs leading-relaxed" style={{ color: "var(--ink-3)" }}>
              {u.email_verified
                ? `Confirmed on ${day(u.email_verified_at)}. Nothing to send.`
                : "Send a new link to their address. It works for 72 hours; the link is never shown here."}
            </p>
          </div>
          <Button
            size="sm"
            icon={<MailCheck size={14} />}
            disabled={u.email_verified || busy !== null}
            loading={busy === "verify"}
            onClick={() =>
              run("verify", async () => {
                const r = await resendVerification(u.id);
                return r.sent ? `A new confirmation link went to ${u.email}.` : r.mailConfigured ? "The link was made, but the e-mail did not go out. Try again shortly." : "The link was made, but no e-mail provider is configured on this installation.";
              })
            }
          >
            Send link
          </Button>
        </li>
        <li className="grid grid-cols-1 items-start gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <p className="text-sm font-medium" style={{ color: "var(--ink)" }}>Sign out everywhere</p>
            <p className="text-xs leading-relaxed" style={{ color: "var(--ink-3)" }}>
              Ends every session on every device at its next request. They can sign in again with their password.
            </p>
          </div>
          <Button size="sm" icon={<LogOut size={14} />} disabled={busy !== null} loading={busy === "signout"} onClick={() => setConfirm("signout")}>
            Sign out
          </Button>
        </li>
        <li className="grid grid-cols-1 items-start gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <label htmlFor={`role-${u.id}`} className="text-sm font-medium" style={{ color: "var(--ink)" }}>Platform role</label>
            <p className="text-xs leading-relaxed" style={{ color: "var(--ink-3)" }}>
              Their role across the platform. Event roles (judge in one event, mentor in another) are set inside each event.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              id={`role-${u.id}`}
              value={role}
              disabled={busy !== null}
              onChange={(e) => setRole(e.target.value)}
              className={select}
              style={{ borderColor: "var(--line-strong)", background: "var(--surface)", color: "var(--ink)" }}
            >
              {PLATFORM_ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_LABEL[r] ?? r}</option>
              ))}
            </select>
            <Button size="sm" icon={<ShieldCheck size={14} />} disabled={role === u.role || busy !== null} loading={busy === "role"} onClick={() => setConfirm("role")}>
              Change
            </Button>
          </div>
        </li>
      </ul>
      {note ? (
        <p className="mt-4 text-sm" role={note.tone === "danger" ? "alert" : "status"} style={{ color: `var(--${note.tone})` }}>{note.text}</p>
      ) : null}

      <Confirm
        open={confirm === "signout"}
        onClose={() => setConfirm(null)}
        title={`Sign ${u.full_name || u.email} out everywhere?`}
        body="Every session this account has, on every device, ends at its next request. This is recorded in the audit trail."
        confirmLabel="Sign out everywhere"
        destructive
        onConfirm={() => {
          setConfirm(null);
          void run("signout", async () => {
            await signOutEverywhere(u.id);
            return "Every session of this account has ended.";
          });
        }}
      />
      <Confirm
        open={confirm === "role"}
        onClose={() => {
          setConfirm(null);
          setRole(u.role);
        }}
        title={`Make ${u.full_name || u.email} ${ROLE_LABEL[role] ?? role}?`}
        body={
          ownerChange
            ? role === "superadmin"
              ? "This gives them the whole platform: every organisation, order, event and account, and this console. Only do this for a person who runs HackOS with you."
              : "This takes platform ownership away from them. They lose this console and every owner power at their next request."
            : `Their platform role changes from ${ROLE_LABEL[u.role] ?? u.role} to ${ROLE_LABEL[role] ?? role}. This is recorded in the audit trail.`
        }
        confirmLabel="Change role"
        destructive={ownerChange}
        onConfirm={() => {
          setConfirm(null);
          void run("role", async () => {
            await changePlatformRole(u.id, role);
            return `Platform role is now ${ROLE_LABEL[role] ?? role}.`;
          });
        }}
      />
    </Panel>
  );
}
