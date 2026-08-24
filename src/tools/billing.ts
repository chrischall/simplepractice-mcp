import { z } from 'zod';
import { textResult, toolAnnotations } from '@chrischall/mcp-utils';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SimplePracticeClient } from '../client.js';
import { asBoolean } from '../jsonapi.js';

const PAGE_SIZE_MAX = 50;

/**
 * `billing-items` is one polymorphic collection switched by `filter[thisType]`.
 * Account history is the odd one out: two types at once, plus a condition.
 */
const KINDS = {
  invoice: { thisType: 'invoice' },
  statement: { thisType: 'statement' },
  superbill: { thisType: 'superbill' },
  receipt: { thisType: 'receipt' },
  'account-history': { thisType: 'billable-item,payment', thisTypeCondition: 'unallocated' },
} as const;

/**
 * Read one relationship off the current client record.
 *
 * Billing overview and saved cards hang off `/clients/<id>` via `include=`;
 * there is no `/client-billing-overviews` or `/cards` collection. Asking for
 * one gets HTTP 200 and the Ember app shell, which reads like success.
 */
async function loadClientRelationship(
  client: SimplePracticeClient,
  relationship: 'clientBillingOverview' | 'cards'
): Promise<any> {
  const id = await client.currentClientId();
  if (id === null) return null;
  const { records } = await client.list(`/clients/${encodeURIComponent(id)}`, {
    include: relationship,
  });
  return records[0]?.[relationship] ?? null;
}

export function registerBillingTools(server: McpServer, client: SimplePracticeClient): void {
  server.registerTool(
    'simplepractice_list_billing_items',
    {
      description:
        'Invoices, statements, superbills, receipts, or account history from the Client Portal. An empty list is a real answer — many practices bill entirely outside the portal. Pages by cursor: pass the returned nextCursor as "before".',
      annotations: toolAnnotations({ readOnly: true }),
      inputSchema: {
        kind: z
          .enum(['invoice', 'statement', 'superbill', 'receipt', 'account-history'])
          .default('invoice'),
        before: z
          .string()
          .optional()
          .describe('Cursor for the next page — the nextCursor from a previous call.'),
        pageSize: z.number().int().positive().max(PAGE_SIZE_MAX).default(PAGE_SIZE_MAX),
      },
    },
    async ({ kind, before, pageSize }) => {
      const { records, meta } = await client.list('/billing-items', {
        filter: KINDS[kind],
        page: before ? { size: pageSize, before } : { size: pageSize },
      });
      const last = records[records.length - 1];
      return textResult({
        kind,
        count: records.length,
        endBalance: meta?.endBalance ?? null,
        // The cursor is the row's cursorId, NOT its id.
        nextCursor: records.length >= pageSize ? (last?.cursorId ?? null) : null,
        items: records,
      });
    }
  );

  server.registerTool(
    'simplepractice_get_billing_overview',
    {
      description:
        'Balance due and per-category counts for the Client Portal account. Cheaper than paging the billing collections just to find out whether anything is there.',
      annotations: toolAnnotations({ readOnly: true }),
      inputSchema: {},
    },
    async () => {
      const overview = await loadClientRelationship(client, 'clientBillingOverview');
      return textResult(overview ?? { note: 'No billing overview returned for this client.' });
    }
  );

  server.registerTool(
    'simplepractice_list_payment_methods',
    {
      description:
        'Payment methods saved to the Client Portal — brand, last four digits, and expiry. No full card numbers.',
      annotations: toolAnnotations({ readOnly: true }),
      inputSchema: {},
    },
    async () => {
      const cards = await loadClientRelationship(client, 'cards');
      const list = Array.isArray(cards) ? cards : [];
      return textResult({
        count: list.length,
        paymentMethods: list.map((c) => ({
          id: c.id,
          brand: c.brand,
          last4: c.last4,
          expiry: c.expiry ?? [c.expMonth, c.expYear].filter(Boolean).join('/'),
          // Another stringly-typed boolean, like hasDocumentPdf.
          isDefault: asBoolean(c.isDefault) ?? false,
        })),
      });
    }
  );
}
