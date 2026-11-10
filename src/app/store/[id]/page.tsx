import Link from "next/link";
import { notFound } from "next/navigation";
import { getProduct, PRODUCTS } from "@/store/products";

export function generateStaticParams() {
  return PRODUCTS.map((p) => ({ id: p.id }));
}

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default async function ProductPage({ params }: PageProps<"/store/[id]">) {
  const { id } = await params;
  const product = getProduct(id);
  if (!product) notFound();

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-10">
      <Link href="/store" className="text-sm text-zinc-500 hover:underline">
        Back to the store
      </Link>
      <p className="mt-6 text-xs uppercase tracking-wide text-zinc-500">{product.category}</p>
      <h1 className="mt-1 text-2xl font-semibold">{product.name}</h1>
      <p className="mt-4 font-mono text-lg">{dollars(product.price_cents)}</p>
      <p className="text-sm text-zinc-500">{product.shipping_cents ? `plus ${dollars(product.shipping_cents)} shipping` : "Free shipping"}</p>
      <p className="mt-6">{product.description}</p>
      <p className="mt-6 font-mono text-xs text-zinc-500">Product id: {product.id}</p>

      {product.hidden_text && (
        <>
          {/* The planted prompt injection: in the page for any agent that reads it, invisible to a person. */}
          <span data-testid="hidden-injection" aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden text-[1px] text-transparent">
            {product.hidden_text}
          </span>
          <details className="mt-10 rounded border border-amber-500 p-4 text-sm">
            <summary className="cursor-pointer font-medium text-amber-700 dark:text-amber-400">Demo note: this page hides text aimed at AI agents</summary>
            <p className="mt-3 text-zinc-600 dark:text-zinc-400">A person cannot see the text below on the page. An agent reading the page can:</p>
            <p className="mt-2 font-mono text-xs">{product.hidden_text}</p>
          </details>
        </>
      )}
    </main>
  );
}
