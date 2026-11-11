/**
 * Runs once when the server starts.
 * 1. If the ledger is empty, load the demo data. The hosted database is wiped on every deploy and whenever
 *    the free instance sleeps, so without this a visitor would find an empty app. Set AUTO_SEED=false to skip.
 * 2. Schedule the reconcile job so a missed webhook never blocks the demo.
 */
const EVERY_MS = 3 * 60_000;

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { getDb } = await import("./db");

  if (process.env.AUTO_SEED !== "false") {
    try {
      const [{ seedDemo }, { default: data }] = await Promise.all([import("./seed/seed"), import("./seed/demo-data.json")]);
      const result = await seedDemo(getDb(), data as unknown as Parameters<typeof seedDemo>[1], { vaultId: process.env.PAYPAL_DEMO_VAULT_ID || undefined });
      if (result.seeded) console.log(`Demo data loaded: ${result.entries} ledger entries.`);
    } catch (err) {
      console.error("Loading the demo data failed:", err instanceof Error ? err.message : err);
    }
  }

  if (process.env.PAYPAL_ENV !== "sandbox" || !process.env.PAYPAL_CLIENT_ID) return; // PayPal not configured: no reconcile job

  const [{ getPayPalClient }, { reconcile }, { getLedger }] = await Promise.all([import("./paypal/client"), import("./paypal/reconcile"), import("./server")]);
  const run = async () => {
    try {
      const summary = await reconcile({ db: getDb(), ledger: getLedger(), paypal: getPayPalClient() });
      if (summary.disputes_opened || summary.disputes_resolved) console.log("Reconcile:", JSON.stringify(summary));
    } catch (err) {
      console.error("Reconcile failed:", err instanceof Error ? err.message : err);
    }
  };
  setInterval(run, EVERY_MS).unref();
}
