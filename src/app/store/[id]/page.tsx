import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getProduct, PRODUCTS } from "@/store/products";

export function generateStaticParams() {
  return PRODUCTS.map((p) => ({ id: p.id }));
}

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default function ProductPage({ params }: PageProps<"/store/[id]">) {
  return (
    <main className="page max-w-3xl">
      <Link href="/store" className="text-sm text-muted hover:underline">
        Back to the store
      </Link>
      <Suspense
        fallback={
          <div className="mt-6 space-y-3" aria-busy="true" aria-label="Loading the product">
            <div className="skeleton h-8 w-2/3" />
            <div className="skeleton h-24" />
          </div>
        }
      >
        <ProductDetails params={params} />
      </Suspense>
    </main>
  );
}

async function ProductDetails({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = getProduct(id);
  if (!product) notFound();

  return (
    <>
      <p className="eyebrow mt-6">{product.category}</p>
      <h1 className="page-title mt-1">{product.name}</h1>
      <p className="mt-4 font-mono text-lg">{dollars(product.price_cents)}</p>
      <p className="text-sm text-muted">{product.shipping_cents ? `plus ${dollars(product.shipping_cents)} shipping` : "Free shipping"}</p>
      <p className="mt-6">{product.description}</p>
      <p className="mt-6 font-mono text-xs text-muted">Product id: {product.id}</p>

      {product.hidden_text && (
        <>
          {/* The planted prompt injection: in the page for any agent that reads it, invisible to a person. */}
          <span data-testid="hidden-injection" aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden text-[1px] text-transparent">
            {product.hidden_text}
          </span>
          <details className="mt-10 rounded-lg border border-dashed border-warn p-4 text-sm">
            <summary className="cursor-pointer font-semibold text-warn">Demo note: this page hides text aimed at AI agents</summary>
            <p className="mt-3 text-muted">A person cannot see the text below on the page. An agent reading the page can:</p>
            <p className="mt-2 font-mono text-xs">{product.hidden_text}</p>
          </details>
        </>
      )}
    </>
  );
}
