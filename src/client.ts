import { McpToolError, messageOf, truncateErrorMessage } from '@chrischall/mcp-utils';
import { SessionStore } from '@chrischall/mcp-utils/session';
import {
  API_NAMESPACE,
  API_VERSION,
  APPLICATION_BUILD_VERSION,
  APPLICATION_PLATFORM,
  readPortalHost,
  resolvePortalHost,
  sessionFilePath,
} from './config.js';
import {
  flattenDocument,
  formatJsonApiErrors,
  type JsonApiDocument,
} from './jsonapi.js';

export interface PortalSession extends Record<string, unknown> {
  host: string;
  cookie: string;
  createdAt: string;
}

const JSON_API_MEDIA_TYPE = 'application/vnd.api+json';

/** Which query strings the portal builds as nested `filter[a][b]=` pairs. */
export type QueryValue =
  | string
  | number
  | boolean
  | undefined
  | Record<string, string | number | boolean>;

export function buildQuery(params: Record<string, QueryValue>): string {
  const pairs: string[] = [];
  const push = (key: string, value: string | number | boolean) =>
    pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (value !== null && typeof value === 'object') {
      for (const [sub, subValue] of Object.entries(value)) push(`${key}[${sub}]`, subValue);
    } else {
      push(key, value);
    }
  }
  return pairs.join('&');
}

export interface RequestOptions {
  method?: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
  /** Auth calls are the only ones allowed to run without a stored session. */
  anonymous?: boolean;
}

/** Where the practice host in play was learned from. */
export type PracticeSource = 'link' | 'environment' | 'session';

export class SimplePracticeClient {
  private readonly store: SessionStore<PortalSession>;
  private readonly fetchImpl: typeof fetch;
  /** A practice learned at runtime — from a sign-in link, or named on a tool call. */
  private adoptedHost: string | null = null;

  constructor(opts: { fetchImpl?: typeof fetch; store?: SessionStore<PortalSession> } = {}) {
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.store =
      opts.store ??
      new SessionStore<PortalSession>({
        filePath: sessionFilePath(),
        keyOf: (session) => session.host,
        normalizeKey: (key) => key.toLowerCase(),
      });
  }

  /**
   * Which practice this server is talking to, and how it found out.
   *
   * Resolved per call rather than fixed at construction, because the practice
   * is usually not known when the process starts: it arrives with the sign-in
   * link. In order:
   *
   *  1. **link** — adopted at runtime from the emailed link (or named on the
   *     tool call). The most recent explicit statement of intent, and the only
   *     one that can be right when a token is minted for a different practice
   *     than the environment names.
   *  2. **environment** — `SIMPLEPRACTICE_PRACTICE`, an explicit pin for
   *     someone who wants this server bound to one practice.
   *  3. **session** — the practice of the stored session. This is what makes
   *     the link route survive a restart: sign in once, and every later
   *     process knows the practice with no configuration at all.
   */
  private resolveHost(): { host: string; source: PracticeSource } | null {
    if (this.adoptedHost) return { host: this.adoptedHost, source: 'link' };
    const configured = readPortalHost();
    if (configured) return { host: configured, source: 'environment' };
    const remembered = this.store.getActiveSession()?.host;
    return remembered ? { host: remembered, source: 'session' } : null;
  }

  /** The practice host, or `null` when none is known yet. Never throws. */
  knownPortalHost(): string | null {
    return this.resolveHost()?.host ?? null;
  }

  /** How the practice was determined, or `null` when it has not been. */
  practiceSource(): PracticeSource | null {
    return this.resolveHost()?.source ?? null;
  }

  /**
   * Point this server at a practice for the rest of the process — what the
   * sign-in link's own host feeds.
   *
   * Validated through the same `resolvePortalHost` the environment goes
   * through, so a link outside `*.clientsecure.me` cannot redirect a token.
   */
  adoptPracticeHost(raw: string): string {
    const host = resolvePortalHost(raw);
    if (!host) {
      throw new McpToolError(`"${raw}" is not a SimplePractice Client Portal address.`, {
        hint: 'A portal address is a single practice under clientsecure.me — the slug ("achievebalancetherapy") or the whole host ("achievebalancetherapy.clientsecure.me").',
      });
    }
    this.adoptedHost = host;
    return host;
  }

  /**
   * The practice host, or the deferred error explaining that none is known.
   *
   * Deferred rather than thrown at construction: the server must still boot
   * (and answer the host's install-time tools/list probe) knowing no practice,
   * which is now the ordinary first-run state rather than a misconfiguration.
   */
  private requireConfig(): string {
    const host = this.knownPortalHost();
    if (!host) {
      throw new McpToolError('I do not know which practice portal to talk to yet.', {
        hint: 'Paste the sign-in link your provider emailed into simplepractice_verify_sign_in_token — its address names the practice, and this server remembers it. To ask for that link first, pass `practice` to simplepractice_request_sign_in_link, or set SIMPLEPRACTICE_PRACTICE to pin this server to one practice.',
      });
    }
    return host;
  }

  portalHost(): string {
    return this.requireConfig();
  }

  getSession(): PortalSession | null {
    const host = this.knownPortalHost();
    return host ? this.store.get(host) : null;
  }

  saveSession(cookie: string): PortalSession {
    const host = this.requireConfig();
    const session: PortalSession = { host, cookie, createdAt: new Date().toISOString() };
    this.store.add(session);
    return session;
  }

  clearSession(): boolean {
    const host = this.knownPortalHost();
    // Not knowing the practice is the same outcome as having no session for
    // it: nothing to sign out of. Throwing would make sign-out the one tool
    // that fails when it has nothing to do.
    return host ? this.store.remove(host) : false;
  }

  private requireSession(): PortalSession {
    const session = this.getSession();
    if (!session) {
      // McpToolError rather than SessionNotAuthenticatedError: that subclass's
      // constructor is (service, signInHost) and composes its own message, and
      // the two-step remediation below is worth more here than the class name —
      // nothing in this server discriminates on the type.
      throw new McpToolError('Not signed in to the SimplePractice Client Portal.', {
        hint: 'Pass the sign-in link SimplePractice emailed to simplepractice_verify_sign_in_token — the whole link, which names the practice as well as carrying the token. Run simplepractice_request_sign_in_link first if you do not have one.',
      });
    }
    return session;
  }

  private headers(session: PortalSession | null, hasBody: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      'Api-Version': API_VERSION,
      // Omitting this is a hard 400 from the API, not a soft default.
      'Application-Build-Version': APPLICATION_BUILD_VERSION,
      'Application-Platform': APPLICATION_PLATFORM,
      Accept: JSON_API_MEDIA_TYPE,
    };
    if (hasBody) headers['Content-Type'] = JSON_API_MEDIA_TYPE;
    if (session) headers.Cookie = session.cookie;
    return headers;
  }

  /** One central place every request goes through. Returns the raw document. */
  async request(path: string, options: RequestOptions = {}): Promise<{
    document: JsonApiDocument;
    setCookie: string[];
  }> {
    const host = this.requireConfig();
    const session = options.anonymous ? null : this.requireSession();
    const query = options.query ? buildQuery(options.query) : '';
    const url = `https://${host}/${API_NAMESPACE}${path}${query ? `?${query}` : ''}`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: options.method ?? 'GET',
        headers: this.headers(session, options.body !== undefined),
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        redirect: 'manual',
      });
    } catch (err) {
      throw new McpToolError(
        `Could not reach ${host}: ${truncateErrorMessage(messageOf(err))}`,
        {
          hint: `Check your network connection, and that ${host} is really your practice's portal — simplepractice_session_status reports where that address came from.`,
        }
      );
    }

    const raw = await response.text();
    let document: JsonApiDocument | null = null;
    try {
      document = raw ? (JSON.parse(raw) as JsonApiDocument) : {};
    } catch {
      document = null;
    }

    if (!response.ok) this.throwForStatus(response.status, document, path);
    if (document === null) {
      // The portal's SPA catch-all answers 200 text/html for ANY path the API
      // does not define, so this is as often a wrong path as a dead session —
      // saying only "sign in again" sent a real investigation down the wrong
      // road once already.
      throw new McpToolError(
        `SimplePractice returned HTML rather than JSON for ${path}.`,
        {
          hint: 'Either the session expired (sign in again), or that path is not an API endpoint — the portal serves its app shell with HTTP 200 for unknown paths.',
        }
      );
    }

    return { document, setCookie: readSetCookie(response) };
  }

  /**
   * The id of the client whose data the portal is currently showing. Needed
   * because billing overview and saved cards are relationships ON the client
   * record, not collections of their own — `/client-billing-overviews` and
   * `/cards` are not API paths at all (they fall through to the SPA shell).
   */
  async currentClientId(): Promise<string | null> {
    const { records } = await this.list('/environment', { include: 'currentClient' });
    const current = records[0]?.currentClient as { id?: string } | undefined;
    return current?.id ?? null;
  }

  /** GET returning flattened records plus the document `meta`. */
  async list(path: string, query?: Record<string, QueryValue>) {
    const { document } = await this.request(path, { query });
    return flattenDocument(document);
  }

  private throwForStatus(
    status: number,
    document: JsonApiDocument | null,
    path: string
  ): never {
    const message = formatJsonApiErrors(document, status);
    // A 401 on the sign-in endpoints means the TOKEN was bad — most often
    // already used, since they are single-use. Telling the caller their
    // session expired there is simply the wrong diagnosis: they have no
    // session yet, which is why they are signing in.
    const isSignIn = path.startsWith('/sessions/') || path.startsWith('/sign-in-tokens');
    if (status === 401 || status === 403) {
      throw new McpToolError(message, {
        hint: isSignIn
          ? 'Sign-in links and PINs are single-use and last 24 hours. Request a fresh one with simplepractice_request_sign_in_link.'
          : 'The portal session has expired — there is no refresh token, so sign in again with simplepractice_request_sign_in_link.',
      });
    }
    if (status === 429) {
      // The two titles are distinct limits and both are punishing; a retry loop
      // here would lock the account out of the only auth path it has.
      throw new McpToolError(message, {
        hint: 'SimplePractice rate-limits sign-in requests per email and per IP. Do not retry — wait before asking for another link.',
      });
    }
    throw new McpToolError(message);
  }
}

/** `getSetCookie()` where available, falling back to the joined header. */
export function readSetCookie(response: Pick<Response, 'headers'>): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const joined = headers.get('set-cookie');
  return joined ? [joined] : [];
}
