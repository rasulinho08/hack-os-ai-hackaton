"use client";

/**
 * The one way this application reads from the API.
 *
 * Before this existed, 160 `apiGet` calls lived inside 109 `useEffect` hooks,
 * each hand-rolling its own `data` / `loading` / `error` triple. That is why
 * error states were missing from half the screens and empty states from almost
 * all of them: every page had to remember to write four branches, and most
 * wrote one.
 *
 * The rules are the same everywhere now:
 *
 *   - a failed read is an error, never an empty list. The bug this prevents has
 *     already happened twice here — a roster that swallowed its failure, and a
 *     leaderboard that rendered a podium of zeros when scores did not load.
 *   - the same request from two components in one screen is one request.
 *   - data is reused for a short window on navigation instead of refetched.
 *
 * `apiGet` still does the talking, so the response envelope, the cache-busting
 * headers and the walkthrough's sample-data interception all continue to work
 * unchanged.
 */

import { useMemo } from "react";
import {
  useQueries,
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { apiGet, ApiError } from "@/lib/api";

/**
 * A read.
 *
 * `path` is both the request and the cache key — two components asking for
 * `/api/teams?eventId=4` share one request and one result.
 *
 * Pass `path: null` to hold off, which is what a screen does while it is still
 * working out which event it is looking at. React Query calls that `enabled`,
 * and getting it wrong means firing a request at `/api/events/null/…`.
 */
export function useApi<T>(
  path: string | null,
  options?: Omit<UseQueryOptions<T, ApiError>, "queryKey" | "queryFn">,
) {
  return useQuery<T, ApiError>({
    queryKey: [path],
    queryFn: () => apiGet<T>(path as string),
    enabled: path != null,
    ...options,
  });
}

/**
 * Several reads that belong to one screen.
 *
 * Returns a single set of flags, so a page waits for all of them and reports a
 * failure if any one fails — rather than rendering three-quarters of itself
 * around a hole, which is what independent effects produce.
 */
export function useApiAll<T extends Record<string, unknown>>(
  paths: { [K in keyof T]: string | null },
) {
  const keys = useMemo(() => Object.keys(paths) as (keyof T)[], [paths]);

  // `useQueries` rather than a loop over `useApi`: the number of reads can
  // differ between renders, and calling a hook a variable number of times is
  // the one thing React genuinely cannot survive.
  const results = useQueries({
    queries: keys.map((k) => {
      const path = paths[k];
      return {
        queryKey: [path],
        queryFn: () => apiGet<unknown>(path as string),
        enabled: path != null,
      };
    }),
  });

  const data = {} as Partial<T>;
  keys.forEach((k, i) => {
    data[k] = results[i]?.data as T[keyof T];
  });

  return {
    data: data as Partial<T>,
    isLoading: results.some((r) => r.isLoading),
    isError: results.some((r) => r.isError),
    error: (results.find((r) => r.error)?.error as ApiError | undefined) ?? null,
    /** Which of the reads failed, by name — so a screen can say what is missing. */
    failed: keys.filter((_, i) => results[i]?.isError).map(String),
    refetch: () => results.forEach((r) => void r.refetch()),
  };
}

/**
 * A write, with the reads it invalidates.
 *
 * Naming the affected paths at the call site is what keeps a screen honest
 * after a mutation: approve a participant and the participant list refetches,
 * because the caller said it should.
 */
export function useApiMutation<TVars, TData = unknown>(
  fn: (vars: TVars) => Promise<TData>,
  options?: {
    invalidates?: (string | null)[];
    onSuccess?: (data: TData, vars: TVars) => void;
    onError?: (error: ApiError, vars: TVars) => void;
  },
) {
  const queryClient = useQueryClient();
  return useMutation<TData, ApiError, TVars>({
    mutationFn: fn,
    onSuccess: (data, vars) => {
      for (const path of options?.invalidates ?? []) {
        if (path) void queryClient.invalidateQueries({ queryKey: [path] });
      }
      options?.onSuccess?.(data, vars);
    },
    onError: options?.onError,
  });
}

/** Drop a cached read — for the rare case a screen must force a cold fetch. */
export function useInvalidate() {
  const queryClient = useQueryClient();
  return (path: string) => void queryClient.invalidateQueries({ queryKey: [path] });
}
