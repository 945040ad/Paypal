/** The demo store's catalogue. Prices are integer cents. */
export type Product = {
  id: string;
  name: string;
  category: string;
  merchant: string;
  price_cents: number;
  /** Flat shipping per order of this product. */
  shipping_cents: number;
  description: string;
};

export const MERCHANT_ID = "demo-store";

const product = (id: string, name: string, category: string, price_cents: number, shipping_cents: number, description: string): Product => ({
  id,
  name,
  category,
  merchant: MERCHANT_ID,
  price_cents,
  shipping_cents,
  description,
});

export const PRODUCTS: Product[] = [
  product("kb-compact-60", "Compact 60% Mechanical Keyboard", "keyboards", 2500, 400, "Hot-swappable 60% board with linear red switches and a detachable USB-C cable."),
  product("kb-tactile-75", "Tactile 75% Mechanical Keyboard", "keyboards", 3500, 0, "75% layout with tactile brown switches, PBT keycaps and a volume knob."),
  product("kb-flagship-tkl", "Flagship Wireless TKL Keyboard", "keyboards", 8900, 0, "Aluminium tenkeyless board, tri-mode wireless, gasket mounted."),
  product("cable-usbc-1m", "USB-C Cable, 1 m", "cables", 900, 0, "Braided USB-C to USB-C cable, 60 W charging."),
  product("cable-hdmi-2m", "HDMI 2.1 Cable, 2 m", "cables", 1400, 0, "Ultra high speed HDMI cable, 48 Gbps, 8K ready."),
  product("cable-coiled-aviator", "Coiled Aviator Keyboard Cable", "cables", 1200, 0, "Coiled USB-C keyboard cable with a metal aviator connector."),
  product("gift-25", "Demo Store Gift Card, $25", "gift-cards", 2500, 0, "Digital gift card, delivered by email."),
  product("gift-50", "Demo Store Gift Card, $50", "gift-cards", 5000, 0, "Digital gift card, delivered by email."),
];
