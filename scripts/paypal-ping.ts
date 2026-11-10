/**
 * npm run paypal:ping
 * Checks the sandbox credentials by fetching an access token and printing when it expires.
 */
import { createPayPalClient, PAYPAL_SANDBOX_BASE_URL } from "../src/paypal/client";

async function main() {
  const client = createPayPalClient();
  const token = await client.getAccessToken();
  const minutes = Math.round((token.expiresAt - Date.now()) / 60_000);
  console.log(`PayPal sandbox OK (${PAYPAL_SANDBOX_BASE_URL})`);
  console.log(`Token expires at ${new Date(token.expiresAt).toISOString()} (in about ${minutes} minutes)`);
}

main().catch((err) => {
  console.error(`paypal:ping failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
