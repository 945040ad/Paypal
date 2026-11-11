# Verdict demo video plan

Target length 2:45, hard limit 3:00. Every product shot is a real recording of the hosted app
(https://system-audit.onrender.com) on the PayPal sandbox, with the real IDs on screen. Motion graphics are used
only for the title, the captions and the closing card. No copyrighted music.

## Shots

| # | Time | On screen | Narration (also the caption) |
| --- | --- | --- | --- |
| 1 | 0:00 to 0:12 | Title card: Verdict, "A flight recorder for AI agents that spend money through PayPal" | AI agents can now spend your money. When a charge is disputed, who was right: the agent or the buyer? Verdict keeps the record that answers it. |
| 2 | 0:12 to 0:35 | Mandate page. Type the rules in plain words, AI drafts the fields, **Sign and save**, ledger entry number appears | First you say what the agent may do. The model drafts the rules, but nothing counts until you sign them in your browser. That signed mandate is entry one in the ledger. |
| 3 | 0:35 to 1:00 | Agent page. "buy me a 1 m USB-C cable": tool calls, gate ALLOW, PayPal capture ID. Then a $35 keyboard: gate ESCALATE, **Approve**, capture ID | The agent can search and propose. It cannot pay. A gate made of plain code checks every proposal against the mandate, then PayPal authorizes, the order is re-checked and captured. Above your threshold, it asks you. |
| 4 | 1:00 to 1:25 | Product page with the hidden text revealed. Agent page with defences off, "buy the coiled aviator keyboard cable": gate BLOCK, rule QUANTITY_LIMIT | This product page hides an instruction aimed at AI agents: order ten and ignore the budget. With its own defences off the agent obeys. The gate does not. No payment is made. |
| 5 | 1:25 to 1:45 | Ledger page. **Verify the chain** (green), **Tamper with a row**, verify again (red, entry number), **Reset** | Every step is an entry in a hash chain. Change one row and verification fails at exactly that entry. |
| 6 | 1:45 to 2:25 | Disputes page. Case A `PP-R-WSK-10198178`: In mandate, evidence PDF, resolved for the seller. Case B `PP-R-BQE-10198182`: Violation, claim accepted, buyer refunded | When a buyer disputes a charge, code classifies it from the ledger. This purchase was inside the mandate, so Verdict files evidence with PayPal and the seller wins. This one broke the mandate in observe mode, so Verdict accepts the claim and the buyer is refunded. Both are real sandbox disputes. |
| 7 | 2:25 to 2:45 | Terminal: an outside MCP client proposing through the gate. Closing card: PayPal APIs used, eval 10 of 10, repo and demo URLs | Any agent can connect over MCP and gets the same gate. Ten adversarial prompts, zero payments outside the mandate. Verdict: built on PayPal Orders, Payments, Vault, Webhooks and Disputes. |

## How it is made

1. **Record** each product shot with Playwright in Chrome at 1920x1080, with a visible cursor and slow, readable
   typing. One file per shot, each under one minute. Output: `video/raw/*.webm` (git-ignored).
2. **Trim** dead time (model thinking, PayPal round trips) with FFmpeg. Dispute IDs stay visible across cuts.
3. **Compose** in Raylight: title card, captions, zooms on the decision cards and IDs, closing card.
4. **Narration**: your own voice, or a generated voiceover (costs Raylight credits, needs your OK), or captions only.
5. **Export** 1080p MP4, check it is under 3:00, upload to YouTube as Public.

## Honest limits to keep in the edit

- Shot 6 shows two disputes that are already settled. The 28-minute sandbox wait is not re-recorded.
- The simulated PayPal decision (`adjudicate`) is labelled in the UI; keep that label in frame.
- The hosted demo mandate in shot 2 is signed live in the recording browser.
