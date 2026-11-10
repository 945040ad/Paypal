import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
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
  title: "SYSTEM//AUDIT",
  description: "A flight recorder for AI agents that spend money through PayPal.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="border-b border-zinc-200 dark:border-zinc-800">
          <nav className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3 text-sm">
            <Link href="/" className="font-mono font-semibold">
              SYSTEM//AUDIT
            </Link>
            <Link href="/mandate">Mandate</Link>
            <Link href="/store">Store</Link>
            <Link href="/agent">Agent</Link>
            <span className="ml-auto rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">PayPal sandbox only</span>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
