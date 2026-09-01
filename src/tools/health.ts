import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerCredentialHealthcheckTool } from '@chrischall/mcp-utils/healthcheck';
import type { SimplePracticeClient } from '../client.js';

/**
 * `simplepractice_healthcheck` — the one call that answers "is this connector
 * working?", and the only tool here that reports a failure as DATA rather
 * than throwing.
 *
 * `simplepractice_session_status` is NOT this, and the difference is the
 * reason this exists: its own description says it "reads local state only —
 * makes no network call". So it reports `signedIn: true` for a session the
 * portal has already killed. That is the worst shape of health signal — a
 * confident yes that is wrong precisely when someone is asking because
 * something is broken.
 *
 * This makes one authenticated round-trip, so `ok: true` means the portal
 * accepted the session just now, not that a cookie exists on disk.
 */

/**
 * Strings this classifier matches, kept as named constants because they are a
 * CONTRACT WITH client.ts, not free text. `tests/health.test.ts` asserts each
 * one still appears in that file: the first version of this classifier matched
 * invented text that no code path ever produced, and every unit test passed
 * because the tests fabricated errors to match the classifier instead of the
 * client.
 */
export const CLIENT_ERROR_TEXT = {
  /** From client.ts `requireConfig()` — thrown by `portalHost()`. */
  noPractice: 'I do not know which practice portal to talk to yet',
  /** From client.ts `throwForStatus()` 401/403, on the HINT — not the message. */
  sessionExpired: 'The portal session has expired',
  /** From client.ts `requireSession()`, on the MESSAGE. */
  notSignedIn: 'Not signed in to the SimplePractice Client Portal',
  /** From client.ts `throwForStatus()` 429, on the HINT. */
  rateLimited: 'SimplePractice rate-limits sign-in requests',
} as const;

export function classifySimplePracticeError(err: unknown): { kind: string; hint?: string } | undefined {
  // The client raises McpToolError, which carries its remediation on `.hint`
  // and a formatted JSON:API summary on `.message`. A 401 says nothing useful
  // in the message, so BOTH must be searched — matching only `.message` is
  // exactly the bug the auto-review on #13 caught.
  const message = err instanceof Error ? err.message : String(err);
  const hint = typeof (err as { hint?: unknown })?.hint === 'string' ? (err as { hint: string }).hint : '';
  const text = `${message}\n${hint}`;

  if (text.includes(CLIENT_ERROR_TEXT.noPractice)) {
    return {
      kind: 'no_practice_host',
      hint:
        'No practice known yet. Paste the sign-in link your provider emailed into ' +
        'simplepractice_verify_sign_in_token — its address names the practice, and this server remembers ' +
        'it afterwards. SIMPLEPRACTICE_PRACTICE is optional, and only pins the server to one practice.',
    };
  }
  // Rate limiting is checked BEFORE the session arms: a 429 is the far side
  // working correctly, and this one is punishing — retrying can lock the
  // account out of the only auth path it has.
  if (text.includes(CLIENT_ERROR_TEXT.rateLimited)) {
    return {
      kind: 'rate_limited',
      hint:
        'SimplePractice rate-limits sign-in requests per email and per IP. The session is not necessarily bad — ' +
        'do NOT retry, and wait before requesting another link.',
    };
  }
  if (text.includes(CLIENT_ERROR_TEXT.sessionExpired) || text.includes(CLIENT_ERROR_TEXT.notSignedIn)) {
    return {
      kind: 'session_expired',
      hint:
        'The portal rejected the stored session. There is no refresh token, so it cannot be renewed silently: ' +
        'run simplepractice_request_sign_in_link, then pass the part of the emailed link after the "#" to ' +
        'simplepractice_verify_sign_in_token.',
    };
  }
  return undefined;
}

export function registerHealthcheckTools(server: McpServer, client: SimplePracticeClient): void {
  registerCredentialHealthcheckTool({
    server,
    prefix: 'simplepractice',
    hostLabel: 'clientsecure.me',
    probePath: '/environment',
    resolveCredential: async () => {
      const session = client.getSession();
      // `source: null` short-circuits the probe. Without a session there is
      // nothing to test, and probing anyway returns a failure that reads like
      // a rejected session rather than an absent one.
      return {
        source: session ? 'portal_session' : null,
        detail: {
          // `knownPortalHost`, not `portalHost`: the latter throws, and not
          // knowing the practice is the ordinary state before anyone has
          // pasted a sign-in link. A healthcheck that throws where it should
          // report `practice_host: null` fails at the one job it has — saying
          // which hop is broken.
          practice_host: client.knownPortalHost(),
          // When the session was minted — the fact that explains a connector
          // that worked yesterday and does not today. Never the cookie.
          signed_in_at: session?.createdAt ?? null,
        },
      };
    },
    // The cheapest authenticated read in the portal, and the one the client
    // already uses to resolve the current client id. It changes nothing: no
    // appointment booked, no document touched.
    probeFn: () => client.list('/environment', { include: 'currentClient' }),
    classifyThrown: classifySimplePracticeError,
  });
}
