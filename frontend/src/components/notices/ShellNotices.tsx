"use client";

/**
 * What sits above every signed-in page's content: the platform owner's
 * notice (maintenance, an incident) and, for an account that has not
 * confirmed its e-mail, the request to do so.
 */

import { PlatformNotice } from "./PlatformNotice";
import { VerifyEmailBanner } from "./VerifyEmailBanner";

export function ShellNotices() {
  return (
    <>
      <PlatformNotice />
      <VerifyEmailBanner />
    </>
  );
}
