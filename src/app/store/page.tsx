import Link from "next/link";
import { PRODUCTS } from "@/store/products";

export const metadata = { title: "Demo store | Verdict" };

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

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
            <Link href={`/store/${p.id}`} className="card block h-full hover:border-foreground">
              <p className="eyebrow">{p.category}</p>
              <p className="mt-1 font-medium">{p.name}</p>
              <p className="mt-3 font-mono text-sm">{dollars(p.price_cents)}</p>
              <p className="text-xs text-zinc-500">{p.shipping_cents ? `plus ${dollars(p.shipping_cents)} shipping` : "free shipping"}</p>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
