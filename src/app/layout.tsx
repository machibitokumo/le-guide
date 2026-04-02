import type { Metadata, Viewport } from "next";
import "./globals.css";
import NoContextMenu from "@/components/NoContextMenu";
import ErrorBoundary from "@/components/ErrorBoundary";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const metadata: Metadata = {
  title: "Le Guide",
  description: "AI-powered image editing",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Le Guide",
  },
  openGraph: {
    title: "Le Guide",
    description: "AI-powered image editing",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
  icons: {
    icon: "/icon-192.png",
    apple: [{ url: "/apple-icon.png", sizes: "180x180" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <ErrorBoundary>
          <NoContextMenu>{children}</NoContextMenu>
        </ErrorBoundary>
      </body>
    </html>
  );
}
