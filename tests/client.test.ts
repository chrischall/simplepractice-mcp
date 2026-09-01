import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpToolError } from '@chrischall/mcp-utils';
import { SessionStore } from '@chrischall/mcp-utils/session';
import {
  buildQuery,
  readSetCookie,
  SimplePracticeClient,
  type PortalSession,
} from '../src/client.js';
import { makeClient, makeSignedInClient, tempStore, HOST } from './helpers.js';

const saved = { ...process.env };
beforeEach(() => {
  process.env.SIMPLEPRACTICE_PRACTICE = 'achievebalancetherapy';
});
afterEach(() => {
  process.env = { ...saved };
});

describe('buildQuery', () => {
  it('encodes flat pairs', () => {
    expect(buildQuery({ include: 'clinician,office' })).toBe('include=clinician%2Coffice');
  });

  it('expands a nested object into bracketed keys, as the portal does', () => {
    expect(buildQuery({ page: { number: 1, size: 50 } })).toBe('page%5Bnumber%5D=1&page%5Bsize%5D=50');
  });

  it('serialises a boolean filter, which the appointments split depends on', () => {
    expect(buildQuery({ filter: { hasPendingConfirmation: false } })).toBe(
      'filter%5BhasPendingConfirmation%5D=false'
    );
  });

  it('omits undefined values entirely', () => {
    expect(buildQuery({ a: undefined, b: '1' })).toBe('b=1');
  });

  it('is empty for no params', () => {
    expect(buildQuery({})).toBe('');
  });
});

describe('readSetCookie', () => {
  it('prefers getSetCookie when the runtime has it', () => {
    const headers = new Headers();
    headers.append('set-cookie', 'a=1');
    headers.append('set-cookie', 'b=2');
    expect(readSetCookie({ headers })).toEqual(['a=1', 'b=2']);
  });

  it('falls back to the joined header', () => {
    const headers = { get: (n: string) => (n === 'set-cookie' ? 'a=1' : null) } as unknown as Headers;
    expect(readSetCookie({ headers })).toEqual(['a=1']);
  });

  it('is empty when nothing was set', () => {
    const headers = { get: () => null } as unknown as Headers;
    expect(readSetCookie({ headers })).toEqual([]);
  });
});

describe('deferred configuration error', () => {
  it('constructs without configuration, so the server can still boot', () => {
    delete process.env.SIMPLEPRACTICE_PRACTICE;
    expect(() => new SimplePracticeClient({ store: tempStore() })).not.toThrow();
  });

  it('reports no session rather than throwing when no practice is known', () => {
    delete process.env.SIMPLEPRACTICE_PRACTICE;
    const client = new SimplePracticeClient({ store: tempStore() });
    expect(client.getSession()).toBeNull();
  });

  it('surfaces the error on first use, leading with the sign-in link', async () => {
    delete process.env.SIMPLEPRACTICE_PRACTICE;
    const client = new SimplePracticeClient({ store: tempStore() });
    const err = (() => {
      try {
        client.portalHost();
      } catch (e) {
        return e as McpToolError;
      }
      throw new Error('expected a throw');
    })();
    expect(err.message).toMatch(/which practice/i);
    // The link is now the primary route in, the env var only a shortcut.
    expect(err.hint).toMatch(/simplepractice_verify_sign_in_token/);
    expect(err.hint).toMatch(/SIMPLEPRACTICE_PRACTICE/);
  });

  it('reports the practice as unknown without throwing, for status callers', () => {
    delete process.env.SIMPLEPRACTICE_PRACTICE;
    const client = new SimplePracticeClient({ store: tempStore() });
    expect(client.knownPortalHost()).toBeNull();
    expect(client.practiceSource()).toBeNull();
  });
});

describe('where the practice host comes from', () => {
  const OTHER = 'otherpractice.clientsecure.me';

  it('takes it from the environment when one is set', () => {
    const { client } = makeClient();
    expect(client.portalHost()).toBe(HOST);
    expect(client.practiceSource()).toBe('environment');
  });

  it('adopts a practice learned at runtime, over the environment', () => {
    // The link a user pastes is the ground truth for THAT sign-in: posting its
    // token to a stale env var's host would simply fail.
    const { client } = makeClient();
    expect(client.adoptPracticeHost(OTHER)).toBe(OTHER);
    expect(client.portalHost()).toBe(OTHER);
    expect(client.practiceSource()).toBe('link');
  });

  it('remembers the practice of the stored session when nothing is configured', () => {
    // The whole point of deriving it: sign in once with a link, and every
    // later process knows the practice with no configuration at all.
    const store = tempStore();
    const configured = new SimplePracticeClient({ store });
    configured.adoptPracticeHost(OTHER);
    configured.saveSession('simplepractice-session=S');

    delete process.env.SIMPLEPRACTICE_PRACTICE;
    const fresh = new SimplePracticeClient({ store });
    expect(fresh.portalHost()).toBe(OTHER);
    expect(fresh.practiceSource()).toBe('session');
    expect(fresh.getSession()?.cookie).toBe('simplepractice-session=S');
  });

  it('falls back to the practice signed into most recently, across a restart', async () => {
    // A → B → A. SessionStore's own active pointer disagrees with itself here:
    // `add()` leaves an existing key in its original insertion position, so
    // in-memory it names A while a fresh process, restoring the pointer as the
    // last key on disk, names B. Ordering on our own createdAt is what makes
    // the answer the same on both sides of a restart.
    const dir = mkdtempSync(join(tmpdir(), 'sp-recent-'));
    const filePath = join(dir, 'session.json');
    const storeFor = () =>
      new SessionStore<PortalSession>({
        filePath,
        keyOf: (s) => s.host,
        normalizeKey: (k) => k.toLowerCase(),
      });

    const first = new SimplePracticeClient({ store: storeFor() });
    for (const [host, cookie] of [
      [HOST, 'A1'],
      [OTHER, 'B1'],
      [HOST, 'A2'],
    ]) {
      first.adoptPracticeHost(host);
      first.saveSession(`simplepractice-session=${cookie}`);
      // Distinct createdAt values; the clock is millisecond-resolution.
      await new Promise((resolve) => setTimeout(resolve, 2));
    }

    delete process.env.SIMPLEPRACTICE_PRACTICE;
    const restarted = new SimplePracticeClient({ store: storeFor() });
    expect(restarted.portalHost()).toBe(HOST);
    expect(restarted.getSession()?.cookie).toBe('simplepractice-session=A2');
  });

  it('refuses an adopted host that is not a Client Portal address', () => {
    const { client } = makeClient();
    expect(() => client.adoptPracticeHost('evil.example.com')).toThrow(McpToolError);
    // And leaves the previous answer standing rather than half-applying.
    expect(client.portalHost()).toBe(HOST);
  });

  it('saves the session under the adopted practice, not the configured one', () => {
    const { client, store } = makeClient();
    client.adoptPracticeHost(OTHER);
    client.saveSession('simplepractice-session=S');
    expect(store.get(OTHER)?.cookie).toBe('simplepractice-session=S');
    expect(store.get(HOST)).toBeNull();
  });

  it('signs out of nothing, rather than throwing, when no practice is known', () => {
    delete process.env.SIMPLEPRACTICE_PRACTICE;
    const client = new SimplePracticeClient({ store: tempStore() });
    expect(client.clearSession()).toBe(false);
  });
});

describe('request', () => {
  it('sends all four required headers plus the session cookie', async () => {
    const { client, calls } = makeSignedInClient([{ body: { data: [] } }]);
    await client.list('/appointments');
    const headers = calls[0].init.headers as Record<string, string>;
    // Dropping Application-Build-Version is a hard 400 from the API.
    expect(headers['Api-Version']).toBe('2026-05-25');
    expect(headers['Application-Build-Version']).toBe('0.0.0');
    expect(headers['Application-Platform']).toBe('web');
    expect(headers.Accept).toBe('application/vnd.api+json');
    expect(headers.Cookie).toBe('simplepractice-session=abc123');
  });

  it('builds the URL under the client-portal-api namespace on the practice host', async () => {
    const { client, calls } = makeSignedInClient([{ body: { data: [] } }]);
    await client.list('/appointments', { page: { size: 50 } });
    expect(calls[0].url).toBe(
      `https://${HOST}/client-portal-api/appointments?page%5Bsize%5D=50`
    );
  });

  it('sets a JSON:API content type only when there is a body', async () => {
    const { client, calls } = makeSignedInClient([{ body: { data: [] } }, { body: { data: [] } }]);
    await client.list('/appointments');
    expect((calls[0].init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    await client.request('/sessions/token', { method: 'POST', body: { data: {} }, anonymous: true });
    expect((calls[1].init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/vnd.api+json'
    );
  });

  it('refuses an authenticated call with no session, and says how to get one', async () => {
    const { client } = makeClient();
    await expect(client.list('/appointments')).rejects.toThrow(/Not signed in/);
  });

  it('allows an anonymous call with no session, for the sign-in endpoints', async () => {
    const { client, calls } = makeClient([{ status: 202, body: { data: {} } }]);
    await client.request('/sign-in-tokens', { method: 'POST', anonymous: true, body: {} });
    expect((calls[0].init.headers as Record<string, string>).Cookie).toBeUndefined();
  });

  it('maps 401 to a re-authenticate error carrying the upstream title', async () => {
    const { client } = makeSignedInClient([
      { status: 401, body: { errors: [{ title: 'You have no access to this client' }] } },
    ]);
    await expect(client.list('/appointments')).rejects.toThrow(/You have no access to this client/);
  });

  it('maps 403 the same way — a stale anti-bot cookie reads as forbidden', async () => {
    const { client } = makeSignedInClient([{ status: 403, body: { errors: [{ title: 'Forbidden' }] } }]);
    await expect(client.list('/appointments')).rejects.toThrow(/Forbidden/);
  });

  it('maps 429 to an error that tells the caller NOT to retry', async () => {
    const { client } = makeClient([
      { status: 429, body: { errors: [{ title: 'Email request limit reached' }] } },
    ]);
    await expect(
      client.request('/sign-in-tokens', { method: 'POST', anonymous: true, body: {} })
    ).rejects.toThrow(/Email request limit reached/);
  });

  it('surfaces the documented 400 when a required header is missing upstream', async () => {
    const { client } = makeSignedInClient([
      { status: 400, body: { errors: [{ title: 'Application build version is missing' }] } },
    ]);
    await expect(client.list('/appointments')).rejects.toThrow(
      /Application build version is missing/
    );
  });

  it('refuses to treat a 200 of HTML as data, and names the path', async () => {
    // The portal's SPA catch-all answers 200 text/html for ANY undefined path,
    // so this fires both for a dead session and for a wrong endpoint. Both
    // /cards and /client-billing-overviews looked like working endpoints
    // exactly this way.
    const { client } = makeSignedInClient([
      { raw: '<!doctype html><title>Sign in</title>', contentType: 'text/html' },
    ]);
    const err = await client.list('/appointments').catch((e: McpToolError) => e);
    expect(err.message).toContain('/appointments');
    expect(err.hint).toMatch(/not an API endpoint/);
    expect(err.hint).toMatch(/session expired/);
  });

  it('treats an empty body as an empty document rather than failing', async () => {
    const { client } = makeSignedInClient([{ raw: '' }]);
    await expect(client.list('/appointments')).resolves.toEqual({ records: [] });
  });

  it('wraps a transport failure with the practice host', async () => {
    const fetchImpl = (async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    }) as unknown as typeof fetch;
    const client = new SimplePracticeClient({ fetchImpl, store: tempStore() });
    client.saveSession('simplepractice-session=x');
    await expect(client.list('/appointments')).rejects.toThrow(new RegExp(`Could not reach ${HOST}`));
  });
});

describe('session persistence', () => {
  it('round-trips a saved session', () => {
    const { client } = makeClient();
    client.saveSession('simplepractice-session=zzz');
    expect(client.getSession()?.cookie).toBe('simplepractice-session=zzz');
    expect(client.getSession()?.host).toBe(HOST);
  });

  it('clears a session and reports whether there was one', () => {
    const { client } = makeClient();
    client.saveSession('simplepractice-session=zzz');
    expect(client.clearSession()).toBe(true);
    expect(client.getSession()).toBeNull();
    expect(client.clearSession()).toBe(false);
  });
});

describe('401 diagnosis depends on which endpoint failed', () => {
  it('blames a stale session on a data endpoint', async () => {
    const { client } = makeSignedInClient([{ status: 401, body: { errors: [{ title: 'nope' }] } }]);
    const err = await client.list('/appointments').catch((e: McpToolError) => e);
    expect(err.hint).toMatch(/portal session has expired/);
  });

  it('blames a spent link on the sign-in endpoints, where there is no session yet', async () => {
    // Verified live: replaying a used token answers 401 "Authorization has
    // already been used or expired". Saying "your session expired" there is
    // the wrong diagnosis — the caller is signing in precisely because they
    // have no session.
    const { client } = makeClient([
      { status: 401, body: { errors: [{ title: 'Authorization has already been used or expired' }] } },
    ]);
    const err = await client
      .request('/sessions/token', { method: 'POST', anonymous: true, body: {} })
      .catch((e: McpToolError) => e);
    expect(err.hint).toMatch(/single-use/);
    expect(err.hint).not.toMatch(/portal session has expired/);
  });
})
