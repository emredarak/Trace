import SwRegister from "./sw-register";
import { AmbientBackground } from "./components/ambient-background";
import { IntroOverlay } from "./components/intro-overlay";
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
        <IntroOverlay />
        <header className="trace-nav">
          <nav className="brand-only" aria-label="Trace">
            <a className="brand" href="/">
              TRACE<em>.</em>
            </a>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
