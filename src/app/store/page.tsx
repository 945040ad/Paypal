import Link from "next/link";
import { PRODUCTS } from "@/store/products";

export const metadata = { title: "Demo store | Verdict" };

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** No product photos in the demo store: each category gets a coloured tile with a keyboard-style glyph. */
const TILE: Record<string, string> = {
  keyboards: "bg-gradient-to-br from-slate-800 to-slate-600 text-white",
  cables: "bg-gradient-to-br from-orange-500 to-amber-400 text-white",
  "gift-cards": "bg-gradient-to-br from-emerald-600 to-teal-400 text-white",
};
const GLYPH: Record<string, string> = { keyboards: "⌨", cables: "⌁", "gift-cards": "$" };

export default function StorePage() {
  return (
    <main className="page">
      <p className="eyebrow">The shop the agent buys from</p>
      <h1 className="page-title mt-1">Demo store</h1>
      <p className="lede">
        A small shop the agent can buy from. Payments go through the PayPal sandbox; nothing here is real merchandise.
      </p>
      <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PRODUCTS.map((p) => (
          <li key={p.id}>
            <Link href={`/store/${p.id}`} className="card group flex h-full flex-col !p-0 transition-all hover:-translate-y-0.5 hover:border-accent">
              <span
                aria-hidden="true"
                className={`flex h-28 items-center justify-center rounded-t-[0.8rem] text-4xl font-semibold tracking-tight ${TILE[p.category] ?? "bg-surface-2 text-muted"}`}
              >
                {GLYPH[p.category] ?? "•"}
              </span>
              <span className="flex flex-1 flex-col p-4">
                <span className="badge self-start">{p.category}</span>
                <span className="mt-2 flex-1 font-semibold leading-snug">{p.name}</span>
                <span className="mt-3 flex items-baseline justify-between">
                  <span className="text-lg font-semibold">{dollars(p.price_cents)}</span>
                  <span className="text-xs text-muted">{p.shipping_cents ? `plus ${dollars(p.shipping_cents)} shipping` : "free shipping"}</span>
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
