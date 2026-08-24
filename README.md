# simplepractice-mcp

MCP server for the **SimplePractice Client Portal** — the side a practice's
*clients* log into, not the clinician side. Appointments, billing, paperwork,
and announcements, read over the portal's own JSON:API.

> Developed and maintained by AI (Claude Code). Use at your own discretion.

## What it reads

| Tool | What it gives you |
|---|---|
| `simplepractice_get_account` | practice, current client, every client this login covers, cancellation policy, feature permissions |
| `simplepractice_list_appointments` | scheduled or requested appointments, with clinician and location |
| `simplepractice_list_billing_items` | invoices · statements · superbills · receipts · account history |
| `simplepractice_get_billing_overview` | balance due and per-category counts |
| `simplepractice_list_payment_methods` | saved cards — brand, last four, expiry |
| `simplepractice_list_document_requests` | paperwork sent to you, with an outstanding-only filter |
| `simplepractice_get_document_request` | one request in full, with its questions and answers |
| `simplepractice_list_documents` | files the practice has shared |
| `simplepractice_list_announcements` | practice announcements, with unread counts |
| `simplepractice_session_status` · `_request_sign_in_link` · `_verify_sign_in_token` · `_verify_sign_in_pin` · `_sign_out` | sign-in |

Everything is read-only. Cancelling, signing, and paying happen in the portal.

## Setup

```sh
npm install -g simplepractice-mcp
export SIMPLEPRACTICE_PRACTICE=achievebalancetherapy   # or the full host
```

`SIMPLEPRACTICE_PRACTICE` is the practice's portal address — the slug or the
whole `<practice>.clientsecure.me` host from the link your provider emailed.

| Variable | |
|---|---|
| `SIMPLEPRACTICE_PRACTICE` | **required** — portal slug or host |
| `SIMPLEPRACTICE_SESSION_FILE` | optional — session path (default `~/.simplepractice-mcp/session.json`, written `0600`) |

## Signing in

The Client Portal has **no password**. SimplePractice emails a one-time link
(or a 6-digit PIN); you trade it for a session cookie:

1. `simplepractice_request_sign_in_link { email, confirm: true }`
2. Open the email, copy the link.
3. `simplepractice_verify_sign_in_token { link }` — pass the whole link; the
   token is its `#` fragment and the tool extracts it.

Links are single-use and last 24 hours. The request endpoint is rate-limited
per address **and** per IP, which is why sending is confirm-gated — a retry
loop locks you out of the only way in. There is no refresh token: when the
session lapses, you sign in again.

Because that flow needs nothing but HTTP and your inbox, this server has no
browser dependency and can run anywhere.

## Without the server

`skills/simplepractice-fpx` does the same reads with `curl`, either signing in
by magic link or lifting the session cookie from a browser tab with
[`fpx`](https://www.npmjs.com/package/@fetchproxy/cli).

## Notes from building this

The portal is an Ember app that ships **public sourcemaps**, so its models,
adapters and routes are readable directly — `docs/SIMPLEPRACTICE-API.md`
records the endpoints and the traps, all confirmed against a live portal:

- The SPA catch-all answers **HTTP 200 with `text/html`** for any path the API
  does not define. `/cards` and `/client-billing-overviews` look like working,
  empty endpoints and are not endpoints at all — both are `include`
  relationships of `/clients/<id>`.
- `hasDocumentPdf`, a card's `isDefault`, and the client's `permissions` blob
  are all **strings**, not booleans or objects.
- Billing pages by *cursor* (`page[before]` = a row's `cursorId`), appointments
  page by *number*. The two are not interchangeable.

## Development

```sh
npm install
npm run build
npm test              # 151 tests
npm run test:coverage # 100% enforced
npm run typecheck     # vitest does not run tsc — this does
```

## License

MIT
