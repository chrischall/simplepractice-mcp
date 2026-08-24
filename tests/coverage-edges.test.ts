import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestHarness, parseToolResult } from '@chrischall/mcp-utils/test';
import { VERSION } from '../src/version.js';
import { SimplePracticeClient } from '../src/client.js';
import { requestSignInLink } from '../src/auth.js';
import { registerAccountTools } from '../src/tools/account.js';
import { registerBillingTools } from '../src/tools/billing.js';
import { registerDocumentTools } from '../src/tools/documents.js';
import { makeClient, makeSignedInClient, stubFetch, type StubResponse } from './helpers.js';

const saved = { ...process.env };
beforeEach(() => {
  process.env.SIMPLEPRACTICE_PRACTICE = 'achievebalancetherapy';
});
afterEach(() => {
  process.env = { ...saved };
});

describe('version', () => {
  it('exports a semver string that release-please rewrites in place', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('client defaults', () => {
  it('builds its own SessionStore when none is injected', () => {
    // Point it at a throwaway file first — the default is the user's real one.
    process.env.SIMPLEPRACTICE_SESSION_FILE = join(
      mkdtempSync(join(tmpdir(), 'sp-default-')),
      'session.json'
    );
    const client = new SimplePracticeClient({ fetchImpl: stubFetch([]).fetchImpl });
    expect(client.getSession()).toBeNull();
    client.saveSession('simplepractice-session=S');
    expect(client.getSession()?.cookie).toBe('simplepractice-session=S');
  });
});

describe('sign-in link response variants', () => {
  it('reads expiresIn when the API answers with a data array', async () => {
    const { client } = makeClient([
      { status: 202, body: { data: [{ attributes: { expiresIn: '24 hours' } }] } },
    ]);
    await expect(requestSignInLink(client, 'a@example.com')).resolves.toEqual({
      expiresIn: '24 hours',
    });
  });
});

async function harness(register: any, responses: StubResponse[]) {
  const made = makeSignedInClient(responses);
  const h = await createTestHarness((server) => register(server, made.client));
  return { ...made, harness: h };
}

describe('degenerate payloads', () => {
  it('omits a client name when neither a preferred nor a given name is present', async () => {
    const { harness: h } = await harness(registerAccountTools, [
      {
        body: {
          data: {
            id: 'production',
            type: 'environments',
            relationships: { currentClientOptions: { data: [{ id: '9', type: 'clients' }] } },
          },
          included: [{ id: '9', type: 'clients', attributes: {} }],
        },
      },
    ]);
    const out = parseToolResult<any>(await h.callTool('simplepractice_get_account'));
    expect(out.clients).toEqual([{ id: '9', name: '' }]);
    await h.close();
  });

  it('reports a null cursor when a full page carries no cursorId', async () => {
    const { harness: h } = await harness(registerBillingTools, [
      { body: { data: [{ id: '1', type: 'invoices', attributes: {} }] } },
    ]);
    const out = parseToolResult<any>(
      await h.callTool('simplepractice_list_billing_items', { pageSize: 1 })
    );
    expect(out.nextCursor).toBeNull();
    await h.close();
  });

  it('reports a null balance when the document carries no meta', async () => {
    const { harness: h } = await harness(registerBillingTools, [{ body: { data: [] } }]);
    const out = parseToolResult<any>(await h.callTool('simplepractice_list_billing_items'));
    expect(out.endBalance).toBeNull();
    await h.close();
  });

  it('defaults an absent hasDocumentPdf to false rather than undefined', async () => {
    const { harness: h } = await harness(registerDocumentTools, [
      { body: { data: [{ id: '1', type: 'documentRequestNotes', attributes: { status: 'sent' } }] } },
    ]);
    const out = parseToolResult<any>(
      await h.callTool('simplepractice_list_document_requests')
    );
    expect(out.documentRequests[0].hasDocumentPdf).toBe(false);
    await h.close();
  });

  it('defaults an absent hasDocumentPdf to false on a single request too', async () => {
    const { harness: h } = await harness(registerDocumentTools, [
      { body: { data: { id: '1', type: 'documentRequestNotes', attributes: { status: 'sent' } } } },
    ]);
    const out = parseToolResult<any>(
      await h.callTool('simplepractice_get_document_request', { id: '1' })
    );
    expect(out.hasDocumentPdf).toBe(false);
    await h.close();
  });
});
