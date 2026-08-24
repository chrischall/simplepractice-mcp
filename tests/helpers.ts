import { SessionStore } from '@chrischall/mcp-utils/session';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SimplePracticeClient, type PortalSession } from '../src/client.js';

export const HOST = 'achievebalancetherapy.clientsecure.me';

/** A SessionStore backed by a throwaway directory, never the real one. */
export function tempStore(): SessionStore<PortalSession> {
  const dir = mkdtempSync(join(tmpdir(), 'sp-mcp-'));
  return new SessionStore<PortalSession>({
    filePath: join(dir, 'session.json'),
    keyOf: (s) => s.host,
    normalizeKey: (k) => k.toLowerCase(),
  });
}

export interface StubCall {
  url: string;
  init: RequestInit;
}

export interface StubResponse {
  status?: number;
  body?: unknown;
  raw?: string;
  setCookie?: string[];
  contentType?: string;
}

/** A fetch stub that records calls and replays queued responses in order. */
export function stubFetch(responses: StubResponse[]): {
  fetchImpl: typeof fetch;
  calls: StubCall[];
} {
  const calls: StubCall[] = [];
  const queue = [...responses];
  const fetchImpl = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const next = queue.shift() ?? { status: 200, body: { data: [] } };
    const headers = new Headers({
      'content-type': next.contentType ?? 'application/vnd.api+json',
    });
    for (const cookie of next.setCookie ?? []) headers.append('set-cookie', cookie);
    const text = next.raw ?? JSON.stringify(next.body ?? {});
    return {
      ok: (next.status ?? 200) < 400,
      status: next.status ?? 200,
      headers,
      text: async () => text,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

export function makeClient(responses: StubResponse[] = []) {
  const { fetchImpl, calls } = stubFetch(responses);
  const store = tempStore();
  const client = new SimplePracticeClient({ fetchImpl, store });
  return { client, calls, store };
}

/** A client that already holds a session, for read-path tests. */
export function makeSignedInClient(responses: StubResponse[] = []) {
  const made = makeClient(responses);
  made.client.saveSession('simplepractice-session=abc123');
  return made;
}
