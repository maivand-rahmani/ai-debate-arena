import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AI Debate Arena",
  description: "Set the terms. Watch the arguments clash.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
