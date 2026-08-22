import "./globals.css";
import type { Metadata, Viewport } from "next";
import Script from "next/script";

export const metadata: Metadata = {
  title: "Crown & Anchor Veterans League — Live Auction",
  description: "The C&A Veterans League fantasy football live auction",
  icons: { icon: "/crown-anchor-logo.jpg" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        {/* Ably realtime client loaded from CDN so Next.js webpack never
            tries to parse its pre-built browser bundle (which chokes on
            downlevel-compiled `super(...)` syntax). Available as
            `window.Ably` after load; client components wait for it. */}
        <Script
          src="https://cdn.ably.com/lib/ably.min-2.js"
          strategy="afterInteractive"
        />
        {children}
      </body>
    </html>
  );
}
