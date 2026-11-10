/**
 * Catches up with PayPal in case a webhook was missed: lists disputes, re-fetches each one in full
 * (the list lags the detail call), and records anything new. Safe to run as often as you like.
 */
import { getDispute, listDisputeIds, recordDispute, type Deps } from "./disputes";

export type ReconcileSummary = { disputes_seen: number; disputes_opened: number; disputes_resolved: number; ran_at: string };

export async function reconcile(deps: Deps): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = { disputes_seen: 0, disputes_opened: 0, disputes_resolved: 0, ran_at: new Date().toISOString() };
  for (const disputeId of await listDisputeIds(deps.paypal)) {
    const result = recordDispute(deps, await getDispute(deps.paypal, disputeId));
    summary.disputes_seen += 1;
    if (result.opened) summary.disputes_opened += 1;
    if (result.resolved) summary.disputes_resolved += 1;
  }
  return summary;
}
