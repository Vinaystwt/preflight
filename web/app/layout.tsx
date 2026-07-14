import type { Metadata } from "next";
import { Space_Grotesk, Instrument_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const display = Space_Grotesk({
  variable: "--font-display",
  weight: ["500", "600"],
  subsets: ["latin"],
  display: "swap",
});

const ui = Instrument_Sans({
  variable: "--font-ui",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  display: "swap",
});

const mono = IBM_Plex_Mono({
  variable: "--font-mono",
  weight: ["400", "500"],
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://usepreflight.xyz"),
  alternates: { canonical: "/" },
  title: {
    default: "PreFlight — a release gate that behaves like a real customer",
    template: "%s · PreFlight",
  },
  description:
    "Deployed is not sellable. PreFlight discovers what your agent service actually does, acts as a real paying buyer, and returns RELEASE, BLOCK, or UNKNOWN with the exact fix.",
  openGraph: {
    title: "PreFlight — a release gate that behaves like a real customer",
    description: "Deployed is not sellable. Prove your service is buyable before it goes live.",
    url: "https://usepreflight.xyz",
    siteName: "PreFlight",
    type: "website",
  },
  twitter: { card: "summary_large_image", creator: "@vinaystwt", site: "@vinaystwt" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${ui.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-canvas text-primary">
        <a href="#main" className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-4 focus-visible:top-4 focus-visible:z-50 focus-visible:rounded-md focus-visible:bg-surface-2 focus-visible:px-3 focus-visible:py-2 focus-visible:t-ui focus-visible:text-primary">
          Skip to content
        </a>
        {children}
        <Toaster theme="dark" />
      </body>
    </html>
  );
}
