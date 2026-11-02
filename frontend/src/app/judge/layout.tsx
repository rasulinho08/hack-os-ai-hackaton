import type { Metadata } from "next";
import "../globals.css";
import JudgeShell from "./JudgeShell";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export const metadata: Metadata = {
  title: "Judge Dashboard",
  description: "Judge dashboard for fair, fast, structured scoring.",
};

export default function JudgeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <JudgeShell>
      <ErrorBoundary>{children}</ErrorBoundary>
    </JudgeShell>
  );
}
