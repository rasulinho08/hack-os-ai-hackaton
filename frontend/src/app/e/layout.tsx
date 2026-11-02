import { PlatformNotice } from "@/components/notices/PlatformNotice";

/**
 * Event pages (/e/[slug] and its registration): the platform owner's notice
 * above the page, when there is one — a registration form is exactly where
 * someone should learn about maintenance tonight.
 */
export default function EventPagesLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PlatformNotice frame="px-4 pt-3 sm:px-6" className="mx-auto max-w-6xl" />
      {children}
    </>
  );
}
