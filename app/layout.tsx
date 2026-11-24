import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Handsign",
  description: "Private, local gesture controls for video calls"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
