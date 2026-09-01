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

async function harnessFor(responses: StubResponse[] = []) {
  const made = makeClient(responses);
  const harness = await createTestHarness((server) => registerAuthTools(server, made.client));
  return { ...made, harness };
}

describe('simplepractice_request_sign_in_link', () => {
  it('makes NO network call without confirm, and previews what it would send', async () => {
    const { harness, calls } = await harnessFor([]);
    const out = parseToolResult<any>(
      await harness.callTool('simplepractice_request_sign_in_link', { email: 'a@example.com' })
    );
    expect(out.dryRun).toBe(true);
    expect(out.to).toBe('a@example.com');
    // The gate has to be real: sending is rate-limited per address AND per IP,
    // and there is no other way into the portal.
    expect(calls).toHaveLength(0);
    await harness.close();
  });

  it('sends only once confirmed, and points at the next step', async () => {
    const { harness, calls } = await harnessFor([
      { status: 202, body: { data: { attributes: { expiresIn: '24 hours' } } } },
    ]);
    const out = parseToolResult<any>(
      await harness.callTool('simplepractice_request_sign_in_link', {
        email: 'a@example.com',
        confirm: true,
      })
    );
    expect(calls).toHaveLength(1);
    expect(out.sent).toBe(true);
    expect(out.expiresIn).toBe('24 hours');
    expect(out.next).toMatch(/simplepractice_verify_sign_in_token/);
    await harness.close();
  });

  it('does not claim the address has an account', async () => {
    const { harness } = await harnessFor([{ status: 202, body: { data: {} } }]);
    const out = parseToolResult<any>(
      await harness.callTool('simplepractice_request_sign_in_link', {
        email: 'nobody@example.com',
        confirm: true,
      })
    );
    // The API answers identically for unknown addresses, by design.
    expect(out.note).toMatch(/same whether or not the address has an account/);
    await harness.close();
  });

  it('rejects a malformed address before any network call', async () => {
    const { harness, calls } = await harnessFor([]);
    const result = await harness.callTool('simplepractice_request_sign_in_link', {
      email: 'not-an-email',
      confirm: true,
    });
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
    await harness.close();
  });

  it('surfaces the do-not-retry hint when the API rate-limits the send', async () => {
    const { harness } = await harnessFor([
      { status: 429, body: { errors: [{ title: 'Email request limit reached' }] } },
    ]);
    const result = await harness.callTool('simplepractice_request_sign_in_link', {
      email: 'a@example.com',
      confirm: true,
    });
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
      await harness.callTool('simplepractice_request_sign_in_link', {
        email: 'a@example.com',
        practice: 'otherpractice',
        confirm: true,
      })
    );
    expect(calls[0].url).toBe(
      'https://otherpractice.clientsecure.me/client-portal-api/sign-in-tokens'
    );
    expect(out.practiceHost).toBe('otherpractice.clientsecure.me');
    await harness.close();
  });

  it('names the practice in the dry run, before anything is sent', async () => {
    delete process.env.SIMPLEPRACTICE_PRACTICE;
    const { harness, calls } = await harnessFor([]);
    const out = parseToolResult<any>(
      await harness.callTool('simplepractice_request_sign_in_link', {
        email: 'a@example.com',
        practice: 'https://otherpractice.clientsecure.me/',
      })
    );
    expect(out.dryRun).toBe(true);
    expect(out.practiceHost).toBe('otherpractice.clientsecure.me');
    expect(calls).toHaveLength(0);
    await harness.close();
  });

  it('does not adopt the practice on a dry run, which sends nothing', async () => {
    // A dry run is inert by construction — the confirm gate exists so that it
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
    const result = await harness.callTool('simplepractice_request_sign_in_link', {
      email: 'a@example.com',
      practice: 'otherpractice',
      confirm: true,
    });
    expect(result.isError).toBe(true);
    expect(client.portalHost()).toBe('achievebalancetherapy.clientsecure.me');
    await harness.close();
  });

  it('adopts the practice once the send succeeds, so the link need not repeat it', async () => {
    const { harness, client } = await harnessFor([
      { status: 202, body: { data: { attributes: { expiresIn: '24 hours' } } } },
    ]);
    await harness.callTool('simplepractice_request_sign_in_link', {
      email: 'a@example.com',
      practice: 'otherpractice',
      confirm: true,
    });
    expect(client.portalHost()).toBe('otherpractice.clientsecure.me');
    expect(client.practiceSource()).toBe('link');
    await harness.close();
  });

  it('refuses a practice that is not a Client Portal address', async () => {
    const { harness, calls } = await harnessFor([]);
    const result = await harness.callTool('simplepractice_request_sign_in_link', {
      email: 'a@example.com',
      practice: 'evil.example.com',
      confirm: true,
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toMatch(/not a SimplePractice Client Portal address/);
    expect(calls).toHaveLength(0);
    await harness.close();
  });

  it('asks which practice when the server knows none and none is given', async () => {
    delete process.env.SIMPLEPRACTICE_PRACTICE;
    const { harness, calls } = await harnessFor([]);
    const result = await harness.callTool('simplepractice_request_sign_in_link', {
      email: 'a@example.com',
      confirm: true,
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toMatch(/which practice/i);
    expect(calls).toHaveLength(0);
    await harness.close();
  });
});
