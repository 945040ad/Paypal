import Link from "next/link";
import { PRODUCTS } from "@/store/products";

export const metadata = { title: "Demo store | SYSTEM//AUDIT" };

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default function StorePage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Demo store</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        A small shop the agent can buy from. Payments go through the PayPal sandbox; nothing here is real merchandise.
      </p>
      <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PRODUCTS.map((p) => (
          <li key={p.id}>
            <Link href={`/store/${p.id}`} className="block h-full rounded border border-zinc-200 p-4 hover:border-zinc-500 dark:border-zinc-800">
              <p className="text-xs uppercase tracking-wide text-zinc-500">{p.category}</p>
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
