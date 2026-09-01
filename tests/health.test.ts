import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SimplePracticeClient } from '../src/client.js';
import { registerHealthcheckTools } from '../src/tools/health.js';

function setup(opts: { session?: unknown; host?: string; probe?: () => Promise<unknown> } = {}) {
  const list = vi.fn(opts.probe ?? (async () => ({ records: [{ id: 'c1' }] })));
  const client = {
    list,
    portalHost: () => opts.host ?? 'practice.clientsecure.me',
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
      probe: async () => {
        throw new Error('The portal session has expired — there is no refresh token, so sign in again with simplepractice_request_sign_in_link.');
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

  it('flags an unconfigured practice host distinctly', async () => {
    const out = await setup({
      probe: async () => { throw new Error('SIMPLEPRACTICE_PRACTICE_HOST is required'); },
    }).call();
    expect(out.error.kind).toBe('no_practice_host');
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
