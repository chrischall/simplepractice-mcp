import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createTestHarness, parseToolResult } from '@chrischall/mcp-utils/test';
import { registerAuthTools } from '../src/tools/auth.js';
import { registerAccountTools } from '../src/tools/account.js';
import { registerAppointmentTools } from '../src/tools/appointments.js';
import { registerBillingTools } from '../src/tools/billing.js';
import { registerDocumentTools } from '../src/tools/documents.js';
import { makeClient, makeSignedInClient, type StubResponse } from './helpers.js';

const saved = { ...process.env };
beforeEach(() => {
  process.env.SIMPLEPRACTICE_PRACTICE = 'achievebalancetherapy';
});
afterEach(() => {
  process.env = { ...saved };
});

async function harnessFor(
  register: Parameters<typeof registerAuthTools>[0] extends never ? never : any,
  responses: StubResponse[],
  signedIn = true
) {
  const made = signedIn ? makeSignedInClient(responses) : makeClient(responses);
  const harness = await createTestHarness((server) => register(server, made.client));
  return { ...made, harness };
}

describe('simplepractice_get_account', () => {
  const environmentDoc: StubResponse = {
    body: {
      data: {
        id: 'production',
        type: 'environments',
        relationships: {
          currentPractice: { data: { id: '1', type: 'practices' } },
          currentClient: { data: { id: '9', type: 'clients' } },
          currentClientOptions: { data: [{ id: '9', type: 'clients' }] },
        },
      },
      included: [
        {
          id: '1',
          type: 'practices',
          attributes: {
            fullName: 'Achieve Balance, PLLC',
            timeZone: 'America/New_York',
            isClientAllowedToCancelAppt: false,
            clientCancellableHrs: 24,
          },
        },
        {
          id: '9',
          type: 'clients',
          attributes: { firstName: 'Sam', lastName: 'Hall', preferredName: null },
        },
      ],
    },
  };

  it('reports the practice, the current client, and the cancellation policy', async () => {
    const { harness } = await harnessFor(registerAccountTools, [environmentDoc]);
    const out = parseToolResult<any>(await harness.callTool('simplepractice_get_account'));
    expect(out.practice.name).toBe('Achieve Balance, PLLC');
    expect(out.practice.timeZone).toBe('America/New_York');
    // Worth surfacing: telling someone they can cancel when the practice says
    // otherwise is the kind of wrong answer that costs a late-cancel fee.
    expect(out.practice.clientMayCancelAppointments).toBe(false);
    expect(out.practice.cancellationNoticeHours).toBe(24);
    expect(out.currentClient.name).toBe('Sam Hall');
    await harness.close();
  });

  it('always returns clients as a list, since one login can cover several', async () => {
    const { harness } = await harnessFor(registerAccountTools, [environmentDoc]);
    const out = parseToolResult<any>(await harness.callTool('simplepractice_get_account'));
    expect(Array.isArray(out.clients)).toBe(true);
    expect(out.clients).toEqual([{ id: '9', name: 'Sam Hall' }]);
    await harness.close();
  });

  it('prefers a preferred name over the given name', async () => {
    const doc = structuredClone(environmentDoc) as any;
    doc.body.included[1].attributes.preferredName = 'Sammy';
    const { harness } = await harnessFor(registerAccountTools, [doc]);
    const out = parseToolResult<any>(await harness.callTool('simplepractice_get_account'));
    expect(out.currentClient.name).toBe('Sammy Hall');
    await harness.close();
  });

  it('degrades to undefined fields rather than throwing on a bare environment', async () => {
    const { harness } = await harnessFor(registerAccountTools, [{ body: { data: null } }]);
    const out = parseToolResult<any>(await harness.callTool('simplepractice_get_account'));
    expect(out.clients).toEqual([]);
    await harness.close();
  });
});

describe('simplepractice_list_appointments', () => {
  const appointmentsDoc: StubResponse = {
    body: {
      data: [
        {
          id: '55',
          type: 'appointments',
          attributes: {
            startTime: '2026-09-02T10:00:00-04:00',
            serviceDescription: 'Psychotherapy, 45 min',
            isCancellable: true,
          },
          relationships: {
            clinician: { data: { id: '3', type: 'clinicians' } },
            office: { data: { id: '7', type: 'offices' } },
          },
        },
      ],
      included: [
        { id: '3', type: 'clinicians', attributes: { firstName: 'Dana', lastName: 'Reyes' } },
        { id: '7', type: 'offices', attributes: { name: 'Main Office', isVideo: false } },
      ],
    },
  };

  it('asks for the scheduled side of the pending-confirmation filter by default', async () => {
    const { harness, calls } = await harnessFor(registerAppointmentTools, [appointmentsDoc]);
    await harness.callTool('simplepractice_list_appointments');
    expect(calls[0].url).toContain('filter%5BhasPendingConfirmation%5D=false');
    expect(calls[0].url).toContain('include=clinician%2Coffice%2Cclient');
    await harness.close();
  });

  it('flips the filter for requested appointments', async () => {
    const { harness, calls } = await harnessFor(registerAppointmentTools, [appointmentsDoc]);
    await harness.callTool('simplepractice_list_appointments', { status: 'requested' });
    expect(calls[0].url).toContain('filter%5BhasPendingConfirmation%5D=true');
    await harness.close();
  });

  it('joins the clinician and office into a readable projection', async () => {
    const { harness } = await harnessFor(registerAppointmentTools, [appointmentsDoc]);
    const out = parseToolResult<any>(await harness.callTool('simplepractice_list_appointments'));
    expect(out.appointments[0]).toMatchObject({
      clinician: 'Dana Reyes',
      location: 'Main Office',
      service: 'Psychotherapy, 45 min',
    });
    await harness.close();
  });

  it('labels a video office as telehealth rather than as an address', async () => {
    const doc = structuredClone(appointmentsDoc) as any;
    doc.body.included[1].attributes = { name: 'Telehealth', isVideo: true };
    const { harness } = await harnessFor(registerAppointmentTools, [doc]);
    const out = parseToolResult<any>(await harness.callTool('simplepractice_list_appointments'));
    expect(out.appointments[0].location).toBe('telehealth');
    await harness.close();
  });

  it('returns full records on view:"full"', async () => {
    const { harness } = await harnessFor(registerAppointmentTools, [appointmentsDoc]);
    const out = parseToolResult<any>(
      await harness.callTool('simplepractice_list_appointments', { view: 'full' })
    );
    expect(out.appointments[0]).toHaveProperty('type', 'appointments');
    await harness.close();
  });

  it('reports hasMore only when the page came back full', async () => {
    const { harness } = await harnessFor(registerAppointmentTools, [appointmentsDoc]);
    const out = parseToolResult<any>(
      await harness.callTool('simplepractice_list_appointments', { pageSize: 1 })
    );
    // The API sends no total, so a full page is the only "there may be more".
    expect(out.hasMore).toBe(true);
    await harness.close();
  });

  it('tolerates an appointment whose relationships were not included', async () => {
    const { harness } = await harnessFor(registerAppointmentTools, [
      { body: { data: [{ id: '1', type: 'appointments', attributes: {} }] } },
    ]);
    const out = parseToolResult<any>(await harness.callTool('simplepractice_list_appointments'));
    expect(out.appointments[0].clinician).toBeUndefined();
    expect(out.appointments[0].location).toBeUndefined();
    await harness.close();
  });
});

describe('simplepractice_list_billing_items', () => {
  it('maps each kind onto the filter the portal actually sends', async () => {
    const cases: Array<[string, string]> = [
      ['invoice', 'filter%5BthisType%5D=invoice'],
      ['statement', 'filter%5BthisType%5D=statement'],
      ['superbill', 'filter%5BthisType%5D=superbill'],
      ['receipt', 'filter%5BthisType%5D=receipt'],
    ];
    for (const [kind, expected] of cases) {
      const { harness, calls } = await harnessFor(registerBillingTools, [{ body: { data: [] } }]);
      await harness.callTool('simplepractice_list_billing_items', { kind });
      expect(calls[0].url).toContain(expected);
      await harness.close();
    }
  });

  it('sends both the paired filters for account history', async () => {
    const { harness, calls } = await harnessFor(registerBillingTools, [{ body: { data: [] } }]);
    await harness.callTool('simplepractice_list_billing_items', { kind: 'account-history' });
    expect(calls[0].url).toContain('filter%5BthisType%5D=billable-item%2Cpayment');
    expect(calls[0].url).toContain('filter%5BthisTypeCondition%5D=unallocated');
    await harness.close();
  });

  it('treats an empty result as a real answer, with the balance from meta', async () => {
    const { harness } = await harnessFor(registerBillingTools, [
      { body: { data: [], meta: { endBalance: '0.0' } } },
    ]);
    const out = parseToolResult<any>(
      await harness.callTool('simplepractice_list_billing_items')
    );
    expect(out.count).toBe(0);
    expect(out.endBalance).toBe('0.0');
    expect(out.nextCursor).toBeNull();
    await harness.close();
  });

  it('pages by cursorId, not by id', async () => {
    const { harness, calls } = await harnessFor(registerBillingTools, [
      {
        body: {
          data: [{ id: '12', type: 'invoices', attributes: { cursorId: 'c-12' } }],
          meta: { endBalance: '1' },
        },
      },
      { body: { data: [] } },
    ]);
    const first = parseToolResult<any>(
      await harness.callTool('simplepractice_list_billing_items', { pageSize: 1 })
    );
    // Using .id here would silently page from the wrong place.
    expect(first.nextCursor).toBe('c-12');
    await harness.callTool('simplepractice_list_billing_items', {
      pageSize: 1,
      before: first.nextCursor,
    });
    expect(calls[1].url).toContain('page%5Bbefore%5D=c-12');
    await harness.close();
  });

  it('offers no cursor when the page was short', async () => {
    const { harness } = await harnessFor(registerBillingTools, [
      { body: { data: [{ id: '1', type: 'invoices', attributes: { cursorId: 'c-1' } }] } },
    ]);
    const out = parseToolResult<any>(
      await harness.callTool('simplepractice_list_billing_items', { pageSize: 50 })
    );
    expect(out.nextCursor).toBeNull();
    await harness.close();
  });

  // Billing overview and cards are relationships on /clients/<id>, NOT
  // collections. `/client-billing-overviews` and `/cards` are not API paths at
  // all — the portal answers them with HTTP 200 and its app shell, which is
  // exactly why the first cut of these tools looked fine and returned nothing.
  const environmentResponse: StubResponse = {
    body: {
      data: {
        id: 'production',
        type: 'environments',
        relationships: { currentClient: { data: { id: '90000001', type: 'clients' } } },
      },
      included: [{ id: '90000001', type: 'clients', attributes: {} }],
    },
  };

  const clientWith = (included: unknown[], relationship: string, ref: unknown): StubResponse => ({
    body: {
      data: {
        id: '90000001',
        type: 'clients',
        attributes: {},
        relationships: { [relationship]: { data: ref } },
      },
      included,
    },
  });

  it('reads the billing overview off the client record, not a collection', async () => {
    const { harness, calls } = await harnessFor(registerBillingTools, [
      environmentResponse,
      clientWith(
        [
          {
            id: '1',
            type: 'clientBillingOverviews',
            attributes: { balanceDue: 0, invoicesCount: 0, insuranceInfoCount: 1 },
          },
        ],
        'clientBillingOverview',
        { id: '1', type: 'clientBillingOverviews' }
      ),
    ]);
    const out = parseToolResult<any>(
      await harness.callTool('simplepractice_get_billing_overview')
    );
    expect(calls[1].url).toContain('/clients/90000001');
    expect(calls[1].url).toContain('include=clientBillingOverview');
    expect(out.balanceDue).toBe(0);
    expect(out.insuranceInfoCount).toBe(1);
    await harness.close();
  });

  it('explains an absent billing overview instead of returning nothing', async () => {
    const { harness } = await harnessFor(registerBillingTools, [
      environmentResponse,
      clientWith([], 'clientBillingOverview', null),
    ]);
    const out = parseToolResult<any>(
      await harness.callTool('simplepractice_get_billing_overview')
    );
    expect(out.note).toMatch(/No billing overview/);
    await harness.close();
  });

  it('says so rather than guessing when no current client can be resolved', async () => {
    const { harness } = await harnessFor(registerBillingTools, [
      { body: { data: { id: 'production', type: 'environments' } } },
    ]);
    const out = parseToolResult<any>(
      await harness.callTool('simplepractice_get_billing_overview')
    );
    expect(out.note).toMatch(/No billing overview/);
    await harness.close();
  });

  it('lists saved cards with brand and last four, and no full number', async () => {
    const { harness, calls } = await harnessFor(registerBillingTools, [
      environmentResponse,
      clientWith(
        [
          {
            id: '1',
            type: 'cards',
            attributes: {
              brand: 'Visa',
              last4: '4242',
              expMonth: 4,
              expYear: 2029,
              isDefault: 'true',
              customStripeCardId: 'card_x',
            },
          },
        ],
        'cards',
        [{ id: '1', type: 'cards' }]
      ),
    ]);
    const out = parseToolResult<any>(
      await harness.callTool('simplepractice_list_payment_methods')
    );
    expect(calls[1].url).toContain('include=cards');
    expect(out.count).toBe(1);
    expect(out.paymentMethods[0]).toEqual({
      id: '1',
      brand: 'Visa',
      last4: '4242',
      expiry: '4/2029',
      isDefault: true,
    });
    // Stripe's own identifiers are not projected out.
    expect(JSON.stringify(out)).not.toContain('card_x');
    await harness.close();
  });

  it('prefers the API-supplied expiry string when it sends one', async () => {
    const { harness } = await harnessFor(registerBillingTools, [
      environmentResponse,
      clientWith(
        [{ id: '1', type: 'cards', attributes: { brand: 'Visa', last4: '1', expiry: '04/2029' } }],
        'cards',
        [{ id: '1', type: 'cards' }]
      ),
    ]);
    const out = parseToolResult<any>(
      await harness.callTool('simplepractice_list_payment_methods')
    );
    expect(out.paymentMethods[0].expiry).toBe('04/2029');
    await harness.close();
  });

  it('coerces the stringly-typed isDefault on cards', async () => {
    const { harness } = await harnessFor(registerBillingTools, [
      environmentResponse,
      clientWith(
        [
          { id: '1', type: 'cards', attributes: { last4: '1', isDefault: 'false' } },
          { id: '2', type: 'cards', attributes: { last4: '2', isDefault: 'true' } },
        ],
        'cards',
        [{ id: '1', type: 'cards' }, { id: '2', type: 'cards' }]
      ),
    ]);
    const out = parseToolResult<any>(
      await harness.callTool('simplepractice_list_payment_methods')
    );
    // "false" is a truthy string; passing it through would mark every card
    // as the default one.
    expect(out.paymentMethods.map((c: any) => c.isDefault)).toEqual([false, true]);
    await harness.close();
  });

  it('treats a missing cards relationship as an empty list, not a crash', async () => {
    const { harness } = await harnessFor(registerBillingTools, [
      environmentResponse,
      { body: { data: { id: '90000001', type: 'clients', attributes: {} } } },
    ]);
    const out = parseToolResult<any>(
      await harness.callTool('simplepractice_list_payment_methods')
    );
    expect(out).toEqual({ count: 0, paymentMethods: [] });
    await harness.close();
  });

  it('reports no cards when the client has none', async () => {
    const { harness } = await harnessFor(registerBillingTools, [
      environmentResponse,
      clientWith([], 'cards', []),
    ]);
    const out = parseToolResult<any>(
      await harness.callTool('simplepractice_list_payment_methods')
    );
    expect(out).toEqual({ count: 0, paymentMethods: [] });
    await harness.close();
  });
});
