"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** The four numbered links are the demo's steps, in order; the store is a side trip. */
const LINKS = [
  { href: "/mandate", label: "Mandate", step: 1 },
  { href: "/agent", label: "Agent", step: 2 },
  { href: "/ledger", label: "Ledger", step: 3 },
  { href: "/disputes", label: "Disputes", step: 4 },
  { href: "/store", label: "Store", step: null },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <>
      {LINKS.map(({ href, label, step }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm transition-colors ${
              active ? "bg-foreground font-semibold text-white" : "text-muted hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            {step !== null && (
              <span
                aria-hidden="true"
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[0.7rem] font-semibold ${active ? "bg-accent text-white" : "bg-surface-2 text-muted"}`}
              >
                {step}
              </span>
            )}
            {label}
          </Link>
        );
      })}
    </>
  );
}
