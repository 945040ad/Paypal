/**
 * PayPal's own Agent Toolkit, limited to reading. The dispute analyst model may look up a dispute or an
 * order through it. It gets no tool that creates, pays, refunds or answers anything: money movement and
 * dispute actions stay in our own deterministic code.
 *
 * The toolkit ships tools in an older AI SDK shape (`parameters`), so they are adapted to the current one here.
 */
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";
import { tool, type ToolSet } from "ai";
import type { z } from "zod";
import { wrapUntrusted } from "./untrusted";

export const READ_ONLY_TOOLS = ["get_dispute", "list_disputes", "get_order"] as const;

type LegacyTool = { description?: string; parameters: z.ZodTypeAny; execute: (input: never, options: never) => Promise<unknown> };

/** Keeps only the read-only tools and marks everything they return as untrusted data. */
export function adaptReadOnlyTools(legacy: Record<string, LegacyTool>): ToolSet {
  const adapted: ToolSet = {};
  for (const name of READ_ONLY_TOOLS) {
    const source = legacy[name];
    if (!source) continue;
    adapted[name] = tool({
      description: `${source.description ?? name} (read-only)`,
      inputSchema: source.parameters as z.ZodType<unknown>,
      execute: async (input: unknown) => {
        try {
          const output = await source.execute(input as never, { toolCallId: name, messages: [] } as never);
          return wrapUntrusted(`paypal_${name}`, typeof output === "string" ? output : JSON.stringify(output));
        } catch {
          return `The PayPal record could not be read (${name}). Continue with the ledger extract you were given.`;
        }
      },
    }) as ToolSet[string];
  }
  return adapted;
}

/** The analyst's PayPal tools: sandbox, read-only. Only read actions are switched on in the toolkit itself, too. */
export function getPayPalReadTools() {
  if (process.env.PAYPAL_ENV !== "sandbox") throw new Error('PAYPAL_ENV must be "sandbox".');
  const toolkit = new PayPalAgentToolkit({
    clientId: process.env.PAYPAL_CLIENT_ID!,
    clientSecret: process.env.PAYPAL_CLIENT_SECRET!,
    configuration: { actions: { disputes: { list: true, get: true }, orders: { get: true } }, context: { sandbox: true } },
  } as ConstructorParameters<typeof PayPalAgentToolkit>[0]);
  return adaptReadOnlyTools(toolkit.getTools() as unknown as Record<string, LegacyTool>);
}
