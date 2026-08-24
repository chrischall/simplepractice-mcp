import { McpToolError, messageOf, truncateErrorMessage } from '@chrischall/mcp-utils';
import { SessionStore } from '@chrischall/mcp-utils/session';
import {
  API_NAMESPACE,
  API_VERSION,
  APPLICATION_BUILD_VERSION,
  APPLICATION_PLATFORM,
  readPortalHost,
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

export class SimplePracticeClient {
  private readonly store: SessionStore<PortalSession>;
  private readonly configError: McpToolError | null;
  private readonly host: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: { fetchImpl?: typeof fetch; store?: SessionStore<PortalSession> } = {}) {
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    const host = readPortalHost();
    // Deferred-config-error: the server must still boot (and answer the host's
    // install-time tools/list probe) with no configuration; the error surfaces
    // on the first tool call instead.
    this.configError = host
      ? null
      : new McpToolError(
          'SIMPLEPRACTICE_PRACTICE is not set, or is not a valid Client Portal address.',
          {
            hint: 'Set SIMPLEPRACTICE_PRACTICE to your practice\'s portal address — either the slug ("achievebalancetherapy") or the full host ("achievebalancetherapy.clientsecure.me"). It is the host in the portal link your provider emailed you.',
          }
        );
    this.host = host ?? '';
    this.store =
      opts.store ??
      new SessionStore<PortalSession>({
        filePath: sessionFilePath(),
        keyOf: (session) => session.host,
        normalizeKey: (key) => key.toLowerCase(),
      });
  }

  /** Throws the deferred configuration error, if there is one. */
  private requireConfig(): string {
    if (this.configError) throw this.configError;
    return this.host;
  }

  portalHost(): string {
    return this.requireConfig();
  }

  getSession(): PortalSession | null {
    if (this.configError) return null;
    return this.store.get(this.host);
  }

  saveSession(cookie: string): PortalSession {
    const host = this.requireConfig();
    const session: PortalSession = { host, cookie, createdAt: new Date().toISOString() };
    this.store.add(session);
    return session;
  }

  clearSession(): boolean {
    const host = this.requireConfig();
    return this.store.remove(host);
  }

  private requireSession(): PortalSession {
    const session = this.getSession();
    if (!session) {
      // McpToolError rather than SessionNotAuthenticatedError: that subclass's
      // constructor is (service, signInHost) and composes its own message, and
      // the two-step remediation below is worth more here than the class name —
      // nothing in this server discriminates on the type.
      throw new McpToolError('Not signed in to the SimplePractice Client Portal.', {
        hint: 'Run simplepractice_request_sign_in_link to have SimplePractice email you a sign-in link, then pass the part of that link after the "#" to simplepractice_verify_sign_in_token.',
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
        { hint: 'Check the practice address in SIMPLEPRACTICE_PRACTICE and your network connection.' }
      );
    }

    const raw = await response.text();
    let document: JsonApiDocument | null = null;
    try {
      document = raw ? (JSON.parse(raw) as JsonApiDocument) : {};
    } catch {
      document = null;
    }

    if (!response.ok) this.throwForStatus(response.status, document);
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

  private throwForStatus(status: number, document: JsonApiDocument | null): never {
    const message = formatJsonApiErrors(document, status);
    if (status === 401 || status === 403) {
      throw new McpToolError(message, {
        hint: 'The portal session has expired — there is no refresh token, so sign in again with simplepractice_request_sign_in_link.',
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
