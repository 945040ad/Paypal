import { Cable, Gift, Keyboard, type LucideIcon, Package } from "lucide-react";
import Link from "next/link";
import { PRODUCTS } from "@/store/products";

export const metadata = { title: "Demo store | Verdict" };

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** No product photos in the demo store: each category gets a quiet tile with a line icon. */
const ICON: Record<string, LucideIcon> = { keyboards: Keyboard, cables: Cable, "gift-cards": Gift };

export default function StorePage() {
  return (
    <main className="page">
      <p className="eyebrow">The shop the agent buys from</p>
      <h1 className="page-title mt-1">Demo store</h1>
      <p className="lede">
        A small shop the agent can buy from. Payments go through the PayPal sandbox; nothing here is real merchandise.
      </p>
      <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PRODUCTS.map((p) => {
          const Icon = ICON[p.category] ?? Package;
          return (
          <li key={p.id}>
            <Link href={`/store/${p.id}`} className="card flex h-full flex-col !p-0 transition-colors duration-150 hover:border-line-strong">
              <span aria-hidden="true" className="flex h-24 items-center justify-center rounded-t-xl border-b border-line bg-surface-2 text-muted">
                <Icon size={28} strokeWidth={1.25} />
              </span>
              <span className="flex flex-1 flex-col p-4">
                <span className="badge self-start">{p.category}</span>
                <span className="mt-1 flex-1 font-medium leading-snug">{p.name}</span>
                <span className="mt-3 flex items-baseline justify-between">
                  <span className="font-mono text-base">{dollars(p.price_cents)}</span>
                  <span className="text-xs text-muted">{p.shipping_cents ? `plus ${dollars(p.shipping_cents)} shipping` : "free shipping"}</span>
                </span>
              </span>
            </Link>
          </li>
          );
        })}
      </ul>
    </main>
  );
}
