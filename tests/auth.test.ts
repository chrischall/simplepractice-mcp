import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { McpToolError } from '@chrischall/mcp-utils';
import { _extractToken, requestSignInLink, verifySignInPin, verifySignInToken } from '../src/auth.js';
import { SimplePracticeClient } from '../src/client.js';
import { makeClient, tempStore, HOST } from './helpers.js';

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
        // No expiresIn: SimplePractice ignored the one this used to ask for
        // and issued its own lifetime anyway (fleet-audit#895).
        attributes: { email: 'someone@example.com' },
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

describe('the link lifetime in hints comes from the API, not a constant (fleet-audit#895)', () => {
  it('an expired link is described with the lifetime SimplePractice last reported', async () => {
    const { client } = makeClient([
      { status: 202, body: { data: { attributes: { expiresIn: '2 hours' } } } },
      { body: { data: { meta: { status: 'expired' } } } },
    ]);
    await requestSignInLink(client, 'a@example.com');
    const err = await verifySignInToken(client, 'tok').catch((e: McpToolError) => e);
    expect((err as McpToolError).hint).toMatch(/Sign-in links last 2 hours/);
  });

  it('a rejected sign-in 401 is described with the reported lifetime too', async () => {
    const { client } = makeClient([
      { status: 202, body: { data: { attributes: { expiresIn: '2 hours' } } } },
      { status: 401, body: { errors: [{ title: 'Authorization has already been used or expired' }] } },
    ]);
    await requestSignInLink(client, 'a@example.com');
    const err = await verifySignInToken(client, 'tok').catch((e: McpToolError) => e);
    expect((err as McpToolError).hint).toMatch(/single-use and last 2 hours/);
  });

  it.each([[''], ['  '], [24]])(
    'keeps the last known lifetime when the API reports an unusable one (%j)',
    async (expiresIn) => {
      const { client } = makeClient([{ status: 202, body: { data: { attributes: { expiresIn } } } }]);
      await expect(requestSignInLink(client, 'a@example.com')).resolves.toEqual({
        expiresIn: '24 hours',
      });
    }
  );

  it('falls back to the documented 24 hours before any link has been requested', () => {
    const { client } = makeClient([]);
    expect(client.signInLinkLifetime).toBe('24 hours');
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
    expect(result).toEqual({ status: 'verified', signedIn: true, practiceHost: HOST });
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
      practiceHost: HOST,
    });
  });
});

describe('the practice the sign-in link names', () => {
  const OTHER = 'otherpractice.clientsecure.me';
  const verified = {
    body: { data: { meta: { status: 'verified' } } },
    setCookie: ['simplepractice-session=S'],
  };

  it('signs in to the practice in the link, with nothing configured at all', async () => {
    // The headline case: no SIMPLEPRACTICE_PRACTICE anywhere, just the link
    // out of the email.
    delete process.env.SIMPLEPRACTICE_PRACTICE;
    const { client, calls } = makeClient([verified]);
    const result = await verifySignInToken(client, `https://${OTHER}/sign-in/token#tok`);

    expect(calls[0].url).toBe(`https://${OTHER}/client-portal-api/sessions/token`);
    expect(result.practiceHost).toBe(OTHER);
    expect(client.portalHost()).toBe(OTHER);
    expect(client.getSession()?.host).toBe(OTHER);
  });

  it('lets the link override a practice the environment names', async () => {
    // Posting the token to the env var's host instead would simply 401: the
    // token was minted for the practice in the link.
    const { client, calls } = makeClient([verified]);
    await verifySignInToken(client, `https://${OTHER}/sign-in/token#tok`);
    expect(calls[0].url).toBe(`https://${OTHER}/client-portal-api/sessions/token`);
  });

  it('keeps the configured practice when the link names none', async () => {
    // The mobile variant points at the bare apex, and a pasted bare token
    // names nothing either. Both still work when the practice is known.
    const { client, calls } = makeClient([verified]);
    await verifySignInToken(
      client,
      'https://clientsecure.me/client-portal-api/sign-in/token#tok'
    );
    expect(calls[0].url).toBe(`https://${HOST}/client-portal-api/sessions/token`);
  });

  it('ignores a link outside clientsecure.me rather than posting the token to it', async () => {
    const { client, calls } = makeClient([verified]);
    await verifySignInToken(client, 'https://evil.example.com/sign-in/token#tok');
    expect(calls[0].url).toBe(`https://${HOST}/client-portal-api/sessions/token`);
  });

  it('asks for the practice when neither the link nor the config names one', async () => {
    delete process.env.SIMPLEPRACTICE_PRACTICE;
    const { client, calls } = makeClient([verified]);
    const err = await verifySignInToken(client, 'tok').catch((e: McpToolError) => e);
    expect(err).toBeInstanceOf(McpToolError);
    expect((err as McpToolError).message).toMatch(/which practice/i);
    // And no token went anywhere while we did not know where to send it.
    expect(calls).toHaveLength(0);
  });

  it('does not keep the link practice when the exchange fails', async () => {
    // Links are single-use, so a failed exchange is the ordinary case. Pasting
    // a stale link for another practice must not strand the process there and
    // hide the session that already works.
    const { client } = makeClient([
      { status: 401, body: { errors: [{ title: 'Authorization has already been used' }] } },
    ]);
    client.saveSession('simplepractice-session=MINE');

    await expect(
      verifySignInToken(client, `https://${OTHER}/sign-in/token#stale`)
    ).rejects.toThrow(/already been used/);

    expect(client.portalHost()).toBe(HOST);
    expect(client.getSession()?.cookie).toBe('simplepractice-session=MINE');
  });

  it('keeps the link practice once the exchange succeeds', async () => {
    const { client } = makeClient([verified]);
    await verifySignInToken(client, `https://${OTHER}/sign-in/token#tok`);
    expect(client.portalHost()).toBe(OTHER);
  });

  it('restores the previous practice, not merely the configured one', async () => {
    // The rollback has to put back whatever was adopted before, or a second
    // failed link would silently demote the practice a first link had earned.
    delete process.env.SIMPLEPRACTICE_PRACTICE;
    const { client } = makeClient([
      verified,
      { status: 401, body: { errors: [{ title: 'nope' }] } },
    ]);
    await verifySignInToken(client, `https://${OTHER}/sign-in/token#good`);
    await expect(
      verifySignInToken(client, `https://third.clientsecure.me/sign-in/token#bad`)
    ).rejects.toThrow(/nope/);
    expect(client.portalHost()).toBe(OTHER);
  });

  describe('concurrent tool calls (fleet-audit#709)', () => {
    const THIRD = 'third.clientsecure.me';

    /**
     * A fetch whose sign-in POSTs to each practice host wait until released,
     * and whose reads answer at once — so one call can be held mid-exchange
     * while another runs.
     */
    function heldFetch() {
      const releases = new Map<string, (r: { ok: boolean }) => void>();
      const urls: string[] = [];
      const fetchImpl = (async (url: string) => {
        urls.push(url);
        const host = new URL(url).host;
        const respond = (ok: boolean) =>
          ({
            ok,
            status: ok ? 200 : 401,
            headers: (() => {
              const h = new Headers();
              if (ok) h.append('set-cookie', `simplepractice-session=${host}`);
              return h;
            })(),
            text: async () =>
              ok
                ? JSON.stringify({ data: { meta: { status: 'verified' } } })
                : JSON.stringify({ errors: [{ title: `rejected at ${host}` }] }),
          }) as unknown as Response;
        if (!url.includes('/sessions/')) return respond(true);
        const { ok } = await new Promise<{ ok: boolean }>((resolve) => releases.set(host, resolve));
        return respond(ok);
      }) as unknown as typeof fetch;
      const release = async (host: string, ok: boolean) => {
        while (!releases.has(host)) await new Promise((r) => setTimeout(r, 1));
        releases.get(host)!({ ok });
      };
      return { fetchImpl, urls, release };
    }

    it('does not point concurrent reads at a practice whose sign-in is still in flight', async () => {
      const { fetchImpl, urls, release } = heldFetch();
      const client = new SimplePracticeClient({ fetchImpl, store: tempStore() });
      client.saveSession('simplepractice-session=MINE');

      const signingIn = verifySignInToken(client, `https://${OTHER}/sign-in/token#tok`);
      // While the exchange for OTHER is pending, this server is still HOST's.
      expect(client.portalHost()).toBe(HOST);
      await client.list('/appointments');
      expect(urls.at(-1)).toBe(`https://${HOST}/client-portal-api/appointments`);

      await release(OTHER, true);
      await signingIn;
      expect(client.portalHost()).toBe(OTHER);
    });

    it('a failing sign-in does not undo a concurrent one that succeeded', async () => {
      // The environment names HOST, so a stale rollback to "nothing adopted"
      // would visibly land there rather than on THIRD.
      const { fetchImpl, release } = heldFetch();
      const client = new SimplePracticeClient({ fetchImpl, store: tempStore() });

      const x = verifySignInToken(client, `https://${OTHER}/sign-in/token#x`);
      const y = verifySignInToken(client, `https://${THIRD}/sign-in/token#y`);
      await release(THIRD, true);
      await y;
      await release(OTHER, false);
      await expect(x).rejects.toThrow(/rejected at/);

      expect(client.portalHost()).toBe(THIRD);
      expect(client.getSession()?.cookie).toBe(`simplepractice-session=${THIRD}`);
    });

    it('a late success does not override a practice adopted after it began', async () => {
      delete process.env.SIMPLEPRACTICE_PRACTICE;
      const { fetchImpl, release } = heldFetch();
      const client = new SimplePracticeClient({ fetchImpl, store: tempStore() });

      const x = verifySignInToken(client, `https://${OTHER}/sign-in/token#x`);
      const y = verifySignInToken(client, `https://${THIRD}/sign-in/token#y`);
      await release(THIRD, true);
      await y;
      await release(OTHER, true);
      await expect(x).resolves.toMatchObject({ practiceHost: OTHER });

      // X's session is stored under OTHER, but the practice in play stays the
      // one the user switched to most recently.
      expect(client.portalHost()).toBe(THIRD);
    });
  });

  it('signs a PIN in to the remembered practice, since a PIN names none', async () => {
    delete process.env.SIMPLEPRACTICE_PRACTICE;
    const { client, calls } = makeClient([verified, verified]);
    await verifySignInToken(client, `https://${OTHER}/sign-in/token#tok`);
    await verifySignInPin(client, 'a@example.com', '123456');
    expect(calls[1].url).toBe(`https://${OTHER}/client-portal-api/sessions/pin`);
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
