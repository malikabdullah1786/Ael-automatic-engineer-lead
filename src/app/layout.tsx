import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AEL Agent — Autonomous Engineering Lead",
  description:
    "Enterprise-grade autonomous SRE agent. Monitors Supabase telemetry, triages crashes via GitHub commits, runs daily standups, and coordinates team remediation via Google Calendar.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <meta charSet="utf-8" />
      </head>
      <body className="min-h-full flex flex-col bg-white text-slate-900">
        {children}

        {/* ── Sonner Toast Notification Provider ── 
            Must be mounted here at root level so all toast() calls
            from any page or component render correctly. */}
        <Toaster
          position="bottom-right"
          richColors
          closeButton
          toastOptions={{
            duration: 4000,
            classNames: {
              toast:
                "font-sans text-xs shadow-lg border border-slate-200 bg-white",
              title: "font-bold text-slate-900",
              description: "text-slate-500",
              error: "border-red-200 bg-red-50",
              success: "border-emerald-200 bg-emerald-50",
              info: "border-blue-200 bg-blue-50",
              warning: "border-amber-200 bg-amber-50",
            },
          }}
        />
      </body>
    </html>
  );
}
