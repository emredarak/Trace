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
    <html lang="tr">
      <body>
        <SwRegister />
        <header className="trace-nav">
          <nav>
            <a href="/">Vakalar</a>
            <a href="/new">+ Yeni Vaka</a>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
