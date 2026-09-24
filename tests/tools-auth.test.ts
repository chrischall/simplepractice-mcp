import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createTestHarness, parseToolResult } from '@chrischall/mcp-utils/test';
import { registerAuthTools } from '../src/tools/auth.js';
import { makeClient, type StubResponse } from './helpers.js';

const saved = { ...process.env };
beforeEach(() => {
  process.env.SIMPLEPRACTICE_PRACTICE = 'achievebalancetherapy';
});
afterEach(() => {
  process.env = { ...saved };
});

type Elicit = NonNullable<Parameters<typeof createTestHarness>[1]>['elicitation'];

async function harnessFor(responses: StubResponse[] = [], elicitation?: Elicit) {
  const made = makeClient(responses);
  const harness = await createTestHarness(
    (server) => registerAuthTools(server, made.client),
    elicitation ? { elicitation } : undefined
  );
  return { ...made, harness };
}

const SEND = 'simplepractice_request_sign_in_link';
const SENT = { status: 202, body: { data: { attributes: { expiresIn: '24 hours' } } } };

/**
 * Phase 1 of the confirm-token flow (a harness with no elicitation handler is a
 * client that cannot be prompted), then phase 2 with the token it returned.
 */
async function confirmed(
  harness: Awaited<ReturnType<typeof harnessFor>>['harness'],
  args: Record<string, unknown>
) {
  const preview = parseToolResult<any>(await harness.callTool(SEND, args));
  expect(preview.status).toBe('confirmation-required');
  return harness.callTool(SEND, { ...args, confirmToken: preview.confirmToken });
}

describe('simplepractice_request_sign_in_link', () => {
  it('makes NO network call on the first call, and previews what it would send', async () => {
    const { harness, calls } = await harnessFor([]);
    const out = parseToolResult<any>(await harness.callTool(SEND, { email: 'a@example.com' }));
    expect(out.status).toBe('confirmation-required');
    expect(out.dispatched).toBe(false);
    expect(out.confirmToken).toEqual(expect.any(String));
    expect(out.preview).toEqual({
      wouldSend: 'a Client Portal sign-in email',
      to: 'a@example.com',
      practiceHost: 'achievebalancetherapy.clientsecure.me',
      note: expect.stringMatching(/Do not retry a failed send/),
    });
    // The gate has to be real: sending is rate-limited per address AND per IP,
    // and there is no other way into the portal.
    expect(calls).toHaveLength(0);
    await harness.close();
  });

  it('sends exactly once with the returned token, and points at the next step', async () => {
    const { harness, calls } = await harnessFor([SENT]);
    const out = parseToolResult<any>(await confirmed(harness, { email: 'a@example.com' }));
    expect(calls).toHaveLength(1);
    expect(out.sent).toBe(true);
    expect(out.expiresIn).toBe('24 hours');
    expect(out.next).toMatch(/simplepractice_verify_sign_in_token/);
    await harness.close();
  });

  it('refuses a replayed token and sends nothing more', async () => {
    const { harness, calls } = await harnessFor([SENT, SENT]);
    const args = { email: 'a@example.com' };
    const preview = parseToolResult<any>(await harness.callTool(SEND, args));
    await harness.callTool(SEND, { ...args, confirmToken: preview.confirmToken });
    expect(calls).toHaveLength(1);
    const replay = await harness.callTool(SEND, { ...args, confirmToken: preview.confirmToken });
    expect(replay.isError).toBe(true);
    expect(parseToolResult<any>(replay).error).toBe('TOKEN_REUSED');
    expect(calls).toHaveLength(1);
    await harness.close();
  });

  it('refuses a token when the address changed between the two calls', async () => {
    const { harness, calls } = await harnessFor([SENT]);
    const preview = parseToolResult<any>(await harness.callTool(SEND, { email: 'a@example.com' }));
    const result = await harness.callTool(SEND, {
      email: 'b@example.com',
      confirmToken: preview.confirmToken,
    });
    expect(result.isError).toBe(true);
    const out = parseToolResult<any>(result);
    expect(out.error).toBe('DRAFT_CHANGED');
    expect(out.preview.to).toBe('b@example.com');
    expect(calls).toHaveLength(0);
    await harness.close();
  });

  it('refuses a token when the practice changed between the two calls', async () => {
    const { harness, calls } = await harnessFor([SENT]);
    const preview = parseToolResult<any>(await harness.callTool(SEND, { email: 'a@example.com' }));
    const result = await harness.callTool(SEND, {
      email: 'a@example.com',
      practice: 'otherpractice',
      confirmToken: preview.confirmToken,
    });
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
    await harness.close();
  });

  it('sends when a client that can prompt gets the user to accept', async () => {
    const { harness, calls } = await harnessFor([SENT], async () => ({
      action: 'accept',
      content: { confirmed: true },
    }));
    const out = parseToolResult<any>(await harness.callTool(SEND, { email: 'a@example.com' }));
    expect(out.sent).toBe(true);
    expect(calls).toHaveLength(1);
    await harness.close();
  });

  it('sends nothing when the user declines the prompt', async () => {
    const { harness, calls } = await harnessFor([SENT], async () => ({ action: 'decline' }));
    const result = await harness.callTool(SEND, { email: 'a@example.com' });
    expect(parseToolResult<any>(result).sent).toBeUndefined();
    expect(calls).toHaveLength(0);
    await harness.close();
  });

  it('refuses outright under MCP_CONFIRM_MODE=refuse on a client that cannot prompt', async () => {
    process.env.MCP_CONFIRM_MODE = 'refuse';
    const { harness, calls } = await harnessFor([SENT]);
    const result = await harness.callTool(SEND, { email: 'a@example.com' });
    expect(JSON.stringify(result)).toContain('confirmation-unsupported');
    expect(calls).toHaveLength(0);
    await harness.close();
  });

  it('does not claim the address has an account', async () => {
    const { harness } = await harnessFor([{ status: 202, body: { data: {} } }]);
    const out = parseToolResult<any>(await confirmed(harness, { email: 'nobody@example.com' }));
    // The API answers identically for unknown addresses, by design.
    expect(out.note).toMatch(/same whether or not the address has an account/);
    await harness.close();
  });

  it('rejects a malformed address before any network call', async () => {
    const { harness, calls } = await harnessFor([]);
    const result = await harness.callTool('simplepractice_request_sign_in_link', {
      email: 'not-an-email',
    });
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
    await harness.close();
  });

  it('surfaces the do-not-retry hint when the API rate-limits the send', async () => {
    const { harness } = await harnessFor([
      { status: 429, body: { errors: [{ title: 'Email request limit reached' }] } },
    ]);
    const result = await confirmed(harness, { email: 'a@example.com' });
    expect(result.isError).toBe(true);
    const text = JSON.stringify(result.content);
    expect(text).toContain('Email request limit reached');
    // The harness renders .hint the same way production does.
    expect(text).toMatch(/Do not retry/);
    await harness.close();
  });
});

describe('simplepractice_verify_sign_in_token', () => {
  it('accepts a full emailed link and reports being signed in', async () => {
    const { harness } = await harnessFor([
      {
        body: { data: { meta: { status: 'verified' } } },
        setCookie: ['simplepractice-session=S; HttpOnly'],
      },
    ]);
    const out = parseToolResult<any>(
      await harness.callTool('simplepractice_verify_sign_in_token', {
        link: 'https://achievebalancetherapy.clientsecure.me/sign-in/token#tok',
      })
    );
    expect(out).toEqual({
      status: 'verified',
      signedIn: true,
      practiceHost: 'achievebalancetherapy.clientsecure.me',
    });
    await harness.close();
  });

  it('signs in to the practice named by the link, with nothing configured', async () => {
    delete process.env.SIMPLEPRACTICE_PRACTICE;
    const { harness, calls, client } = await harnessFor([
      {
        body: { data: { meta: { status: 'verified' } } },
        setCookie: ['simplepractice-session=S; HttpOnly'],
      },
    ]);
    const out = parseToolResult<any>(
      await harness.callTool('simplepractice_verify_sign_in_token', {
        link: 'https://otherpractice.clientsecure.me/sign-in/token#tok',
      })
    );
    expect(out.practiceHost).toBe('otherpractice.clientsecure.me');
    expect(calls[0].url).toBe(
      'https://otherpractice.clientsecure.me/client-portal-api/sessions/token'
    );
    // And it sticks, so the reads that follow need no configuration either.
    expect(client.portalHost()).toBe('otherpractice.clientsecure.me');
    await harness.close();
  });

  it('asks which practice when a bare token arrives and none is known', async () => {
    delete process.env.SIMPLEPRACTICE_PRACTICE;
    const { harness, calls } = await harnessFor([]);
    const result = await harness.callTool('simplepractice_verify_sign_in_token', { link: 'tok' });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toMatch(/which practice/i);
    // A single-use token must not be spent against a guessed host.
    expect(calls).toHaveLength(0);
    await harness.close();
  });

  it('reports an expired link as an error with the remedy', async () => {
    const { harness } = await harnessFor([{ body: { data: { meta: { status: 'expired' } } } }]);
    const result = await harness.callTool('simplepractice_verify_sign_in_token', { link: 'tok' });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toMatch(/Request a new one/);
    await harness.close();
  });
});

describe('simplepractice_verify_sign_in_pin', () => {
  it('rejects a PIN that is not six digits, before any network call', async () => {
    const { harness, calls } = await harnessFor([]);
    const result = await harness.callTool('simplepractice_verify_sign_in_pin', {
      email: 'a@example.com',
      pin: '12345',
    });
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
    await harness.close();
  });

  it('accepts a six-digit PIN', async () => {
    const { harness } = await harnessFor([
      { body: { data: { meta: { status: 'verified' } } }, setCookie: ['simplepractice-session=S'] },
    ]);
    const out = parseToolResult<any>(
      await harness.callTool('simplepractice_verify_sign_in_pin', {
        email: 'a@example.com',
        pin: '123456',
      })
    );
    expect(out.signedIn).toBe(true);
    await harness.close();
  });
});

describe('session status and sign out', () => {
  it('reports not signed in before any sign-in, without a network call', async () => {
    const { harness, calls } = await harnessFor([]);
    const out = parseToolResult<any>(await harness.callTool('simplepractice_session_status'));
    expect(out.signedIn).toBe(false);
    expect(out.practiceHost).toBe('achievebalancetherapy.clientsecure.me');
    expect(calls).toHaveLength(0);
    await harness.close();
  });

  it('reports signed in, and then signs out', async () => {
    const { harness, client } = await harnessFor([]);
    client.saveSession('simplepractice-session=S');
    const before = parseToolResult<any>(await harness.callTool('simplepractice_session_status'));
    expect(before.signedIn).toBe(true);
    expect(before.signedInAt).toEqual(expect.any(String));

    const out = parseToolResult<any>(await harness.callTool('simplepractice_sign_out'));
    expect(out.signedOut).toBe(true);
    const after = parseToolResult<any>(await harness.callTool('simplepractice_session_status'));
    expect(after.signedIn).toBe(false);
    await harness.close();
  });

  it('reports an unknown practice as state, not as a failure', async () => {
    // Knowing no practice is what a first run looks like now, not a
    // misconfiguration: the sign-in link is what supplies it.
    delete process.env.SIMPLEPRACTICE_PRACTICE;
    const { harness } = await harnessFor([]);
    const out = parseToolResult<any>(await harness.callTool('simplepractice_session_status'));
    expect(out.practiceHost).toBeNull();
    expect(out.practiceSource).toBeNull();
    expect(out.signedIn).toBe(false);
    expect(out.next).toMatch(/simplepractice_verify_sign_in_token/);
    await harness.close();
  });

  it('says where the practice came from', async () => {
    const { harness } = await harnessFor([]);
    const out = parseToolResult<any>(await harness.callTool('simplepractice_session_status'));
    expect(out.practiceSource).toBe('environment');
    await harness.close();
  });

  it('signs out without a practice rather than failing', async () => {
    delete process.env.SIMPLEPRACTICE_PRACTICE;
    const { harness } = await harnessFor([]);
    const out = parseToolResult<any>(await harness.callTool('simplepractice_sign_out'));
    expect(out.signedOut).toBe(false);
    await harness.close();
  });
});

describe('naming the practice on the request tool', () => {
  it('bootstraps an unconfigured server so a link can be requested at all', async () => {
    delete process.env.SIMPLEPRACTICE_PRACTICE;
    const { harness, calls } = await harnessFor([
      { status: 202, body: { data: { attributes: { expiresIn: '24 hours' } } } },
    ]);
    const out = parseToolResult<any>(
      await confirmed(harness, { email: 'a@example.com', practice: 'otherpractice' })
    );
    expect(calls[0].url).toBe(
      'https://otherpractice.clientsecure.me/client-portal-api/sign-in-tokens'
    );
    expect(out.practiceHost).toBe('otherpractice.clientsecure.me');
    await harness.close();
  });

  it('names the practice in the preview, before anything is sent', async () => {
    delete process.env.SIMPLEPRACTICE_PRACTICE;
    const { harness, calls } = await harnessFor([]);
    const out = parseToolResult<any>(
      await harness.callTool('simplepractice_request_sign_in_link', {
        email: 'a@example.com',
        practice: 'https://otherpractice.clientsecure.me/',
      })
    );
    expect(out.status).toBe('confirmation-required');
    expect(out.preview.practiceHost).toBe('otherpractice.clientsecure.me');
    expect(calls).toHaveLength(0);
    await harness.close();
  });

  it('does not adopt the practice on the preview call, which sends nothing', async () => {
    // A preview is inert by construction — the confirmation gate exists so that it
    // is. Repointing the process from a preview overrides an explicit
    // SIMPLEPRACTICE_PRACTICE pin for a send that never happened.
    const { harness, client, calls } = await harnessFor([]);
    await harness.callTool('simplepractice_request_sign_in_link', {
      email: 'a@example.com',
      practice: 'otherpractice',
    });
    expect(client.portalHost()).toBe('achievebalancetherapy.clientsecure.me');
    expect(client.practiceSource()).toBe('environment');
    expect(calls).toHaveLength(0);
    await harness.close();
  });

  it('does not adopt the practice when the send is rejected', async () => {
    // Same rule as the sign-in exchange: a practice is earned by working.
    const { harness, client } = await harnessFor([
      { status: 429, body: { errors: [{ title: 'Email request limit reached' }] } },
    ]);
    const result = await confirmed(harness, { email: 'a@example.com', practice: 'otherpractice' });
    expect(result.isError).toBe(true);
    expect(client.portalHost()).toBe('achievebalancetherapy.clientsecure.me');
    await harness.close();
  });

  it('adopts the practice once the send succeeds, so the link need not repeat it', async () => {
    const { harness, client } = await harnessFor([
      { status: 202, body: { data: { attributes: { expiresIn: '24 hours' } } } },
    ]);
    await confirmed(harness, { email: 'a@example.com', practice: 'otherpractice' });
    expect(client.portalHost()).toBe('otherpractice.clientsecure.me');
    expect(client.practiceSource()).toBe('link');
    await harness.close();
  });

  it('refuses a practice that is not a Client Portal address, even once confirmed', async () => {
    const accept = async () => ({ action: 'accept' as const, content: { confirmed: true } });
    for (const elicit of [undefined, accept]) {
      const { harness, calls } = await harnessFor([], elicit);
      const result = await harness.callTool('simplepractice_request_sign_in_link', {
        email: 'a@example.com',
        practice: 'evil.example.com',
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toMatch(/not a SimplePractice Client Portal address/);
      expect(calls).toHaveLength(0);
      await harness.close();
    }
  });

  it('asks which practice when the server knows none and none is given', async () => {
    delete process.env.SIMPLEPRACTICE_PRACTICE;
    const accept = async () => ({ action: 'accept' as const, content: { confirmed: true } });
    for (const elicit of [undefined, accept]) {
      const { harness, calls } = await harnessFor([], elicit);
      const result = await harness.callTool('simplepractice_request_sign_in_link', {
        email: 'a@example.com',
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toMatch(/which practice/i);
      expect(calls).toHaveLength(0);
      await harness.close();
    }
  });
});
