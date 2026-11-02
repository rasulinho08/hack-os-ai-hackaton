/**
 * The walkthrough's sample-data reader answers only on /demo.
 *
 * Regression for the production bug where prefetching the header's "Live
 * demo" link armed the reader on every marketing page, so sign-in, sign-up,
 * checkout and the contact form were refused without reaching the backend.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { DemoReadOnlyError, apiGet, apiPost, disableDemoApi, enableDemoApi, isDemoApiEnabled } from "@/lib/api";

function at(pathname: string) {
  vi.stubGlobal("window", { location: { pathname }, dispatchEvent: () => true });
}

function backendAnswers(data: unknown) {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ success: true, data }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  disableDemoApi();
  vi.unstubAllGlobals();
});

describe("demo reader", () => {
  it("does not touch requests made outside /demo, even when armed", async () => {
    enableDemoApi(() => ({ sample: true }));
    at("/signin");
    const fetchMock = backendAnswers({ id: 1, role: "hacker" });
    await expect(apiPost("/api/auth/login", { email: "a@b.c", password: "x" })).resolves.toMatchObject({ id: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(isDemoApiEnabled()).toBe(false);
  });

  it("answers reads and refuses writes on /demo", async () => {
    enableDemoApi(() => ({ sample: true }));
    at("/demo/participants");
    const fetchMock = backendAnswers({ real: true });
    await expect(apiGet("/api/events")).resolves.toEqual({ sample: true });
    await expect(apiPost("/api/teams", {})).rejects.toBeInstanceOf(DemoReadOnlyError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(isDemoApiEnabled()).toBe(true);
  });

  it("does not treat a path that merely starts with the letters as the demo", async () => {
    enableDemoApi(() => ({ sample: true }));
    at("/demos");
    const fetchMock = backendAnswers({ real: true });
    await expect(apiGet("/api/x")).resolves.toEqual({ real: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
