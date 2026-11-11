/**
 * npm run seed [-- --reset]
 * Loads the demo data into the database at DATABASE_PATH: the recorded sandbox history (one signed mandate,
 * three purchases, two finished disputes) and one fresh mandate. Does nothing if the ledger already has
 * entries. With --reset the database file is deleted first.
 */
import { existsSync, rmSync } from "node:fs";
import { openDb } from "../src/db";
import { createLedger } from "../src/ledger/ledger";
import data from "../src/seed/demo-data.json";
import { seedDemo, type SeedData } from "../src/seed/seed";

const path = process.env.DATABASE_PATH ?? "./data/audit.db";

async function main() {
  if (process.argv.includes("--reset")) {
    for (const file of [path, `${path}-wal`, `${path}-shm`]) if (existsSync(file)) rmSync(file);
    console.log(`Deleted ${path}.`);
  }
  const db = openDb(path);
  const result = await seedDemo(db, data as unknown as SeedData, { vaultId: process.env.PAYPAL_DEMO_VAULT_ID || undefined });
  const chain = createLedger(db).verifyChain();
  if (!result.seeded) {
    console.log(`The ledger at ${path} already has entries, so nothing was added. Use "npm run seed -- --reset" to start again from the demo data.`);
  } else {
    console.log(`Seeded ${path}: ${result.entries} ledger entries, ${data.purchases.length} purchases, ${data.disputes.length} finished disputes, plus one fresh mandate.`);
    console.log(process.env.PAYPAL_DEMO_VAULT_ID ? "Saved PayPal (vault) ID loaded from PAYPAL_DEMO_VAULT_ID: purchases need no buyer approval." : "No PAYPAL_DEMO_VAULT_ID set: the first purchase will ask the sandbox buyer to approve in PayPal.");
  }
  console.log(`Chain: ${chain.ok ? `valid, ${chain.length} entries` : `BROKEN at entry ${chain.first_bad_seq}`}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
