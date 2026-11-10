/** Runs once when the server starts: schedules the reconcile job so a missed webhook never blocks the demo. */
const EVERY_MS = 3 * 60_000;

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.PAYPAL_ENV !== "sandbox" || !process.env.PAYPAL_CLIENT_ID) return; // not configured: skip quietly

  const [{ getDb }, { getPayPalClient }, { reconcile }, { getLedger }] = await Promise.all([
    import("./db"),
    import("./paypal/client"),
    import("./paypal/reconcile"),
    import("./server"),
  ]);

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
