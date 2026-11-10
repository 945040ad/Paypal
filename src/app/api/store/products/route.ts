import { PRODUCTS, productPageText } from "@/store/products";

/** The catalogue as JSON, the way an agent reads it: each product with its full page text, hidden text included. */
export async function GET() {
  return Response.json({
    products: PRODUCTS.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      merchant: p.merchant,
      price_cents: p.price_cents,
      shipping_cents: p.shipping_cents,
      page_text: productPageText(p),
    })),
  });
}
