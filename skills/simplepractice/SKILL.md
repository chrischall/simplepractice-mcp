---
name: simplepractice
description: >-
  Read a SimplePractice Client Portal through the simplepractice-mcp server —
  upcoming appointments, invoices/statements/superbills/receipts, balance and
  saved cards, paperwork waiting to be signed, and practice announcements.
  Use when the user asks about their therapy or healthcare appointments,
  what they owe a practice, a superbill for insurance, or forms their
  provider has sent them.
---

# SimplePractice Client Portal

`simplepractice-mcp` reads the Client Portal a practice gives its clients —
the patient side, not the clinician side. It is **read-only**: nothing here
cancels an appointment, signs a form, or pays a bill.

## Signing in

The portal has **no password**. SimplePractice emails a one-time link (or a
6-digit PIN), and that is the only way in.

1. `simplepractice_session_status` — check first; a session persists between
   runs, so most of the time there is nothing to do.
2. `simplepractice_request_sign_in_link` with the user's portal email. It is
   confirm-gated because it sends a real email and the endpoint is rate-limited
   **per address and per IP** — a retry loop locks the user out of the only
   auth path there is. Ask before sending, and never send twice.
3. The user opens the email and gives you the link. Pass it whole to
   `simplepractice_verify_sign_in_token` — it takes the token out of the
   fragment itself. Tokens are single-use and last 24 hours.

`SIMPLEPRACTICE_PRACTICE` must name the practice's portal — the slug or the
full `<practice>.clientsecure.me` host, from the link the provider emailed.
If it is unset, every tool says so on its first call.

There is no refresh token. When a session lapses the tools say to sign in
again; that means another email.

## Reading

- `simplepractice_get_account` — the practice, the current client, and the
  clients this login covers. **Start here**: one portal login can act for
  several people (a parent for two children), so confirm *whose* record you
  are about to report on before you report on it. It also returns the
  practice's real cancellation policy and the client's feature permissions.
- `simplepractice_list_appointments` — `status: "scheduled"` for confirmed and
  upcoming, `"requested"` for ones the practice has not confirmed yet.
- `simplepractice_list_document_requests` — paperwork. `outstandingOnly: true`
  answers "is anything waiting for me?", which is the usual question.
- `simplepractice_get_billing_overview` — balance due and per-category counts.
  Cheaper than listing the billing collections to find out they are empty.
- `simplepractice_list_billing_items` — invoices, statements, **superbills**
  (the receipt to claim out-of-network insurance), receipts, or account
  history. Pages by cursor: pass the returned `nextCursor` back as `before`.
- `simplepractice_list_payment_methods`, `simplepractice_list_documents`,
  `simplepractice_list_announcements`.

## Reading the results honestly

- **An empty billing list is a real answer.** Plenty of practices invoice
  entirely outside the portal. "No invoices in the portal" is the true
  statement; "you owe nothing" is not one you can make from it.
- **Do not tell someone they can cancel an appointment.** `isCancellable` and
  the practice's `clientMayCancelAppointments` / `cancellationNoticeHours`
  are what govern it, and cancelling has to happen in the portal anyway.
- **This is medical information.** Report what was asked. Don't volunteer
  diagnoses, session notes, or a family member's records into a conversation
  that wasn't about them.

## The shell alternative

`simplepractice-fpx` does the same reads with `curl` and no server, for
scripts or a machine without the MCP installed.
