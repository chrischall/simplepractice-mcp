import { z } from 'zod';
import { viewArg, viewResponse } from '../view.js';
import {
  minifiedResult,
  toolAnnotations,
  untrustedResult,
  UNTRUSTED_CONTENT_RULE,
  UNTRUSTED_DESCRIPTION_SUFFIX,
} from '@chrischall/mcp-utils';
import type { McpServer } from '@modelcontextprotocol/server';
import type { SimplePracticeClient } from '../client.js';
import { asBoolean } from '../jsonapi.js';

const PAGE_SIZE_MAX = 50;

/**
 * These endpoints page by `page[size]` alone (see docs/SIMPLEPRACTICE-API.md),
 * so a full page may be hiding older rows — and with them outstanding
 * paperwork or unread announcements. The API sends no total; a short page is
 * the last page, as with appointments (fleet-audit#708).
 */
const hasMore = (records: unknown[], pageSize: number) => records.length >= pageSize;
const PARTIAL_NOTE =
  ' Returns at most pageSize (max 50) of the newest rows; hasMore: true means the page came back full and older rows — and the counts over them — may be missing.';

/**
 * Announcement bodies, document titles and bodies, template questions and the
 * welcome text are written by practice staff or come from practice templates,
 * not the user. The practice is usually trusted, but in a group practice — or
 * with a compromised practice account — that text reaches a session that also
 * holds billing and payment-method tools, so it is fenced as data
 * (fleet-audit#896).
 */
const PRACTICE_TEXT_NOTE =
  'Titles, bodies, questions, announcements and welcome text below are written by the practice, not the user. ' +
  UNTRUSTED_CONTENT_RULE;
const untrustedOpts = { note: PRACTICE_TEXT_NOTE };
const warn = (description: string) => `${description} ${UNTRUSTED_DESCRIPTION_SUFFIX}`;

/** Statuses that mean the client has nothing left to do. */
const SETTLED = new Set(['completed', 'locked']);

export function registerDocumentTools(server: McpServer, client: SimplePracticeClient): void {
  server.registerTool(
    'simplepractice_list_document_requests',
    {
      description: warn(
        'Paperwork the practice has sent — consents, questionnaires, contact and insurance forms, Good Faith Estimates, shared files. Use outstandingOnly to see just what still needs the client\'s attention.' +
          PARTIAL_NOTE
      ),
      annotations: toolAnnotations({ readOnly: true, openWorld: true }),
      inputSchema: z.object({
        outstandingOnly: z
          .boolean()
          .default(false)
          .describe('Return only requests that are not completed or locked.'),
        pageSize: z.number().int().positive().max(PAGE_SIZE_MAX).default(PAGE_SIZE_MAX),
        includeBody: z
          .boolean()
          .default(false)
          .describe('Include the full document body/questions. Off by default — these are long.'),
      }),
    },
    // No `view`: `items` below is a hand-written projection, and `includeBody`
    // is a field the caller explicitly asked for. A blind rung run over that
    // output could only take back something chosen on purpose.
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
      return untrustedResult(
        {
          count: items.length,
          outstanding: records.filter((r) => !SETTLED.has(String(r.status))).length,
          hasMore: hasMore(records, pageSize),
          welcomeText: meta?.welcomeText ?? null,
          documentRequests: items,
        },
        untrustedOpts
      );
    }
  );

  server.registerTool(
    'simplepractice_get_document_request',
    {
      description: warn(
        'One document request in full, including its body or its questions and the answers already given.'
      ),
      annotations: toolAnnotations({ readOnly: true, openWorld: true }),
      inputSchema: z.object({
        id: z.string().min(1).describe('The document request id.'),
        view: viewArg(),
      }),
    },
    // `view` is destructured off rather than passed on: the id is the only part
    // of this input that may reach the request path.
    async ({ id, view }) => {
      const { records } = await client.list(`/document-requests/${encodeURIComponent(id)}`);
      const record = records[0];
      if (!record) return minifiedResult({ found: false, id });
      // The record goes out verbatim — a consent form, a questionnaire and a
      // Good Faith Estimate are different shapes under one endpoint, so there
      // is no field list to pick. Compact strips the practice logo and
      // clinician avatars these carry; `hasDocumentPdf` is a fact about the
      // document, not a media key, and survives.
      return viewResponse(
        view,
        { ...record, hasDocumentPdf: asBoolean(record.hasDocumentPdf) ?? false },
        PRACTICE_TEXT_NOTE
      );
    }
  );

  server.registerTool(
    'simplepractice_list_documents',
    {
      description: warn('Files the practice has shared through the Client Portal.' + PARTIAL_NOTE),
      annotations: toolAnnotations({ readOnly: true, openWorld: true }),
      inputSchema: z.object({
        pageSize: z.number().int().positive().max(PAGE_SIZE_MAX).default(PAGE_SIZE_MAX),
      }),
    },
    // No `view`, and this one is the exception worth stating: the PRODUCT of
    // this tool is the file references themselves. A practice that shares a
    // scan shares it as a .jpg or .png, and the blind rung drops any string
    // whose path ends in an image extension — so compacting here would empty
    // exactly the rows a caller came for rather than shrink them.
    async ({ pageSize }) => {
      const { records } = await client.list('/documents', { page: { size: pageSize } });
      return untrustedResult(
        { count: records.length, hasMore: hasMore(records, pageSize), documents: records },
        untrustedOpts
      );
    }
  );

  server.registerTool(
    'simplepractice_list_announcements',
    {
      description: warn(
        'Announcements the practice has posted to the Client Portal. readAt is null on unread ones.' +
          PARTIAL_NOTE
      ),
      annotations: toolAnnotations({ readOnly: true, openWorld: true }),
      inputSchema: z.object({
        pageSize: z.number().int().positive().max(PAGE_SIZE_MAX).default(PAGE_SIZE_MAX),
        view: viewArg(),
      }),
    },
    async ({ pageSize, view }) => {
      const { records } = await client.list('/announcements', { page: { size: pageSize } });
      // Verbatim upstream records again. An announcement is text the practice
      // posted, so its banner and author avatar are decoration a model cannot
      // see — and `readAt: null` is data, which this rung leaves alone (it
      // drops media keys, never nulls), so the unread count above stays
      // reconcilable against the rows below it.
      return viewResponse(
        view,
        {
          count: records.length,
          unread: records.filter((r) => r.readAt === null || r.readAt === undefined).length,
          hasMore: hasMore(records, pageSize),
          announcements: records,
        },
        PRACTICE_TEXT_NOTE
      );
    }
  );
}
