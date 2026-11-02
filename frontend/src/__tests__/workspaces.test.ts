/**
 * What the workspace picker lists and lets people enter, and where the owner
 * console is reachable.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { entriesFrom, isEnterable, type Workspaces, type WorkspaceEvent } from "@/lib/workspaces";
import { isAdminHost, isConsolePath } from "@/lib/hosts";

const event = (over: Partial<WorkspaceEvent>): WorkspaceEvent => ({
  id: 1,
  name: "E",
  event_code: null,
  customer_id: null,
  start_date: null,
  end_date: null,
  status: "published",
  role: "participant",
  participant_status: "approved",
  ...over,
});

const ws = (over: Partial<Workspaces>): Workspaces => ({
  organizations: [],
  events: [],
  platformRole: null,
  elevationRequired: false,
  activeEventId: null,
  ...over,
});

describe("entriesFrom", () => {
  it("puts the owner console first, then organisations, then events", () => {
    const out = entriesFrom(
      ws({
        platformRole: "superadmin",
        organizations: [{ id: 7, name: "Org", slug: "org", status: "active", logo_url: null, role: "owner" }],
        events: [event({ id: 3, role: "judge" })],
      }),
    );
    expect(out.map((e) => e.kind)).toEqual(["console", "org", "event"]);
  });

  it("leaves out viewers and cancelled organisations", () => {
    const out = entriesFrom(
      ws({
        organizations: [
          { id: 1, name: "A", slug: null, status: "active", logo_url: null, role: "viewer" },
          { id: 2, name: "B", slug: null, status: "cancelled", logo_url: null, role: "admin" },
        ],
      }),
    );
    expect(out).toEqual([]);
  });

  it("does not list an organiser's event twice when its organisation is listed", () => {
    const out = entriesFrom(
      ws({
        organizations: [{ id: 5, name: "Org", slug: null, status: "active", logo_url: null, role: "admin" }],
        events: [event({ id: 9, role: "organizer", customer_id: 5 }), event({ id: 10, role: "organizer", customer_id: 6 })],
      }),
    );
    expect(out.filter((e) => e.kind === "event").map((e) => (e.kind === "event" ? e.event.id : 0))).toEqual([10]);
  });
});

describe("isEnterable", () => {
  it.each([
    ["approved", true],
    ["eliminated", true],
    ["pending", false],
    ["rejected", false],
    ["waitlisted", false],
  ])("a participant who is %s may enter: %s", (status, ok) => {
    expect(isEnterable({ kind: "event", event: event({ participant_status: status }) })).toBe(ok);
  });

  it("staff roles and organisations are always enterable", () => {
    expect(isEnterable({ kind: "event", event: event({ role: "judge", participant_status: null }) })).toBe(true);
    expect(isEnterable({ kind: "console" })).toBe(true);
  });
});

describe("owner console host", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("treats /workspace and /admin-login as console paths, nothing else", () => {
    expect(isConsolePath("/workspace")).toBe(true);
    expect(isConsolePath("/workspace/orders")).toBe(true);
    expect(isConsolePath("/admin-login")).toBe(true);
    expect(isConsolePath("/workspaces")).toBe(false);
    expect(isConsolePath("/workspacex")).toBe(false);
  });

  it("matches the configured admin host, ignoring case and port", () => {
    vi.stubEnv("NEXT_PUBLIC_ADMIN_HOST", "admin.hack-os.app");
    expect(isAdminHost("ADMIN.hack-os.app")).toBe(true);
    expect(isAdminHost("admin.hack-os.app:443")).toBe(true);
    expect(isAdminHost("app.hack-os.app")).toBe(false);
    expect(isAdminHost(null)).toBe(false);
  });

  it("is off when no admin host is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_ADMIN_HOST", "");
    expect(isAdminHost("admin.hack-os.app")).toBe(false);
  });
});
