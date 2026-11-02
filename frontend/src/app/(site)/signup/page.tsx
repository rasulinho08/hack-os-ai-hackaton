import { redirect } from "next/navigation";

/**
 * Creating an account is the second tab of the sign-in page now
 * (/signin?mode=register). Links that still point here — older e-mails,
 * bookmarks — keep working: every parameter (plan, period, org, next) is
 * carried over.
 */
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) {
    if (typeof v === "string") q.set(k, v);
  }
  q.set("mode", "register");
  redirect(`/signin?${q.toString()}`);
}
