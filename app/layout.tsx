import SwRegister from "./sw-register";
import { AmbientBackground } from "./components/ambient-background";
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
        <AmbientBackground />
        <header className="trace-nav">
          <nav>
            <a className="brand" href="/">
              TRACE<em>.</em>
            </a>
            <a href="/">Cases</a>
            <a className="nav-cta" href="/new">
              + New Case
            </a>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
