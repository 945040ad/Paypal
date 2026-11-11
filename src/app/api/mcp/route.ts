import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { connection } from "next/server";
import { getDb } from "@/db";
import { createVerdictMcpServer } from "@/mcp/server";
import { DEMO_USER_ID, getGate, getLedger, getPurchaseFlow } from "@/server";

/**
 * Verdict's MCP endpoint (Streamable HTTP, stateless): each request gets a fresh server and a JSON reply.
 * Add it to an MCP client as an HTTP server with the URL <APP_BASE_URL>/api/mcp.
 */
export async function POST(request: Request) {
  const server = createVerdictMcpServer({
    db: getDb(),
    ledger: getLedger(),
    gate: getGate(),
    flow: getPurchaseFlow(),
    userId: DEMO_USER_ID,
    baseUrl: (process.env.APP_BASE_URL ?? "").replace(/\/+$/, ""),
  });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}

/** No sessions and no server-initiated messages, so there is nothing to stream or to close. */
async function notAllowed() {
  await connection();
  return Response.json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed. POST JSON-RPC messages to this URL." }, id: null }, { status: 405, headers: { Allow: "POST" } });
}
export { notAllowed as GET, notAllowed as DELETE };
