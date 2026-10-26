import SwRegister from "./sw-register";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="tr">
      <body>
        <SwRegister />
        {children}
      </body>
    </html>
  );
}
