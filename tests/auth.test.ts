import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { McpToolError } from '@chrischall/mcp-utils';
import { _extractToken, requestSignInLink, verifySignInPin, verifySignInToken } from '../src/auth.js';
import { makeClient, HOST } from './helpers.js';

const saved = { ...process.env };
beforeEach(() => {
  process.env.SIMPLEPRACTICE_PRACTICE = 'achievebalancetherapy';
});
afterEach(() => {
  process.env = { ...saved };
});

describe('extracting the token from what a user pastes', () => {
  it('takes the fragment out of a whole sign-in link', () => {
    // The token is the URL FRAGMENT — a browser never sends it to the server,
    // so the link text is the only place it can come from.
    expect(_extractToken(`https://${HOST}/sign-in/token#abc123`)).toBe('abc123');
  });

  it('accepts a bare token', () => {
    expect(_extractToken('abc123')).toBe('abc123');
  });

  it('tolerates surrounding whitespace from a paste', () => {
    expect(_extractToken('  abc123\n')).toBe('abc123');
  });

  it('rejects a link with no fragment, rather than posting the URL as a token', () => {
    expect(() => _extractToken(`https://${HOST}/sign-in/token`)).toThrow(
      /no token in it/
    );
  });

  it('rejects a path-shaped string that is plainly not a token', () => {
    expect(() => _extractToken('/sign-in/token')).toThrow(
      /does not look like a sign-in token/
    );
  });

  it('rejects empty input', () => {
    expect(() => _extractToken('   ')).toThrow(/does not look like a sign-in token/);
  });
});

describe('requestSignInLink', () => {
  it('posts the JSON:API sign-in-token body to the right path', async () => {
    const { client, calls } = makeClient([
      { status: 202, body: { data: { type: 'signInTokens', attributes: { expiresIn: '24 hours' } } } },
    ]);
    const result = await requestSignInLink(client, 'someone@example.com');
    expect(calls[0].url).toBe(`https://${HOST}/client-portal-api/sign-in-tokens`);
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      data: {
        type: 'sign-in-tokens',
        attributes: { email: 'someone@example.com', expiresIn: '15 minutes' },
      },
    });
    expect(result.expiresIn).toBe('24 hours');
  });

  it('sends no cookie — you request a link precisely because you have no session', async () => {
    const { client, calls } = makeClient([{ status: 202, body: { data: {} } }]);
    await requestSignInLink(client, 'someone@example.com');
    expect((calls[0].init.headers as Record<string, string>).Cookie).toBeUndefined();
  });

  it('defaults the reported lifetime when the response omits it', async () => {
    const { client } = makeClient([{ status: 202, body: { data: {} } }]);
    await expect(requestSignInLink(client, 'a@example.com')).resolves.toEqual({
      expiresIn: '24 hours',
    });
  });
});

describe('verifySignInToken', () => {
  const verified = (setCookie: string[]) => ({
    status: 200,
    body: { data: { type: 'sessions', meta: { status: 'verified' } } },
    setCookie,
  });

  it('exchanges the token and stores the session cookie', async () => {
    const { client, calls } = makeClient([
      verified(['simplepractice-session=SECRET; Path=/; HttpOnly; Secure']),
    ]);
    const result = await verifySignInToken(client, `https://${HOST}/sign-in/token#tok`);

    expect(calls[0].url).toBe(`https://${HOST}/client-portal-api/sessions/token`);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      data: { type: 'sessions', attributes: { type: 'token', token: 'tok' } },
    });
    expect(result).toEqual({ status: 'verified', signedIn: true });
    // The outcome that matters: a later authenticated call can be made.
    expect(client.getSession()?.cookie).toBe('simplepractice-session=SECRET');
  });

  it('keeps only the session cookie out of everything the response sets', async () => {
    const { client } = makeClient([
      verified(['_ga=analytics; Path=/', 'simplepractice-session=SECRET; Path=/; HttpOnly']),
    ]);
    await verifySignInToken(client, 'tok');
    expect(client.getSession()?.cookie).toBe('simplepractice-session=SECRET');
  });

  it.each([
    ['expired', /Sign-in links last 24 hours/],
    ['merged', /single-use/],
    ['unknown', /single-use/],
  ])('refuses to store a session when the status is %s', async (status, hintPattern) => {
    const { client } = makeClient([
      { body: { data: { meta: { status } } }, setCookie: ['simplepractice-session=x'] },
    ]);
    const err = await verifySignInToken(client, 'tok').catch((e: McpToolError) => e);
    expect(err).toBeInstanceOf(McpToolError);
    expect((err as McpToolError).message).toContain(status);
    // The remediation lives on .hint, which the MCP boundary renders into the
    // failing tool's text — assert it here rather than against the message.
    expect((err as McpToolError).hint).toMatch(hintPattern);
    // The real failure to guard: a non-verified status must NOT leave a session
    // behind that later reads would use.
    expect(client.getSession()).toBeNull();
  });

  it('reports a missing status as unknown rather than assuming success', async () => {
    const { client } = makeClient([{ body: { data: {} } }]);
    await expect(verifySignInToken(client, 'tok')).rejects.toThrow(/unknown/);
  });

  it('fails loudly if verification succeeds but no session cookie comes back', async () => {
    const { client } = makeClient([
      { body: { data: { meta: { status: 'verified' } } }, setCookie: [] },
    ]);
    await expect(verifySignInToken(client, 'tok')).rejects.toThrow(/no session cookie/);
    expect(client.getSession()).toBeNull();
  });

  it('handles the response arriving as a data array', async () => {
    const { client } = makeClient([
      {
        body: { data: [{ meta: { status: 'verified' } }] },
        setCookie: ['simplepractice-session=S'],
      },
    ]);
    await expect(verifySignInToken(client, 'tok')).resolves.toEqual({
      status: 'verified',
      signedIn: true,
    });
  });
});

describe('verifySignInPin', () => {
  it('posts to the pin path with the address the code was sent to', async () => {
    const { client, calls } = makeClient([
      {
        body: { data: { meta: { status: 'verified' } } },
        setCookie: ['simplepractice-session=S'],
      },
    ]);
    await verifySignInPin(client, 'a@example.com', '123456');
    expect(calls[0].url).toBe(`https://${HOST}/client-portal-api/sessions/pin`);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      data: { type: 'sessions', attributes: { type: 'pin', email: 'a@example.com', pin: '123456' } },
    });
  });
});
