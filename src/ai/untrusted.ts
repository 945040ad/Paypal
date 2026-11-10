/**
 * Marks text that came from outside (product pages, dispute messages, webhooks) so the model can tell it
 * apart from instructions. Any attempt inside the text to close or reopen the wrapper is defused.
 * This is a first line of defence only: the gate, not the model, decides whether a payment is allowed.
 */
export function wrapUntrusted(source: string, text: string): string {
  const safe = text.replace(/<(\/?untrusted_data)/gi, "&lt;$1");
  return `<untrusted_data source="${source}">\n${safe}\n</untrusted_data>`;
}
