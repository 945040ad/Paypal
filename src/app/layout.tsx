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
        <header className="sticky top-0 z-20 border-b border-line bg-white/85 backdrop-blur">
          <div className="mx-auto flex w-full max-w-[68rem] flex-wrap items-center gap-x-5 gap-y-2 px-6 py-2.5">
            <Link href="/" className="mr-1 font-mono text-base font-bold tracking-tight">
              <span className="text-accent">{"//"}</span>VERDICT
            </Link>
            <nav aria-label="Main" className="flex flex-wrap items-center gap-1">
              <Suspense>
                <NavLinks />
              </Suspense>
            </nav>
            <div className="ml-auto flex items-center gap-3">
              <ModeSwitch />
              <span className="badge badge-accent" title="No real money moves and no real goods are sold.">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent" />
                PayPal sandbox
              </span>
            </div>
          </div>
        </header>
        <div className="flex-1 pt-4">{children}</div>
        <footer className="border-t border-line px-6 py-5 text-center text-xs text-muted">
          Demo on the PayPal sandbox. No real money moves and no real goods are sold.
        </footer>
      </body>
    </html>
  );
}
