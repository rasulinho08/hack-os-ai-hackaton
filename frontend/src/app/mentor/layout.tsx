import type { Metadata } from "next";
import "../globals.css";
import MentorShell from "./MentorShell";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export const metadata: Metadata = {
  title: "Mentor Dashboard",
  description: "Technical support & guidance for hackathon teams.",
};

export default function MentorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <MentorShell>
      <ErrorBoundary>{children}</ErrorBoundary>
    </MentorShell>
  );
}
