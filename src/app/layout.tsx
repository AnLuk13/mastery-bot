import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mastery Bot",
  description: "Backend for the Mastery Telegram knowledge bot.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
