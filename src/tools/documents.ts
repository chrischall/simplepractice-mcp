import { z } from 'zod';
import { isCompact, viewArg, viewResponse } from '../view.js';
import { minifiedResult, toolAnnotations } from '@chrischall/mcp-utils';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SimplePracticeClient } from '../client.js';
import { asBoolean } from '../jsonapi.js';

const PAGE_SIZE_MAX = 50;

/** Statuses that mean the client has nothing left to do. */
const SETTLED = new Set(['completed', 'locked']);

export function registerDocumentTools(server: McpServer, client: SimplePracticeClient): void {
  server.registerTool(
    'simplepractice_list_document_requests',
    {
      description:
        'Paperwork the practice has sent — consents, questionnaires, contact and insurance forms, Good Faith Estimates, shared files. Use outstandingOnly to see just what still needs the client\'s attention.',
      annotations: toolAnnotations({ readOnly: true }),
      inputSchema: {
        outstandingOnly: z
          .boolean()
          .default(false)
          .describe('Return only requests that are not completed or locked.'),
        pageSize: z.number().int().positive().max(PAGE_SIZE_MAX).default(PAGE_SIZE_MAX),
        includeBody: z
          .boolean()
          .default(false)
          .describe('Include the full document body/questions. Off by default — these are long.'),
      },
    },
    async ({ outstandingOnly, pageSize, includeBody }) => {
      const { records, meta } = await client.list('/document-requests', {
        page: { size: pageSize },
      });
      const filtered = outstandingOnly
        ? records.filter((r) => !SETTLED.has(String(r.status)))
        : records;
      const items = filtered.map((r) => {
        const base: Record<string, unknown> = {
          id: r.id,
          // The subtype IS the type field — documentRequestQuestionnaires etc.
          kind: r.type,
          title: r.documentTitle,
          status: r.status,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          // Arrives as the STRING "true"/"false" on the wire, so a plain
          // truthiness test would report every row as having a PDF.
          hasDocumentPdf: asBoolean(r.hasDocumentPdf) ?? false,
        };
        if (includeBody) {
          base.documentBody = r.documentBody;
          base.templateQuestions = r.templateQuestions;
          base.userAnswers = r.userAnswers;
        }
        return base;
      });
      return minifiedResult({
        count: items.length,
        outstanding: records.filter((r) => !SETTLED.has(String(r.status))).length,
        welcomeText: meta?.welcomeText ?? null,
        documentRequests: items,
      });
    }
  );

  server.registerTool(
    'simplepractice_get_document_request',
    {
      description:
        'One document request in full, including its body or its questions and the answers already given.',
      annotations: toolAnnotations({ readOnly: true }),
      inputSchema: { id: z.string().min(1).describe('The document request id.') },
    },
    async ({ id }) => {
      const { records } = await client.list(`/document-requests/${encodeURIComponent(id)}`);
      const record = records[0];
      if (!record) return minifiedResult({ found: false, id });
      return minifiedResult({
        ...record,
        hasDocumentPdf: asBoolean(record.hasDocumentPdf) ?? false,
      });
    }
  );

  server.registerTool(
    'simplepractice_list_documents',
    {
      description: 'Files the practice has shared through the Client Portal.',
      annotations: toolAnnotations({ readOnly: true }),
      inputSchema: {
        pageSize: z.number().int().positive().max(PAGE_SIZE_MAX).default(PAGE_SIZE_MAX),
      },
    },
    async ({ pageSize }) => {
      const { records } = await client.list('/documents', { page: { size: pageSize } });
      return minifiedResult({ count: records.length, documents: records });
    }
  );

  server.registerTool(
    'simplepractice_list_announcements',
    {
      description:
        'Announcements the practice has posted to the Client Portal. readAt is null on unread ones.',
      annotations: toolAnnotations({ readOnly: true }),
      inputSchema: {
        pageSize: z.number().int().positive().max(PAGE_SIZE_MAX).default(PAGE_SIZE_MAX),
      },
    },
    async ({ pageSize }) => {
      const { records } = await client.list('/announcements', { page: { size: pageSize } });
      return minifiedResult({
        count: records.length,
        unread: records.filter((r) => r.readAt === null || r.readAt === undefined).length,
        announcements: records,
      });
    }
  );
}
