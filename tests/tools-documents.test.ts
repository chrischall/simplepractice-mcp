import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createTestHarness, parseToolResult } from '@chrischall/mcp-utils/test';
import { registerDocumentTools } from '../src/tools/documents.js';
import { makeSignedInClient, type StubResponse } from './helpers.js';

const saved = { ...process.env };
beforeEach(() => {
  process.env.SIMPLEPRACTICE_PRACTICE = 'achievebalancetherapy';
});
afterEach(() => {
  process.env = { ...saved };
});

async function harnessFor(responses: StubResponse[]) {
  const made = makeSignedInClient(responses);
  const harness = await createTestHarness((server) => registerDocumentTools(server, made.client));
  return { ...made, harness };
}

/** Mirrors a real payload: hasDocumentPdf arrives as a STRING, both ways. */
const documentsDoc: StubResponse = {
  body: {
    data: [
      {
        id: '1',
        type: 'documentRequestConsentDocuments',
        attributes: {
          documentTitle: 'Informed Consent',
          status: 'completed',
          hasDocumentPdf: 'true',
        },
      },
      {
        id: '2',
        type: 'documentRequestQuestionnaires',
        attributes: {
          documentTitle: 'Intake Questionnaire',
          status: 'sent',
          hasDocumentPdf: 'false',
          templateQuestions: ['Q1'],
          userAnswers: [],
        },
      },
      {
        id: '3',
        type: 'documentRequestContactInfos',
        attributes: {
          documentTitle: 'Contact Info',
          status: 'viewed',
          hasDocumentPdf: 'false',
        },
      },
      {
        id: '4',
        type: 'documentRequestNotes',
        attributes: { documentTitle: 'A note', status: 'locked', hasDocumentPdf: 'false' },
      },
    ],
    meta: { welcomeText: 'Welcome', hasDocumentsIntro: true },
  },
};

describe('simplepractice_list_document_requests', () => {
  it('coerces the stringly-typed hasDocumentPdf into a real boolean', async () => {
    const { harness } = await harnessFor([documentsDoc]);
    const out = parseToolResult<any>(
      await harness.callTool('simplepractice_list_document_requests')
    );
    // The bug this guards: "false" is a truthy string, so a naive pass-through
    // reports every document as having a PDF. Live, that was 10 of 10 instead
    // of the real 5.
    expect(out.documentRequests.map((d: any) => d.hasDocumentPdf)).toEqual([
      true,
      false,
      false,
      false,
    ]);
    await harness.close();
  });

  it('counts sent and viewed as outstanding, completed and locked as done', async () => {
    const { harness } = await harnessFor([documentsDoc]);
    const out = parseToolResult<any>(
      await harness.callTool('simplepractice_list_document_requests')
    );
    expect(out.outstanding).toBe(2);
    await harness.close();
  });

  it('filters to just the outstanding ones on request', async () => {
    const { harness } = await harnessFor([documentsDoc]);
    const out = parseToolResult<any>(
      await harness.callTool('simplepractice_list_document_requests', { outstandingOnly: true })
    );
    expect(out.documentRequests.map((d: any) => d.title)).toEqual([
      'Intake Questionnaire',
      'Contact Info',
    ]);
    await harness.close();
  });

  it('still reports the true outstanding count when the list is filtered', async () => {
    const { harness } = await harnessFor([documentsDoc]);
    const out = parseToolResult<any>(
      await harness.callTool('simplepractice_list_document_requests', { outstandingOnly: true })
    );
    expect(out.outstanding).toBe(2);
    await harness.close();
  });

  it('surfaces the subtype as the kind, because that is where it lives', async () => {
    const { harness } = await harnessFor([documentsDoc]);
    const out = parseToolResult<any>(
      await harness.callTool('simplepractice_list_document_requests')
    );
    expect(out.documentRequests[1].kind).toBe('documentRequestQuestionnaires');
    await harness.close();
  });

  it('omits long bodies by default and includes them on request', async () => {
    const { harness: h1 } = await harnessFor([documentsDoc]);
    const lean = parseToolResult<any>(
      await h1.callTool('simplepractice_list_document_requests')
    );
    expect(lean.documentRequests[1]).not.toHaveProperty('templateQuestions');
    await h1.close();

    const { harness: h2 } = await harnessFor([documentsDoc]);
    const full = parseToolResult<any>(
      await h2.callTool('simplepractice_list_document_requests', { includeBody: true })
    );
    expect(full.documentRequests[1].templateQuestions).toEqual(['Q1']);
    await h2.close();
  });

  it('passes the practice welcome text through', async () => {
    const { harness } = await harnessFor([documentsDoc]);
    const out = parseToolResult<any>(
      await harness.callTool('simplepractice_list_document_requests')
    );
    expect(out.welcomeText).toBe('Welcome');
    await harness.close();
  });

  it('reports a null welcome text when the document carries no meta', async () => {
    const { harness } = await harnessFor([{ body: { data: [] } }]);
    const out = parseToolResult<any>(
      await harness.callTool('simplepractice_list_document_requests')
    );
    expect(out.welcomeText).toBeNull();
    await harness.close();
  });
});

describe('simplepractice_get_document_request', () => {
  it('fetches one request by id and normalises its PDF flag', async () => {
    const { harness, calls } = await harnessFor([
      {
        body: {
          data: {
            id: '2',
            type: 'documentRequestQuestionnaires',
            attributes: { documentTitle: 'Intake', hasDocumentPdf: 'false' },
          },
        },
      },
    ]);
    const out = parseToolResult<any>(
      await harness.callTool('simplepractice_get_document_request', { id: '2' })
    );
    expect(calls[0].url).toContain('/document-requests/2');
    expect(out.hasDocumentPdf).toBe(false);
    await harness.close();
  });

  // A document request goes out verbatim — consent forms, questionnaires and
  // Good Faith Estimates are different shapes under one endpoint, so the blind
  // rung is the only shrink available. What must survive it is the paperwork:
  // the questions, the answers already given, and the flag saying a PDF exists.
  it('strips media off a document request but keeps the questions and answers', async () => {
    const { harness } = await harnessFor([
      {
        body: {
          data: {
            id: '2',
            type: 'documentRequestQuestionnaires',
            attributes: {
              documentTitle: 'Intake',
              hasDocumentPdf: 'true',
              templateQuestions: ['Q1'],
              userAnswers: ['A1'],
              practiceLogoUrl: 'https://cdn.simplepractice.com/logo.png',
            },
          },
        },
      },
    ]);
    const out = parseToolResult<any>(
      await harness.callTool('simplepractice_get_document_request', { id: '2' })
    );
    expect(out.practiceLogoUrl).toBeUndefined();
    expect(out.templateQuestions).toEqual(['Q1']);
    expect(out.userAnswers).toEqual(['A1']);
    // `hasDocumentPdf` reads like a media key but is a boolean fact about the
    // document. The strip is anchored on the noun, so it stays — and it stays
    // coerced from the wire's STRING "true", which is the other thing this
    // handler does and which the rung must not undo.
    expect(out.hasDocumentPdf).toBe(true);
    await harness.close();
  });

  it('returns the untouched document request on view:"full"', async () => {
    const { harness } = await harnessFor([
      {
        body: {
          data: {
            id: '2',
            type: 'documentRequestQuestionnaires',
            attributes: {
              hasDocumentPdf: 'false',
              practiceLogoUrl: 'https://cdn.simplepractice.com/logo.png',
            },
          },
        },
      },
    ]);
    const out = parseToolResult<any>(
      await harness.callTool('simplepractice_get_document_request', { id: '2', view: 'full' })
    );
    expect(out.practiceLogoUrl).toBe('https://cdn.simplepractice.com/logo.png');
    await harness.close();
  });

  // `view` is this server's vocabulary, not SimplePractice's. Only the id may
  // reach the request path; a handler that passed its whole input through would
  // send an undefined query param upstream.
  it('never forwards view to the API', async () => {
    const { harness, calls } = await harnessFor([{ body: { data: null } }]);
    await harness.callTool('simplepractice_get_document_request', { id: '2', view: 'full' });
    expect(calls[0].url).not.toContain('view');
    await harness.close();
  });

  it('url-encodes the id rather than splicing it in raw', async () => {
    const { harness, calls } = await harnessFor([{ body: { data: null } }]);
    await harness.callTool('simplepractice_get_document_request', { id: 'a/b' });
    expect(calls[0].url).toContain('/document-requests/a%2Fb');
    await harness.close();
  });

  it('says so plainly when the id matched nothing', async () => {
    const { harness } = await harnessFor([{ body: { data: null } }]);
    const out = parseToolResult<any>(
      await harness.callTool('simplepractice_get_document_request', { id: '99' })
    );
    expect(out).toEqual({ found: false, id: '99' });
    await harness.close();
  });
});

describe('simplepractice_list_documents and announcements', () => {
  it('lists shared files', async () => {
    const { harness } = await harnessFor([
      { body: { data: [{ id: '1', type: 'documents', attributes: { documentName: 'x.pdf' } }] } },
    ]);
    const out = parseToolResult<any>(await harness.callTool('simplepractice_list_documents'));
    expect(out.count).toBe(1);
    await harness.close();
  });

  // `simplepractice_list_documents` takes no `view`, and this is the assertion
  // that says why: what it returns IS the file reference. A practice that
  // shares a scan shares a .jpg, and the blind rung drops any string whose path
  // ends in an image extension — compacting here would empty the row rather
  // than shrink it, which is the same reason a photos tool never gets one.
  it('keeps an image file url, because the file reference is the product', async () => {
    const { harness } = await harnessFor([
      {
        body: {
          data: [
            {
              id: '1',
              type: 'documents',
              attributes: {
                documentName: 'insurance-card.jpg',
                url: 'https://cdn.simplepractice.com/shared/insurance-card.jpg',
              },
            },
          ],
        },
      },
    ]);
    const out = parseToolResult<any>(await harness.callTool('simplepractice_list_documents'));
    expect(out.documents[0].url).toBe('https://cdn.simplepractice.com/shared/insurance-card.jpg');
    await harness.close();
  });

  // Announcements ARE stripped: a banner on a text post is decoration. The
  // unread count above the rows is computed from `readAt`, so this also pins
  // that the rung drops media keys and never nulls — a strip that removed the
  // null `readAt` would leave the count unreconcilable against the rows.
  it('strips an announcement banner while leaving a null readAt to be counted', async () => {
    const { harness } = await harnessFor([
      {
        body: {
          data: [
            {
              id: '1',
              type: 'announcements',
              attributes: {
                title: 'Office closed Monday',
                readAt: null,
                bannerUrl: 'https://cdn.simplepractice.com/banner.png',
              },
            },
          ],
        },
      },
    ]);
    const out = parseToolResult<any>(await harness.callTool('simplepractice_list_announcements'));
    expect(out.announcements[0].bannerUrl).toBeUndefined();
    expect(out.announcements[0].title).toBe('Office closed Monday');
    expect(out.announcements[0].readAt).toBeNull();
    expect(out.unread).toBe(1);
    await harness.close();
  });

  it('returns the untouched announcement on view:"full"', async () => {
    const { harness } = await harnessFor([
      {
        body: {
          data: [
            {
              id: '1',
              type: 'announcements',
              attributes: {
                title: 'A',
                bannerUrl: 'https://cdn.simplepractice.com/banner.png',
              },
            },
          ],
        },
      },
    ]);
    const out = parseToolResult<any>(
      await harness.callTool('simplepractice_list_announcements', { view: 'full' })
    );
    expect(out.announcements[0].bannerUrl).toBe('https://cdn.simplepractice.com/banner.png');
    await harness.close();
  });

  it('counts unread announcements by a null readAt', async () => {
    const { harness } = await harnessFor([
      {
        body: {
          data: [
            { id: '1', type: 'announcements', attributes: { title: 'A', readAt: null } },
            { id: '2', type: 'announcements', attributes: { title: 'B', readAt: '2026-08-01' } },
            { id: '3', type: 'announcements', attributes: { title: 'C' } },
          ],
        },
      },
    ]);
    const out = parseToolResult<any>(await harness.callTool('simplepractice_list_announcements'));
    expect(out.count).toBe(3);
    expect(out.unread).toBe(2);
    await harness.close();
  });
});
