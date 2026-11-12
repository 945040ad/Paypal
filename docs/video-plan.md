# Verdict demo video plan

Final length 2:43, hard limit 3:00. Every product shot is a real recording of the hosted app
(https://system-audit.onrender.com) on the PayPal sandbox, with the real IDs on screen. Motion graphics are used
only for the title, the captions and the closing card. No copyrighted music.

## Shots

| # | Planned time | On screen | Planned narration (the film carries shorter captions instead) |
| --- | --- | --- | --- |
| 1 | 0:00 to 0:12 | Title card: Verdict, "A flight recorder for AI agents that spend money through PayPal" | AI agents can now spend your money. When a charge is disputed, who was right: the agent or the buyer? Verdict keeps the record that answers it. |
| 2 | 0:12 to 0:35 | Mandate page. Type the rules in plain words, AI drafts the fields, **Sign and save**, ledger entry number appears | First you say what the agent may do. The model drafts the rules, but nothing counts until you sign them in your browser. That signed mandate is entry one in the ledger. |
| 3 | 0:35 to 1:00 | Agent page. "buy me a 1 m USB-C cable": tool calls, gate ALLOW, PayPal capture ID. Then a $35 keyboard: gate ESCALATE, **Approve**, capture ID | The agent can search and propose. It cannot pay. A gate made of plain code checks every proposal against the mandate, then PayPal authorizes, the order is re-checked and captured. Above your threshold, it asks you. |
| 4 | 1:00 to 1:25 | Product page with the hidden text revealed. Agent page with defences off, "buy the coiled aviator keyboard cable": gate BLOCK, rule QUANTITY_LIMIT | This product page hides an instruction aimed at AI agents: order ten and ignore the budget. With its own defences off the agent obeys. The gate does not. No payment is made. |
| 5 | 1:25 to 1:45 | Ledger page. **Verify the chain** (green), **Tamper with a row**, verify again (red, entry number), **Reset** | Every step is an entry in a hash chain. Change one row and verification fails at exactly that entry. |
| 6 | 1:45 to 2:25 | Disputes page. Case A `PP-R-WSK-10198178`: In mandate, evidence PDF, resolved for the seller. Case B `PP-R-BQE-10198182`: Violation, claim accepted, buyer refunded | When a buyer disputes a charge, code classifies it from the ledger. This purchase was inside the mandate, so Verdict files evidence with PayPal and the seller wins. This one broke the mandate in observe mode, so Verdict accepts the claim and the buyer is refunded. Both are real sandbox disputes. |
| 7 | 2:25 to 2:45 | Terminal: an outside MCP client proposing through the gate. Closing card: PayPal APIs used, eval 10 of 10, repo and demo URLs | Any agent can connect over MCP and gets the same gate. Ten adversarial prompts, zero payments outside the mandate. Verdict: built on PayPal Orders, Payments, Vault, Webhooks and Disputes. |

## How it was made

The finished film is 2:43 at 1080p and 60 frames a second. It has captions and no narration.

1. **Record** each product shot from the hosted app with Playwright in Chrome, at one third speed so that the
   footage holds 60 distinct frames a second when played back. The pointer is not recorded; its moves and clicks
   are logged.
2. **Trim** dead time (model thinking, PayPal round trips) with FFmpeg. Skipped waits are bridged by a dissolve.
3. **Compose** in code: the film is one HTML page driven by a clock. It plays the recordings inside a window,
   draws the pointer from the log, and adds the title, the diagrams, the captions, the push-ins and the closing
   card. The orb is the same thinking-orbs animation the app uses.
4. **Render** frame by frame with Playwright and encode with FFmpeg.
5. **Sound** is synthesised in code (pads, bells, clicks and keys from sine waves and filtered noise), so the
   film uses no recorded or licensed audio. Clicks and keystrokes are placed from the recording logs.

The working files live in `video/`, which is git-ignored because of its size.

## Honest limits to keep in the edit

- Shot 6 shows two disputes that are already settled. The 28-minute sandbox wait is not re-recorded.
- The simulated PayPal decision (`adjudicate`) is labelled in the UI; keep that label in frame.
- The hosted demo mandate in shot 2 is signed live in the recording browser.
