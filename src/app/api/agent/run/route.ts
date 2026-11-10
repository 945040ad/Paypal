import { runShoppingAgentWithFallback, type AgentEvent } from "@/ai/agent";
import { getModels } from "@/ai/model";
import { getDb } from "@/db";
import { getLatestMandate } from "@/mandate/store";
import { DEMO_USER_ID, getPurchaseFlow, readJson } from "@/server";
import { getMode } from "@/settings";

/**
 * Runs the shopping agent and streams what it does as newline-delimited JSON, one event per line.
 * The mandate and the gate mode are chosen here on the server; the request can only supply the task.
 */
export async function POST(request: Request) {
  const body = await readJson(request);
  const task = typeof body?.task === "string" ? body.task.trim().slice(0, 500) : "";
  if (!task) return Response.json({ error: "MISSING_TASK", message: "Say what you want the agent to buy." }, { status: 400 });

  const db = getDb();
  const stored = getLatestMandate(db, DEMO_USER_ID);
  if (!stored) return Response.json({ error: "NO_MANDATE", message: "Sign a mandate first." }, { status: 409 });
  const mode = getMode(db);
  const flow = getPurchaseFlow();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AgentEvent | { type: "start"; mandate_id: string; mode: string; defences: boolean }) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      const defences = body?.defences !== false;
      send({ type: "start", mandate_id: stored.mandate.id, mode, defences });
      try {
        await runShoppingAgentWithFallback({ flow, mandateId: stored.mandate.id, mode, defences, models: getModels(), task, onEvent: send });
      } catch (err) {
        console.error("Agent run failed:", err instanceof Error ? err.message : err);
        const busy = /quota|demand|overloaded|429|503/i.test(String(err instanceof Error ? err.message : err));
        send({ type: "error", message: busy ? "The AI model is busy or over its free quota. Wait a minute and try again." : "The agent run failed." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
