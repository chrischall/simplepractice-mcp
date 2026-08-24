# SimplePractice Client Portal API

Base: `https://<practice>.clientsecure.me/client-portal-api`

Ember Data JSON:API. Shapes below came from the portal's **public sourcemaps**
(`https://widget-cdn.simplepractice.com/assets/<chunk>.js.map`, gzipped, with
full `sourcesContent`) and were then confirmed against a live signed-in portal
through this repo's own built client. Anything not confirmed says so.

To re-derive after a SimplePractice deploy: read the chunk filenames out of the
portal HTML's `<script src>` tags, fetch each `.js.map`, `gunzip`, and write out
`sourcesContent`. `adapters/application.js` holds the namespace and headers,
`models/*.js` every attribute, `routes/site/**` the filters each screen sends.

## Required headers

| Header | Value |
|---|---|
| `Api-Version` | `2026-05-25` |
| `Application-Build-Version` | `0.0.0` |
| `Application-Platform` | `web` |
| `Accept` | `application/vnd.api+json` |

Omitting `Application-Build-Version` is a hard
`400 {"title":"Application build version is missing"}` — confirmed. The API
only checks presence, not the value.

Auth is the `simplepractice-session` cookie (Rails/Devise). The app also sends
a `Session-Id` header from its own local session store; it is not required.

## Two naming systems

URL paths are **dashed plural**; JSON:API `type` values are **camelCase
plural**. `/sign-in-tokens` → `signInTokens`; `/document-requests` →
`documentRequestQuestionnaires` &c. `/environment` is the one singular path.

## A 200 is not proof an endpoint exists

The SPA catch-all serves the Ember app shell — **HTTP 200, `text/html`, a
constant ~7,515 bytes** — for every path the API does not define. There is no
404. `/cards` and `/client-billing-overviews` are the natural guesses for the
balance and card data and both answer exactly this way; they are not endpoints.

Always branch on `content-type`, never on status.

## Auth

| Call | Body | Result |
|---|---|---|
| `POST /sign-in-tokens` | `{data:{type:'sign-in-tokens',attributes:{email,expiresIn}}}` | `202`, emails a link. Confirmed live. |
| `POST /sessions/token` | `{data:{type:'sessions',attributes:{type:'token',token}}}` | sets `simplepractice-session`; `data.meta.status` ∈ `verified`/`expired`/`merged` |
| `POST /sessions/pin` | `{data:{type:'sessions',attributes:{type:'pin',email,pin}}}` | same; PIN is `^\d{6}$` |

The emailed link is **`https://<practice>.clientsecure.me/sign-in/token#<TOKEN>`**
— note `/sign-in/token`, *not* the `sign-in/token/verify` the Ember route tree
suggests. SimplePractice also sends a mobile-app variant pointing at the bare
apex under the API namespace, `https://clientsecure.me/client-portal-api/sign-in/token#<TOKEN>`.
Both carry the token the same way, so take the fragment and ignore the path.

The token is the **URL fragment**, which a browser never transmits, so it can
only come from the link text. Observed length 303–317 characters.

Tokens are single-use — confirmed by replay, which answers
`401 "Authorization has already been used or expired"`. Note that this is a
**401 on a sign-in endpoint**, where the caller has no session yet, so it must
not be reported as "your session expired".

`429` carries two distinct titles, `Email request limit reached` and
`IP request limit reached`. Never retry: this is the only auth path the portal
has. No captcha guards sign-in (reCAPTCHA appears only on the prospective-client,
waitlist and contact forms), which is what makes headless auth possible.

**Confirmed live, end to end:** `POST /sign-in-tokens` (202) → the emailed
link → `POST /sessions/token` returning `data.meta.status: "verified"` and a
`Set-Cookie: simplepractice-session` (~697 characters) → an authenticated read
with that freshly minted session. Replaying the same token then failed as
above, confirming single use.

## Endpoints confirmed live

| Path | Notes |
|---|---|
| `GET /environment?include=currentPractice,currentClient,currentClientOptions,currentClientAccess` | `currentClientOptions` is an **array** — one login can act for several clients |
| `GET /clients/<id>?include=clientBillingOverview,unpaidInvoices,cards` | where the balance summary and saved cards actually live |
| `GET /appointments?include=clinician,office,client&filter[hasPendingConfirmation]=<bool>&page[number]=&page[size]=` | `false` = scheduled, `true` = requested |
| `GET /billing-items?filter[thisType]=<kind>&page[size]=&page[before]=` | `invoice`/`statement`/`superbill`/`receipt`, or `billable-item,payment` + `filter[thisTypeCondition]=unallocated` |
| `GET /document-requests?page[size]=` · `GET /document-requests/<id>` | subtype is the `type` field |
| `GET /documents?page[size]=` | files shared with the client |
| `GET /announcements?page[size]=` | `readAt: null` = unread |

Max page size is 50.

## Pagination — two schemes

- **Appointments**: by number, `page[number]` + `page[size]`.
- **Billing items**: by cursor, backwards — `page[before]=<row.cursorId>`. The
  cursor is the row's `cursorId` attribute, **not** its `id`.

Neither returns a total. A short page is the last page.

## Fields that are not the type they look like

| Field | Wire type | Why it matters |
|---|---|---|
| `documentRequests[].hasDocumentPdf` | string `"true"`/`"false"` | `if (x)` is true for `"false"`. Live: naive filter matched 10/10, correct 5/10 |
| `cards[].isDefault` | string `"true"`/`"false"` | same trap; would mark every card default |
| `clients[].permissions` | JSON **string** | parses to `{messaging, selfScheduling, billingDocuments, payments, appointments}`; `billingDocuments` gates the billing tab |

`models/document-request.js` declares `@attr('boolean') hasDocumentPdf` — Ember
casts client-side, so the declared type is **not** evidence of the wire type.

## Other observations

- `clients[].email` is `null` on a login acting for someone else; the sign-in
  address belongs to the client *access*, not the client.
- Document request statuses: `sent` · `viewed` · `reviewing` · `completed` ·
  `locked`. Nine subtypes (`documentRequestConsentDocuments`,
  `documentRequestQuestionnaires`, `documentRequestContactInfos`,
  `documentRequestInsuranceInfos`, `documentRequestCreditCardInfos`,
  `documentRequestStoredDocuments`, `documentRequestNotes`,
  `documentRequestGoodFaithEstimates`, `documentRequestPostSessionSummaries`).
- `offices[].isVideo` marks a telehealth "room" rather than an address.
- Every `billing-items` response carries `meta.endBalance`.
- An empty billing collection is normal — many practices bill outside the
  portal entirely.

## Not covered

Secure messaging is a **different service** —
`https://messaging-api.simplepractice.com`, models `messagingConversation` /
`messagingMessage` / `messagingContact` / `messagingProfile` /
`messagingUser`, gated on the practice's `featureSecureMessagingEmber`. Its
request shapes were not captured; do not guess them.

Writes (cancel, submit a document, pay) are deliberately out of scope.
