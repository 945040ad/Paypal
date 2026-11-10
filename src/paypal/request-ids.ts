import { randomUUID } from "node:crypto";
import type { Db } from "../db";

/**
 * The PayPal-Request-Id for one logical action (for example "capture:int_abc").
 * Created once and stored, so a retry of the same action sends the same ID and PayPal returns the first result.
 */
export function requestIdFor(db: Db, action: string): string {
  db.prepare("INSERT OR IGNORE INTO paypal_request_ids (action, request_id, created_at) VALUES (?, ?, ?)").run(
    action,
    randomUUID(),
    new Date().toISOString(),
  );
  return (db.prepare("SELECT request_id FROM paypal_request_ids WHERE action = ?").get(action) as { request_id: string }).request_id;
}
