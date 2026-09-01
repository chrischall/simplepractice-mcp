import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readFileSync } from 'node:fs';
import { McpToolError } from '@chrischall/mcp-utils';
import type { SimplePracticeClient } from '../src/client.js';
import { registerHealthcheckTools, CLIENT_ERROR_TEXT } from '../src/tools/health.js';

function setup(
  opts: { session?: unknown; host?: string | null; probe?: () => Promise<unknown> } = {}
) {
  const list = vi.fn(opts.probe ?? (async () => ({ records: [{ id: 'c1' }] })));
  const client = {
    list,
    // `knownPortalHost`, matching what health.ts calls: the throwing
    // `portalHost` has no place in a healthcheck, which must report a missing
    // practice as data rather than failing to answer at all.
    knownPortalHost: () => (opts.host === undefined ? 'practice.clientsecure.me' : opts.host),
    getSession: () => (opts.session === undefined ? { createdAt: '2026-08-01T00:00:00Z' } : opts.session),
  } as unknown as SimplePracticeClient;
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerHealthcheckTools(server, client);
  const call = async () =>
    JSON.parse(
      (await (server as any)._registeredTools.simplepractice_healthcheck.handler({}, {})).content[0].text,
    );
  return { server, call, list };
}

afterEach(() => vi.clearAllMocks());

describe('simplepractice_healthcheck', () => {
  it('registers under the repo tool prefix', () => {
    expect(Object.keys((setup().server as any)._registeredTools)).toEqual(['simplepractice_healthcheck']);
  });

  it('reports ok when the session resolves and the probe succeeds', async () => {
    const out = await setup().call();
    expect(out.ok).toBe(true);
    expect(out.credential.resolved).toBe(true);
  });

  // The whole point: simplepractice_session_status reads local state only, so
  // it answers "signedIn: true" for a session the far side already killed.
  it('makes a real network call rather than trusting local state', async () => {
    const { call, list } = setup();
    await call();
    expect(list).toHaveBeenCalledWith('/environment', { include: 'currentClient' });
  });

  it('reports a locally-present but server-rejected session as expired, not ok', async () => {
    const out = await setup({
      // Built the way client.ts's throwForStatus builds a 401: the JSON:API
      // summary on the message, the remediation on the HINT. Matching only
      // the message is the bug the auto-review on #13 caught.
      probe: async () => {
        throw new McpToolError('401 Unauthorized', {
          hint: 'The portal session has expired — there is no refresh token, so sign in again with simplepractice_request_sign_in_link.',
        });
      },
    }).call();
    expect(out.ok).toBe(false);
    expect(out.error.kind).toBe('session_expired');
    expect(out.hint).toMatch(/simplepractice_request_sign_in_link/);
  });

  it('reports no stored session as no_credential', async () => {
    const out = await setup({ session: null }).call();
    expect(out.ok).toBe(false);
    expect(out.error.kind).toBe('no_credential');
  });

  it('skips the probe entirely when there is no session', async () => {
    const { call, list } = setup({ session: null });
    await call();
    expect(list).not.toHaveBeenCalled();
  });

  it('reports the practice host and when the session was minted', async () => {
    const out = await setup().call();
    expect(out.credential.detail.practice_host).toBe('practice.clientsecure.me');
    expect(out.credential.detail.signed_in_at).toBe('2026-08-01T00:00:00Z');
  });

  it('never echoes the session cookie', async () => {
    const out = await setup({ session: { createdAt: 'x', cookie: 'SUPER-SECRET' } as any }).call();
    expect(JSON.stringify(out)).not.toContain('SUPER-SECRET');
  });

  it('flags an unknown practice distinctly', async () => {
    const out = await setup({
      // The real text from client.ts requireConfig(), which portalHost() calls.
      probe: async () => {
        throw new McpToolError('I do not know which practice portal to talk to yet.');
      },
    }).call();
    expect(out.error.kind).toBe('no_practice_host');
    // The remedy is the emailed link now, not the environment variable.
    expect(out.hint).toMatch(/simplepractice_verify_sign_in_token/);
  });

  it('reports an unknown practice as data rather than failing to answer', async () => {
    // Knowing no practice is the ordinary first-run state now. A healthcheck
    // that throws there fails at the one job it has: saying which hop broke.
    const out = await setup({ host: null, session: null }).call();
    expect(out.ok).toBe(false);
    expect(out.credential.detail.practice_host).toBeNull();
    expect(out.error.kind).toBe('no_credential');
  });

  it('reports a 429 as rate_limited and tells the caller not to retry', async () => {
    const out = await setup({
      probe: async () => {
        throw new McpToolError('429 Too Many Requests', {
          hint: 'SimplePractice rate-limits sign-in requests per email and per IP. Do not retry — wait before asking for another link.',
        });
      },
    }).call();
    expect(out.error.kind).toBe('rate_limited');
    expect(out.hint).toMatch(/do NOT retry/i);
  });

  it('classifies requireSession\'s not-signed-in message as session_expired', async () => {
    const out = await setup({
      probe: async () => { throw new McpToolError('Not signed in to the SimplePractice Client Portal.'); },
    }).call();
    expect(out.error.kind).toBe('session_expired');
  });

  // The guard for the class of bug the auto-review caught: every string this
  // classifier keys on must still exist in client.ts. If someone rewords an
  // error there, this fails loudly instead of the arm silently going dead.
  it('keys only on text client.ts actually produces', () => {
    const clientSource = readFileSync(new URL('../src/client.ts', import.meta.url), 'utf8');
    for (const [arm, text] of Object.entries(CLIENT_ERROR_TEXT)) {
      expect(clientSource, `${arm}: "${text}" no longer appears in client.ts`).toContain(text);
    }
  });

  it('leaves an unrecognised failure to the helper defaults', async () => {
    const out = await setup({ probe: async () => { throw new Error('socket hang up'); } }).call();
    expect(out.ok).toBe(false);
    expect(out.error.kind).not.toBe('session_expired');
  });

  it('classifies a non-Error throw without crashing', async () => {
    const out = await setup({ probe: async () => { throw 'The portal session has expired — sign in again'; } }).call();
    expect(out.error.kind).toBe('session_expired');
  });
});
