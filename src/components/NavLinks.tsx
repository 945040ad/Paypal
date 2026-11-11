"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/mandate", label: "Mandate" },
  { href: "/store", label: "Store" },
  { href: "/agent", label: "Agent" },
  { href: "/ledger", label: "Ledger" },
  { href: "/disputes", label: "Disputes" },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <>
      {LINKS.map(({ href, label }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`border-b-2 py-1 text-sm ${active ? "border-orange-500 font-semibold text-white" : "border-transparent text-zinc-300 hover:text-white"}`}
          >
            {label}
          </Link>
        );
      })}
    </>
  );
}
