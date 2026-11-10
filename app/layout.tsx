import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DeskPilot — AI Action Agent",
  description: "An AI agent that interprets Claude's output and executes real actions: files, todos, web APIs and utilities, with validation, approvals and an audit log.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
