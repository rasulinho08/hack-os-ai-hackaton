"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * Client safety net: if the URL bar points outside this shell (e.g. /user, /participants),
 * force navigation back to the role home. Middleware should already enforce this.
 */
export function RoleShellGuard({
  prefix,
}: {
  prefix: "/mentor" | "/hacker" | "/judge" | "/volunteer";
}) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!pathname.startsWith(prefix)) {
      router.replace(prefix);
    }
  }, [pathname, prefix, router]);

  return null;
}
