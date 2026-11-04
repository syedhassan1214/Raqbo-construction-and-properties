import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RAQBO — Find a place that feels like yours",
  description:
    "Discover property across Pakistan, connect directly with owners and understand what listing checks mean.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" dir="ltr">
      <body>{children}</body>
    </html>
  );
}
