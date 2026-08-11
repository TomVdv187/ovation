import type { Metadata } from "next";
import type { ReactNode } from "react";
import { TRPCProvider } from "~/trpc/react";
import "./globals.css";

export const metadata: Metadata = {
  title: "OVATION",
  description: "An event agent that runs the whole event business.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="ov-console min-h-screen bg-bg text-ink antialiased">
        <TRPCProvider>{children}</TRPCProvider>
      </body>
    </html>
  );
}
