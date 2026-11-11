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
      <body className="flex min-h-full flex-col lg:flex-row">
        <aside className="z-20 flex shrink-0 flex-col gap-4 bg-foreground p-4 text-background lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:gap-0">
          <Link href="/" className="flex h-9 items-center px-2.5 font-mono text-base font-semibold tracking-tight">
            <span className="text-[var(--accent-on-dark)]">{"//"}</span>VERDICT
          </Link>
          <nav aria-label="Main" className="lg:mt-6">
            <Suspense>
              <NavLinks />
            </Suspense>
          </nav>
          <div className="lg:mt-auto">
            <ModeSwitch />
            <p className="mt-4 hidden border-t border-white/15 px-0.5 pt-4 text-xs leading-relaxed text-background/60 lg:block">
              PayPal sandbox only. No real money moves and no real goods are sold.
            </p>
          </div>
        </aside>
        <div className="shell-content min-w-0 flex-1">{children}</div>
      </body>
    </html>
  );
}
