"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/contexts/ToastContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { ToastContainer } from "@/components/Toast";

export function Providers({ children }: { children: React.ReactNode }) {
  /*
   * One client per browser session, created in state so a re-render does not
   * throw the cache away.
   *
   * `staleTime` is thirty seconds: long enough that moving between screens
   * reuses what was just fetched, short enough that an organiser watching a
   * help queue during an event still sees it move. `retry: 1` because a failed
   * read must surface as an error rather than be masked by a retry loop — the
   * bug this codebase has already had twice is a failure that looked like an
   * empty list.
   */
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
    <LanguageProvider>
      <ThemeProvider>
        <ToastProvider>
          {children}
          <ToastContainer />
        </ToastProvider>
      </ThemeProvider>
    </LanguageProvider>
    </QueryClientProvider>
  );
}
