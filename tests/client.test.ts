import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { McpToolError } from '@chrischall/mcp-utils';
import { buildQuery, readSetCookie, SimplePracticeClient } from '../src/client.js';
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

  it('reports no session rather than throwing when unconfigured', () => {
    delete process.env.SIMPLEPRACTICE_PRACTICE;
    const client = new SimplePracticeClient({ store: tempStore() });
    expect(client.getSession()).toBeNull();
  });

  it('surfaces the configuration error on first use, naming the env var', async () => {
    delete process.env.SIMPLEPRACTICE_PRACTICE;
    const client = new SimplePracticeClient({ store: tempStore() });
    expect(() => client.portalHost()).toThrow(/SIMPLEPRACTICE_PRACTICE/);
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
