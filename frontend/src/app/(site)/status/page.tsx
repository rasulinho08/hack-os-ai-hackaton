import { StatusView } from "./StatusView";
import { getBackendOrigin } from "@/lib/backendOrigin";
import { normalizeStatus, unreachable, type PlatformStatus } from "@/lib/platformStatus";

/*
 * The status, read on the server so the page says it at once (also without
 * JavaScript); the browser asks again every minute. The API keeps its answer
 * 30 seconds, so a busy status page costs it little. When it does not answer
 * within a few seconds, the page says so instead of waiting.
 */
async function initialStatus(): Promise<PlatformStatus> {
  try {
    const res = await fetch(`${getBackendOrigin()}/api/public/status`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    const json = (await res.json().catch(() => null)) as { data?: unknown } | null;
    return normalizeStatus(json?.data);
  } catch {
    return unreachable();
  }
}

export default async function StatusPage() {
  return <StatusView initial={await initialStatus()} />;
}
