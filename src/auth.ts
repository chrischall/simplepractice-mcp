import { CookieJar, McpToolError } from '@chrischall/mcp-utils';
import { practiceHostFromLink } from './config.js';
import type { SimplePracticeClient } from './client.js';

/** The Rails/Devise session cookie the portal authenticates with. */
export const SESSION_COOKIE = 'simplepractice-session';

export interface VerifyResult {
  status: string;
  signedIn: boolean;
  /** Which practice the session was established with — worth echoing back
   * when the link, not the configuration, is what determined it. */
  practiceHost: string;
}

/**
 * Ask SimplePractice to email a sign-in link.
 *
 * The response always reports a 24-hour lifetime and always succeeds for a
 * well-formed address — deliberately, so that it cannot be used to probe
 * whether an email has an account. A 202 is therefore NOT evidence the address
 * is registered, and the tool description says so.
 */
export async function requestSignInLink(
  client: SimplePracticeClient,
  email: string
): Promise<{ expiresIn: string }> {
  const { document } = await client.request('/sign-in-tokens', {
    method: 'POST',
    anonymous: true,
    body: {
      data: { type: 'sign-in-tokens', attributes: { email, expiresIn: '15 minutes' } },
    },
  });
  const data = Array.isArray(document.data) ? document.data[0] : document.data;
  const expiresIn = (data?.attributes?.expiresIn as string | undefined) ?? '24 hours';
  return { expiresIn };
}

function extractToken(raw: string): string {
  const trimmed = raw.trim();
  // Users paste the whole emailed link about as often as just the token, and
  // the token is the URL FRAGMENT — a browser never sends it, so there is no
  // way to recover it from anything but the link text itself.
  const hash = trimmed.indexOf('#');
  // A link with NO fragment is not a token-bearing link: the token lives only
  // in the fragment, so accepting the bare URL here would POST the whole URL
  // as if it were the token and report a confusing upstream rejection.
  if (hash < 0 && /^https?:\/\//i.test(trimmed)) {
    throw new McpToolError('That sign-in link has no token in it.', {
      hint: 'The token is the part after the "#". Copy the link straight out of the email — some mail clients drop the fragment when they rewrite links, in which case open the email in a browser and copy the address from the address bar.',
    });
  }
  const token = hash >= 0 ? trimmed.slice(hash + 1) : trimmed;
  if (!token || /\s/.test(token) || token.includes('/')) {
    throw new McpToolError('That does not look like a sign-in token.', {
      hint: 'Paste either the whole link from the email or just the part after the "#". The token is the URL fragment — following the link in a browser will not reveal it to anything else.',
    });
  }
  return token;
}

async function establishSession(
  client: SimplePracticeClient,
  attributes: Record<string, string>
): Promise<VerifyResult> {
  const path = `/sessions/${attributes.type}`;
  const { document, setCookie } = await client.request(path, {
    method: 'POST',
    anonymous: true,
    body: { data: { type: 'sessions', attributes } },
  });

  const data = Array.isArray(document.data) ? document.data[0] : document.data;
  const status = (data?.meta as { status?: string } | undefined)?.status ?? 'unknown';

  if (status !== 'verified') {
    throw new McpToolError(`SimplePractice did not accept the sign-in: ${status}.`, {
      hint:
        status === 'expired'
          ? 'Sign-in links last 24 hours. Request a new one.'
          : 'Sign-in tokens and PINs are single-use. Request a new one rather than reusing the last.',
    });
  }

  const jar = new CookieJar();
  jar.absorb(setCookie);
  const cookie = jar.get(SESSION_COOKIE);
  if (!cookie) {
    throw new McpToolError('Sign-in verified but no session cookie came back.', {
      hint: `Expected a ${SESSION_COOKIE} cookie on the response. If SimplePractice has renamed it, simplepractice-mcp needs updating.`,
    });
  }

  const session = client.saveSession(`${SESSION_COOKIE}=${cookie}`);
  return { status, signedIn: true, practiceHost: session.host };
}

/**
 * Trade an emailed sign-in link for a session — and take the practice from the
 * link while we are at it.
 *
 * The link is `https://<practice>.clientsecure.me/sign-in/token#<TOKEN>`, so
 * the same paste that carries the token also says which portal to send it to.
 * That is the only ordering that can work when the link and the configuration
 * disagree: the token was minted for the practice in the link, and posting it
 * anywhere else is a 401.
 *
 * A link that names no practice — the mobile variant at the bare apex, or a
 * bare token — falls back to whatever practice is already known.
 */
// `async` so that the pre-flight rejections below reach a caller the same way
// the network ones do, rather than throwing synchronously out of a function
// that otherwise returns a promise.
export async function verifySignInToken(
  client: SimplePracticeClient,
  linkOrToken: string
): Promise<VerifyResult> {
  const attributes = { type: 'token', token: extractToken(linkOrToken) };
  const fromLink = practiceHostFromLink(linkOrToken);
  // Scoped, so a link that fails to verify does not leave the process pointed
  // at its practice — links are single-use, so failing is the ordinary case.
  if (fromLink) {
    return client.withPracticeHost(fromLink, () => establishSession(client, attributes));
  }
  // No practice in the link, so it has to be known already: resolve before
  // posting, or a single-use token is spent against a guess.
  client.portalHost();
  return establishSession(client, attributes);
}

export function verifySignInPin(
  client: SimplePracticeClient,
  email: string,
  pin: string
): Promise<VerifyResult> {
  return establishSession(client, { type: 'pin', email, pin });
}

export { extractToken as _extractToken };
