/** The demo store's shipment records. One is created when an order is captured. */
import { randomInt } from "node:crypto";
import type { Db } from "../db";

export type Shipment = { intent_id: string; carrier: string; tracking_number: string; shipped_at: string };

export function getShipment(db: Db, intentId: string): Shipment | null {
  return (db.prepare("SELECT intent_id, carrier, tracking_number, shipped_at FROM shipments WHERE intent_id = ?").get(intentId) as Shipment | undefined) ?? null;
}

/** Records that the store shipped an order. Does nothing if it already has a shipment. */
export function recordShipment(db: Db, intentId: string): Shipment {
  const tracking = String(randomInt(100_000_000_000, 999_999_999_999));
  db.prepare("INSERT OR IGNORE INTO shipments (intent_id, carrier, tracking_number, shipped_at) VALUES (?, 'FEDEX', ?, ?)").run(
    intentId,
    tracking,
    new Date().toISOString(),
  );
  return getShipment(db, intentId)!;
}
