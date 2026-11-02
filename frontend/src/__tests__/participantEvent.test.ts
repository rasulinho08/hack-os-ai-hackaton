/**
 * The event a participant's pages work in: their own registration, or none.
 * A participant registered nowhere was sent to the lobby's guess (any live
 * event, in the end event 1), so their chat and home opened someone else's.
 * The event they entered comes first; without one, an event they were
 * admitted to, the way the API picks (approved in one hackathon and pending
 * in another no longer opens the pending one).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { myEventsAs, enteredEventId, resolveLobbyInviteEventId } = vi.hoisted(() => ({
  myEventsAs: vi.fn(),
  enteredEventId: vi.fn(),
  resolveLobbyInviteEventId: vi.fn(),
}));
vi.mock("@/lib/workspaces", () => ({ myEventsAs, enteredEventId }));
vi.mock("@/lib/resolveEventId", () => ({ resolveLobbyInviteEventId, resolveMentorEventIds: vi.fn() }));

import { participantEventId } from "@/lib/participantEvent";

describe("participantEventId", () => {
  beforeEach(() => {
    myEventsAs.mockReset();
    enteredEventId.mockReset().mockReturnValue(null);
    resolveLobbyInviteEventId.mockReset().mockResolvedValue(1);
  });

  it("is the event they entered, admitted or not", async () => {
    myEventsAs.mockResolvedValue([{ id: 7, participant_status: "pending" }, { id: 42, participant_status: "approved" }]);
    enteredEventId.mockReturnValue(7);
    expect(await participantEventId()).toBe(7);
  });

  it("without a choice, prefers an event they were admitted to", async () => {
    myEventsAs.mockResolvedValue([{ id: 7, participant_status: "pending" }, { id: 42, participant_status: "approved" }]);
    expect(await participantEventId()).toBe(42);
    myEventsAs.mockResolvedValue([{ id: 7, participant_status: "pending" }, { id: 8, participant_status: "waitlisted" }]);
    expect(await participantEventId()).toBe(7);
  });

  it("is the participant's own event", async () => {
    myEventsAs.mockResolvedValue([{ id: 42 }, { id: 7 }]);
    expect(await participantEventId()).toBe(42);
    expect(resolveLobbyInviteEventId).not.toHaveBeenCalled();
  });

  it("is none when they are registered nowhere, never another event", async () => {
    myEventsAs.mockResolvedValue([]);
    expect(await participantEventId()).toBeNull();
    expect(resolveLobbyInviteEventId).not.toHaveBeenCalled();
  });

  it("asks the lobby only when the workspace lookup itself fails (an older API)", async () => {
    myEventsAs.mockRejectedValue(new Error("404"));
    expect(await participantEventId()).toBe(1);
    resolveLobbyInviteEventId.mockRejectedValue(new Error("offline"));
    expect(await participantEventId()).toBeNull();
  });
});
