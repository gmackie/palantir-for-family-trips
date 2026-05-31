import { cn } from "@gmacko/ui";
import { ThemeProvider } from "@gmacko/ui/theme";
import { Toaster } from "@gmacko/ui/toast";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { env } from "~/env";
import { TRPCReactProvider } from "~/trpc/react";
import { Providers } from "./providers";

import "~/app/styles.css";

export const metadata: Metadata = {
  metadataBase: new URL(
    env.APP_URL ?? env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  ),
  title: "Sortey",
  description:
    "Plan together. Split everything. Group trip coordination with shared itineraries, receipt OCR, and real-time settlement.",
  openGraph: {
    title: "Sortey",
    description:
      "Plan together. Split everything. Group trip coordination with shared itineraries, receipt OCR, and real-time settlement.",
    url: env.APP_URL ?? env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    siteName: "Sortey",
  },
  twitter: {
    card: "summary_large_image",
  },
};

export const viewport: Viewport = {
  themeColor: "#0A0C10",
};

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});
const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export default function RootLayout(props: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `localStorage.setItem("theme-mode","dark");document.documentElement.className="dark"`,
          }}
        />
      </head>
      <body
        className={cn(
          "bg-background text-foreground min-h-screen font-sans antialiased",
          geistSans.variable,
          geistMono.variable,
        )}
      >
        <ThemeProvider>
          <Providers>
            <TRPCReactProvider>{props.children}</TRPCReactProvider>
          </Providers>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
