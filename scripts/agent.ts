/**
 * npm run agent -- "buy me a mechanical keyboard under $40" [--observe]
 * Runs the shopping agent once against the real model and the PayPal sandbox, printing each tool call and decision.
 */
import { runShoppingAgentWithFallback, type AgentEvent } from "../src/ai/agent";
import { getModels, modelNames } from "../src/ai/model";
import { getDb } from "../src/db";
import { getLatestMandate } from "../src/mandate/store";
import { DEMO_USER_ID, getLedger, getPurchaseFlow } from "../src/server";

const args = process.argv.slice(2);
const task = args.filter((a) => !a.startsWith("--")).join(" ");
if (!task) throw new Error('Usage: npm run agent -- "what to buy" [--observe]');

const stored = getLatestMandate(getDb(), DEMO_USER_ID);
if (!stored) throw new Error("No signed mandate on file. Sign one at /mandate or run `npm run purchase -- --new-mandate` first.");

const flow = getPurchaseFlow();
const short = (v: unknown) => JSON.stringify(v).slice(0, 400);
const onEvent = (e: AgentEvent) => {
  if (e.type === "tool_call") console.log(`-> ${e.tool}(${short(e.input)})`);
  else if (e.type === "tool_result") console.log(`<- ${short(e.output)}`);
  else if (e.type === "decision") console.log(`   GATE: ${e.decision ?? "-"}${e.rule ? ` (${e.rule})` : ""}  status=${e.status}  total=${e.total_cents}  intent=${e.intent_id}${e.capture_id ? `  capture=${e.capture_id}` : ""}${e.approve_url ? `\n   APPROVE: ${e.approve_url}` : ""}`);
  else if (e.type === "text") console.log(`\nAgent: ${e.text}`);
};

async function main() {
  console.log(`Task: ${task}\nMandate: ${stored!.mandate.id}  Models: ${modelNames().join(", ")}\n`);
  const before = getLedger().export().length;
  await runShoppingAgentWithFallback({ flow, mandateId: stored!.mandate.id, mode: args.includes("--observe") ? "OBSERVE" : "ENFORCE", models: getModels(), task, onEvent });
  console.log("\nNew ledger entries:");
  for (const e of getLedger().export().entries.slice(before)) console.log(`  ${e.seq}  ${e.type.padEnd(15)} ${e.intent_id ?? ""}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
