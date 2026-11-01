import Link from "next/link";
import { Logo3D } from "@/components/brand/Logo3D";

/**
 * The 404 page. It renders inside the root layout, so it uses the same
 * surface and text tokens as the rest of the app in both themes, and it
 * cannot assume the visitor is an organiser: on the marketing host "/" is the
 * landing page, on the app host it is the console (or the login screen).
 */
export default function NotFound() {
  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        padding: "2rem 1rem",
        textAlign: "center",
        background: "var(--hh-bg-page)",
        color: "var(--hh-text)",
      }}
    >
      <Logo3D className="mb-8 h-16 w-16" />
      <p
        style={{
          margin: 0,
          fontSize: "13px",
          fontWeight: 600,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--app-brand-text)",
        }}
      >
        404
      </p>
      <h1
        style={{
          margin: "0.75rem 0 0",
          fontSize: "1.75rem",
          fontWeight: 700,
          letterSpacing: "-0.02em",
          color: "var(--app-heading)",
        }}
      >
        Page not found
      </h1>
      <p
        style={{
          margin: "0.75rem 0 0",
          maxWidth: "26rem",
          fontSize: "15px",
          lineHeight: 1.6,
          color: "var(--app-muted)",
        }}
      >
        The page you are looking for does not exist or has moved. Check the
        address, or go back to the start.
      </p>
      <Link
        href="/"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.5rem",
          marginTop: "1.75rem",
          minHeight: "2.75rem",
          padding: "0 1.5rem",
          borderRadius: "0.75rem",
          background: "#E1003C",
          color: "#fff",
          fontSize: "15px",
          fontWeight: 600,
        }}
      >
        Back to HackOS
      </Link>
    </main>
  );
}
