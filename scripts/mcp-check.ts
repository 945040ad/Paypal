/**
 * npm run mcp:check [-- <url>] [--buy] [--escalate]
 *
 * Connects to Verdict's MCP endpoint the way any MCP client would and exercises it: lists the tools, reads the
 * spending status and verifies the ledger. With --buy it also proposes one 1 m USB-C cable ($9), which moves
 * real sandbox money if the gate allows it. With --escalate it proposes a $35 keyboard, which the standard
 * mandate leaves waiting for the person.
 *
 * The URL defaults to http://localhost:3000/api/mcp.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith("http")) ?? "http://localhost:3000/api/mcp";

async function main() {
  const client = new Client({ name: "verdict-mcp-check", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  console.log(`Connected to ${url}`);

  const tools = (await client.listTools()).tools.map((t) => t.name);
  console.log(`Tools: ${tools.join(", ")}`);

  const call = async (name: string, input: Record<string, unknown> = {}) => {
    const res = await client.callTool({ name, arguments: input });
    const text = (res.content as { text: string }[])[0]?.text ?? "";
    console.log(`\n${name}(${JSON.stringify(input)})${res.isError ? " [error]" : ""}\n${text}`);
    return JSON.parse(text);
  };

  await call("get_spending_status");
  if (args.includes("--buy")) await call("propose_purchase", { product_id: "cable-usbc-1m", quantity: 1 });
  if (args.includes("--escalate")) await call("propose_purchase", { product_id: "kb-tactile-75", quantity: 1 });
  await call("propose_purchase", { product_id: "cable-usbc-1m", quantity: 10 }); // always blocked: over the quantity limit
  await call("get_ledger", { limit: 6 });
  const verify = await call("verify_ledger");
  await client.close();
  if (!verify.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
