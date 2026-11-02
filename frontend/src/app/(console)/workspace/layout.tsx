import type { Metadata } from "next";
import { Schibsted_Grotesk, IBM_Plex_Mono } from "next/font/google";
import { ConsoleShell } from "./_shell";
import { OwnerGate } from "./_gate";
import { PlatformProvider } from "./_platform";
import { ConsoleRoot } from "./_theme";

const display = Schibsted_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono-ui",
  display: "swap",
});


export const metadata: Metadata = {
  title: "Owner console",
  description: "Platform-wide view of every event, account and queue on HackOS.",
  robots: { index: false, follow: false },
};

export default function OwnerConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ConsoleRoot fonts={`${display.variable} ${mono.variable}`}>
      <OwnerGate>
        <PlatformProvider>
          <ConsoleShell>{children}</ConsoleShell>
        </PlatformProvider>
      </OwnerGate>
    </ConsoleRoot>
  );
}
