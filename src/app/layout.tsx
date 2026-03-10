import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Le Guide",
  description: "AI-powered image editing",
  openGraph: {
    title: "Le Guide",
    description: "AI-powered image editing",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
  icons: {
    icon: "/icon.png",
    apple: "/apple-icon.png",
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
        {children}
      </body>
    </html>
  );
}
