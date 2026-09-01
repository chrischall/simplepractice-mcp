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

export function classifySimplePracticeError(err: unknown): { kind: string; hint?: string } | undefined {
  const msg = err instanceof Error ? err.message : String(err);

  if (msg.includes('PRACTICE_HOST')) {
    return {
      kind: 'no_practice_host',
      hint: 'No practice host configured. Set the practice subdomain (e.g. yourpractice.clientsecure.me) before signing in.',
    };
  }
  // The portal has no refresh token: an expired session cannot be renewed
  // silently, so the only fix is a fresh emailed sign-in link.
  if (msg.includes('session has expired') || msg.includes('Not signed in')) {
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
          practice_host: client.portalHost(),
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
