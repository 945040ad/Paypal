"use client";

import { Bot, FileSignature, Scale, ScrollText, Store } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** The four numbered links are the demo's steps, in order; the store is a side trip. */
const STEPS = [
  { href: "/mandate", label: "Mandate", icon: FileSignature },
  { href: "/agent", label: "Agent", icon: Bot },
  { href: "/ledger", label: "Ledger", icon: ScrollText },
  { href: "/disputes", label: "Disputes", icon: Scale },
];
const OTHER = [{ href: "/store", label: "Store", icon: Store }];

export function NavLinks() {
  const pathname = usePathname();
  const row = ({ href, label, icon: Icon }: (typeof STEPS)[number], step?: number) => {
    const active = pathname === href || pathname.startsWith(`${href}/`);
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? "page" : undefined}
        className={`flex h-9 items-center gap-2.5 rounded-lg border px-2.5 text-sm transition-colors duration-150 ${
          active ? "border-line bg-surface font-medium text-foreground" : "border-transparent text-secondary hover:bg-surface-3 hover:text-foreground"
        }`}
      >
        <Icon aria-hidden="true" size={16} strokeWidth={1.5} className="shrink-0" />
        <span className="flex-1">{label}</span>
        {step !== undefined && (
          <span aria-hidden="true" className="font-mono text-xs text-muted">
            {step}
          </span>
        )}
      </Link>
    );
  };

  return (
    <>
      <p className="hidden px-2.5 pb-2 text-xs text-muted lg:block">The demo, in order</p>
      <div className="flex flex-wrap gap-1 lg:flex-col">{STEPS.map((s, i) => row(s, i + 1))}</div>
      <p className="hidden px-2.5 pb-2 pt-6 text-xs text-muted lg:block">Also</p>
      <div className="flex flex-wrap gap-1 lg:flex-col">{OTHER.map((s) => row(s))}</div>
    </>
  );
}
