import Link from "next/link";

const STEPS = [
  {
    href: "/mandate",
    title: "Sign your rules",
    body: "Say in plain words what the agent may spend. Review the drafted rules, then sign them with a key that stays in this browser.",
    cta: "Open Mandate",
  },
  {
    href: "/agent",
    title: "Let the agent shop",
    body: "Ask it to buy something from the demo store. It can only propose; the gate checks each proposal against your signed rules and PayPal's sandbox takes the payment.",
    cta: "Open Agent",
  },
  {
    href: "/ledger",
    title: "Check the record",
    body: "See every step in the hash-chained ledger. Verify the chain, then tamper with a row and watch verification fail.",
    cta: "Open Ledger",
  },
  {
    href: "/disputes",
    title: "Settle a dispute",
    body: "When the buyer disputes a payment in PayPal, the ledger shows which side is right. File the proof, or refund without argument.",
    cta: "Open Disputes",
  },
];

export default function Home() {
  return (
    <main className="page">
      <p className="eyebrow">A flight recorder for AI agents that pay with PayPal</p>
      <h1 className="mt-2 max-w-3xl text-4xl font-semibold leading-tight tracking-tight">
        When an AI agent spends your money, who can prove what you allowed?
      </h1>
      <div className="mt-5 max-w-3xl space-y-2 text-lg leading-relaxed">
        <p>SYSTEM//AUDIT records what you allowed an AI shopping agent to do and what it actually did, in a log that cannot be quietly rewritten.</p>
        <p>Every purchase the agent proposes is checked by plain code against rules you signed, before PayPal moves any money.</p>
        <p>If a payment is later disputed, that record settles it for whichever side is right: proof for the seller, or a refund for the buyer.</p>
      </div>

      <p role="note" className="notice notice-warn mt-8 max-w-3xl">
        <span className="font-semibold">Sandbox only.</span> This demo runs on PayPal&apos;s sandbox with test accounts. No real money moves and the store sells
        nothing real.
      </p>

      <h2 className="mt-12 text-xl font-semibold">Try it in four steps</h2>
      <ol className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        {STEPS.map((step, i) => (
          <li key={step.href} className="card flex flex-col">
            <p className="font-mono text-sm text-accent">Step {i + 1}</p>
            <h3 className="mt-1 text-lg font-semibold">{step.title}</h3>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-muted">{step.body}</p>
            <Link href={step.href} className="btn mt-4 self-start">
              {step.cta}
            </Link>
          </li>
        ))}
      </ol>

      <h2 className="mt-12 text-xl font-semibold">The two disputes it settles</h2>
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <section className="card border-l-4 border-l-ok">
          <p className="eyebrow">Case A</p>
          <h3 className="mt-1 text-lg font-semibold">The purchase was inside the mandate</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            The agent bought within the signed rules and the buyer disputes it anyway. The desk builds an evidence PDF with the signed mandate, the
            signature check and the ledger extract, and files it with PayPal.
          </p>
          <p className="mt-3 text-sm font-semibold text-ok">The case settles for the seller.</p>
        </section>
        <section className="card border-l-4 border-l-bad">
          <p className="eyebrow">Case B</p>
          <h3 className="mt-1 text-lg font-semibold">The agent exceeded the mandate</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            The gate was only observing, the agent overspent, and the ledger holds a violation entry. The same record now speaks for the buyer: the
            desk accepts the claim and refunds in full.
          </p>
          <p className="mt-3 text-sm font-semibold text-bad">The buyer gets the money back.</p>
        </section>
      </div>

      <h2 className="mt-12 text-xl font-semibold">Who decides what</h2>
      <div className="card mt-4 overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line">
            <tr>
              <th scope="col" className="px-5 py-3 font-semibold">Job</th>
              <th scope="col" className="px-5 py-3 font-semibold">Done by</th>
              <th scope="col" className="px-5 py-3 font-semibold">Safeguard</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            <tr>
              <td className="px-5 py-3">Drafting your rules from a sentence</td>
              <td className="px-5 py-3">AI model</td>
              <td className="px-5 py-3 text-muted">You review and sign; nothing is stored unsigned</td>
            </tr>
            <tr>
              <td className="px-5 py-3">Searching the store and proposing a purchase</td>
              <td className="px-5 py-3">AI model</td>
              <td className="px-5 py-3 text-muted">It can only propose; page text is treated as untrusted</td>
            </tr>
            <tr>
              <td className="px-5 py-3">Allowing, escalating or blocking a payment</td>
              <td className="px-5 py-3 font-semibold">Plain code</td>
              <td className="px-5 py-3 text-muted">Seven rules checked against the signed mandate</td>
            </tr>
            <tr>
              <td className="px-5 py-3">Writing the ledger and moving money</td>
              <td className="px-5 py-3 font-semibold">Plain code</td>
              <td className="px-5 py-3 text-muted">Hash chain; PayPal&apos;s order is re-checked before capture</td>
            </tr>
            <tr>
              <td className="px-5 py-3">Deciding which side a dispute favours</td>
              <td className="px-5 py-3 font-semibold">Plain code</td>
              <td className="px-5 py-3 text-muted">Read straight from the ledger</td>
            </tr>
            <tr>
              <td className="px-5 py-3">Writing the evidence notes</td>
              <td className="px-5 py-3">AI model</td>
              <td className="px-5 py-3 text-muted">Code rejects any ledger entry it cites that does not exist</td>
            </tr>
          </tbody>
        </table>
      </div>
    </main>
  );
}
