import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createTestHarness } from '@chrischall/mcp-utils/test';
import { registerAuthTools } from '../src/tools/auth.js';
import { registerAccountTools } from '../src/tools/account.js';
import { registerAppointmentTools } from '../src/tools/appointments.js';
import { registerBillingTools } from '../src/tools/billing.js';
import { registerDocumentTools } from '../src/tools/documents.js';
import { registerHealthcheckTools } from '../src/tools/health.js';
import { makeSignedInClient, type StubResponse } from './helpers.js';

/**
 * Context-group hints (`_meta.mint`, the mcp-host context-groups contract),
 * asserted against the SERVED tool list — what a host actually sees.
 */
const REGISTRARS = [
  registerAuthTools,
  registerAccountTools,
  registerAppointmentTools,
  registerBillingTools,
  registerDocumentTools,
  registerHealthcheckTools,
];

const DOMAINS = ['school', 'home', 'work', 'family', 'health', 'money', 'travel', 'food'];
const INTENTS = ['whats-new', 'whats-due', 'whats-on', 'lookup', 'turn-on-off', 'send', 'change', 'other'];
const CANONICAL_INTENTS = ['whats-new', 'whats-due', 'whats-on'];
const KEYS = ['domain', 'intent', 'canonical', 'subject', 'when', 'aliases'];

type Listed = {
  name: string;
  inputSchema: { properties?: Record<string, any> };
  annotations?: { readOnlyHint?: boolean };
  _meta?: { mint?: Record<string, any> };
};

const saved = { ...process.env };
beforeEach(() => {
  process.env.SIMPLEPRACTICE_PRACTICE = 'example-practice';
});
afterEach(() => {
  process.env = { ...saved };
});

async function harness(responses: StubResponse[] = []) {
  const { client } = makeSignedInClient(responses);
  return createTestHarness((server) => {
    for (const register of REGISTRARS) register(server, client);
  });
}

async function served(): Promise<Listed[]> {
  const h = await harness();
  const { tools } = await h.client.listTools();
  await h.close();
  return tools as Listed[];
}

/** The intent every tool declares — this table is the assertion. */
const EXPECTED_INTENT: Record<string, string> = {
  simplepractice_session_status: 'lookup',
  simplepractice_request_sign_in_link: 'other',
  simplepractice_verify_sign_in_token: 'other',
  simplepractice_verify_sign_in_pin: 'other',
  simplepractice_sign_out: 'other',
  simplepractice_get_account: 'lookup',
  simplepractice_list_appointments: 'whats-on',
  simplepractice_list_billing_items: 'lookup',
  simplepractice_get_billing_overview: 'lookup',
  simplepractice_list_payment_methods: 'lookup',
  simplepractice_list_document_requests: 'whats-due',
  simplepractice_get_document_request: 'lookup',
  simplepractice_list_documents: 'lookup',
  simplepractice_list_announcements: 'whats-new',
};

const CANONICAL = {
  simplepractice_list_announcements: 'whats-new',
  simplepractice_list_document_requests: 'whats-due',
  simplepractice_list_appointments: 'whats-on',
};

function textOf(result: unknown): string {
  const content = (result as { content: Array<{ type: string; text: string }> }).content;
  return content.map((c) => c.text).join('\n');
}

/** `title — <ISO date | no date> — <status>`, at most 120 characters. */
const BRIEF_SHAPE = /^.+ — (\d{4}-\d{2}-\d{2}\S*|no date) — \S.*$/;

describe('_meta.mint on the served tool list', () => {
  it('names every served tool, so a new tool cannot skip the decision', async () => {
    const names = (await served()).map((t) => t.name).sort();
    expect(names).toEqual([...Object.keys(EXPECTED_INTENT), 'simplepractice_healthcheck'].sort());
  });

  it('leaves only the mcp-utils healthcheck unhinted', async () => {
    const unhinted = (await served()).filter((t) => !t._meta?.mint).map((t) => t.name);
    expect(unhinted).toEqual(['simplepractice_healthcheck']);
  });

  it.each(Object.entries(EXPECTED_INTENT))('%s declares domain health and intent %s', async (name, intent) => {
    const mint = (await served()).find((t) => t.name === name)?._meta?.mint;
    expect(mint).toBeDefined();
    expect(mint!.domain).toBe('health');
    expect(mint!.intent).toBe(intent);
  });

  it('every hint is shaped per the host contract', async () => {
    for (const t of await served()) {
      const mint = t._meta?.mint;
      if (!mint) continue;
      const props = t.inputSchema.properties ?? {};
      expect(Object.keys(mint).filter((k) => !KEYS.includes(k)), t.name).toEqual([]);
      expect(DOMAINS, t.name).toContain(mint.domain);
      expect(INTENTS, t.name).toContain(mint.intent);
      if ('canonical' in mint) {
        expect(mint.canonical, t.name).toBe(true);
        expect(t.annotations?.readOnlyHint, t.name).toBe(true);
        expect(CANONICAL_INTENTS, t.name).toContain(mint.intent);
      }
      if ('subject' in mint) expect(props, t.name).toHaveProperty(mint.subject);
      if ('when' in mint) {
        expect(Object.keys(mint.when).sort(), t.name).toEqual(['end', 'start']);
        expect(props, t.name).toHaveProperty(mint.when.start);
        expect(props, t.name).toHaveProperty(mint.when.end);
      }
      if ('aliases' in mint) {
        expect(mint.aliases.length, t.name).toBeGreaterThan(0);
        expect(mint.aliases.length, t.name).toBeLessThanOrEqual(8);
        for (const a of mint.aliases) {
          expect(a.length, t.name).toBeLessThanOrEqual(40);
          expect(a, t.name).toBe(a.toLowerCase());
        }
      }
    }
  });

  it('marks one canonical read per what’s-new / what’s-due / what’s-on', async () => {
    const tools = await served();
    const canonical = tools.filter((t) => t._meta?.mint?.canonical === true);
    expect(Object.fromEntries(canonical.map((t) => [t.name, t._meta!.mint!.intent]))).toEqual(CANONICAL);
    for (const intent of CANONICAL_INTENTS) {
      expect(canonical.filter((t) => t._meta!.mint!.intent === intent).length, intent).toBeLessThanOrEqual(1);
    }
  });

  it('declares no subject or range: one portal login answers for the signed-in client only, and no canonical read takes a range', async () => {
    for (const t of await served()) {
      expect(t._meta?.mint ?? {}, t.name).not.toHaveProperty('subject');
      expect(t._meta?.mint ?? {}, t.name).not.toHaveProperty('when');
    }
  });

  it('every canonical read accepts view "brief"', async () => {
    for (const t of await served()) {
      if (t._meta?.mint?.canonical !== true) continue;
      expect(t.inputSchema.properties?.view?.enum, t.name).toContain('brief');
    }
  });

  it('aliases are words a person says, never tool names', async () => {
    for (const t of await served()) {
      for (const a of t._meta?.mint?.aliases ?? []) expect(a, t.name).not.toMatch(/simplepractice|_/);
    }
  });
});

describe('view "brief" on the canonical reads', () => {
  const longTitle = 'A'.repeat(200);

  it('appointments: one line per appointment, service — start — status', async () => {
    const h = await harness([
      {
        body: {
          data: [
            {
              id: '1',
              type: 'appointments',
              attributes: {
                startTime: '2026-11-10T10:00:00-05:00',
                serviceDescription: 'Psychotherapy, 45 min',
                confirmationStatus: 'confirmed',
              },
              relationships: { clinician: { data: { id: '3', type: 'clinicians' } } },
            },
            { id: '2', type: 'appointments', attributes: { serviceDescription: longTitle } },
            { id: '3', type: 'appointments', attributes: {} },
          ],
          included: [{ id: '3', type: 'clinicians', attributes: { firstName: 'Test', lastName: 'Clinician' } }],
        },
      },
    ]);
    const lines = textOf(await h.callTool('simplepractice_list_appointments', { view: 'brief' })).split('\n');
    await h.close();
    expect(lines).toEqual([
      'Psychotherapy, 45 min with Test Clinician — 2026-11-10T10:00:00-05:00 — confirmed',
      expect.stringMatching(/^A+… — no date — scheduled$/),
      'Appointment — no date — scheduled',
    ]);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(120);
      expect(line).toMatch(BRIEF_SHAPE);
    }
  });

  it('appointments: a requested one says requested', async () => {
    const h = await harness([
      { body: { data: [{ id: '1', type: 'appointments', attributes: { startTime: '2026-11-11T09:00:00Z' } }] } },
    ]);
    const text = textOf(await h.callTool('simplepractice_list_appointments', { status: 'requested', view: 'brief' }));
    await h.close();
    expect(text).toBe('Appointment — 2026-11-11T09:00:00Z — requested');
  });

  it('appointments: nothing scheduled answers an empty text, not a line', async () => {
    const h = await harness([{ body: { data: [] } }]);
    const text = textOf(await h.callTool('simplepractice_list_appointments', { view: 'brief' }));
    await h.close();
    expect(text).toBe('');
  });

  it('document requests: outstanding paperwork only, title — no date — status', async () => {
    const h = await harness([
      {
        body: {
          data: [
            { id: '1', type: 'documentRequestConsentDocuments', attributes: { documentTitle: 'Consent form', status: 'sent' } },
            { id: '2', type: 'documentRequestQuestionnaires', attributes: { documentTitle: 'Done', status: 'completed' } },
            { id: '3', type: 'documentRequestNotes', attributes: { documentTitle: 'Locked', status: 'locked' } },
            { id: '4', type: 'documentRequestInsuranceInfos', attributes: { status: 'viewed' } },
            { id: '5', type: 'documentRequestNotes', attributes: { documentTitle: longTitle } },
            { id: '6', type: ' ', attributes: { documentTitle: '  ', status: 'reviewing' } },
          ],
        },
      },
    ]);
    const lines = textOf(await h.callTool('simplepractice_list_document_requests', { view: 'brief' })).split('\n');
    await h.close();
    expect(lines).toEqual([
      'Consent form — no date — sent',
      'documentRequestInsuranceInfos — no date — viewed',
      expect.stringMatching(/^A+… — no date — outstanding$/),
      'Document request — no date — reviewing',
    ]);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(120);
      expect(line).toMatch(BRIEF_SHAPE);
    }
  });

  it('document requests: the default view is unchanged', async () => {
    const h = await harness([
      { body: { data: [{ id: '1', type: 'documentRequestNotes', attributes: { documentTitle: 'X', status: 'sent' } }] } },
    ]);
    const text = textOf(await h.callTool('simplepractice_list_document_requests', { view: 'compact' }));
    await h.close();
    expect(JSON.parse(text)).toMatchObject({ count: 1, outstanding: 1 });
  });

  it('announcements: unread ones only, title — posted — unread', async () => {
    const h = await harness([
      {
        body: {
          data: [
            { id: '1', type: 'announcements', attributes: { title: 'Office closed Monday', createdAt: '2026-11-01T12:00:00Z', readAt: null } },
            { id: '2', type: 'announcements', attributes: { title: 'Old news', createdAt: '2026-10-01T12:00:00Z', readAt: '2026-10-02' } },
            { id: '3', type: 'announcements', attributes: { title: 'New\nportal\tfeature', publishedAt: '2026-11-02T08:00:00Z' } },
            { id: '4', type: 'announcements', attributes: {} },
          ],
        },
      },
    ]);
    const lines = textOf(await h.callTool('simplepractice_list_announcements', { view: 'brief' })).split('\n');
    await h.close();
    expect(lines).toEqual([
      'Office closed Monday — 2026-11-01T12:00:00Z — unread',
      'New portal feature — 2026-11-02T08:00:00Z — unread',
      'Announcement — no date — unread',
    ]);
    for (const line of lines) expect(line).toMatch(BRIEF_SHAPE);
  });
});
