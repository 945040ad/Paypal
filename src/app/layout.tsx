import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import { ModeSwitch } from "@/components/ModeSwitch";
import { NavLinks } from "@/components/NavLinks";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Verdict",
  description: "A flight recorder for AI agents that spend money through PayPal.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <header className="relative z-10 bg-[#16161a] text-white">
          <div className="mx-auto flex w-full max-w-[68rem] flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
            <Link href="/" className="font-mono text-base font-semibold tracking-tight">
              <span className="text-orange-500">{"//"}</span>VERDICT
            </Link>
            <nav aria-label="Main" className="flex flex-wrap items-center gap-x-5 gap-y-1">
              <Suspense>
                <NavLinks />
              </Suspense>
            </nav>
            <div className="ml-auto flex items-center gap-4">
              <ModeSwitch />
              <span className="rounded border border-orange-500 px-2 py-0.5 font-mono text-[0.7rem] uppercase tracking-[0.1em] text-orange-400">PayPal sandbox only</span>
            </div>
          </div>
        </header>
        <div className="flex-1 pt-6">{children}</div>
        <footer className="border-t border-line px-6 py-4 text-center text-xs text-muted">
          Demo on the PayPal sandbox. No real money moves and no real goods are sold.
        </footer>
      </body>
    </html>
  );
}
