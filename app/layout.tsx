import SwRegister from "./sw-register";
import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Trace",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <SwRegister />
        <header className="trace-nav">
          <nav>
            <a href="/">Cases</a>
            <a href="/new">+ New Case</a>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
