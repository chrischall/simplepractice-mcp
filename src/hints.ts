/**
 * Context-group hints, published on each tool as `_meta.mint` (mcp-host's
 * `mintHintSchema`, the context-groups contract). Inert data: a host that does
 * not read them sees an extra `_meta` key and nothing else. The shape is fixed
 * by the host's contract, so it is restated here rather than imported — this
 * server takes no dependency on mcp-host.
 *
 * No `subject` anywhere: one portal login is one client access, and every read
 * answers for the signed-in client — no tool takes an argument naming whose
 * record to read, so there is nothing a host could fill one with. No `when`
 * either: none of the canonical reads takes a date range.
 */
import { untrustedResult } from '@chrischall/mcp-utils';

export type MintIntent =
  | 'whats-new' | 'whats-due' | 'whats-on' | 'lookup' | 'turn-on-off' | 'send' | 'change' | 'other';

export interface MintHint {
  domain: 'health';
  intent: MintIntent;
  canonical?: true;
  subject?: string;
  when?: { start: string; end: string };
  aliases?: string[];
}

/** `_meta` for a SimplePractice tool: every tool here is in the `health` domain. */
export function healthMeta(
  intent: MintIntent,
  extra: Omit<MintHint, 'domain' | 'intent'> = {}
): { mint: MintHint } {
  return { mint: { domain: 'health', intent, ...extra } };
}

const BRIEF_MAX = 120;

/** A non-blank string, flattened to one line; anything else is absent. */
export function oneLine(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const flat = v.replace(/\s+/g, ' ').trim();
  return flat === '' ? undefined : flat;
}

/** The shortest a title is cut to before the status gives way too. */
const TITLE_FLOOR = 24;

const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, Math.max(n - 1, 0))}…` : s);

/**
 * One item as one `view: 'brief'` line, `title — <ISO date | no date> —
 * <status>`, at most 120 characters, cut as a WHOLE with the title first: the
 * title shortens until the line fits, and only once it is down to a short
 * readable stub does the status give way as well (the date never does — it is
 * what a host reads off the line). A title starting with `-- ` would read as a
 * note and one starting with `\` would lose a character to the host's
 * unescape, so either is prefixed with one `\` (the brief-view contract).
 */
export function briefLine(rawTitle: string, date: string | undefined, status: string): string {
  const title = rawTitle.startsWith('-- ') || rawTitle.startsWith('\\') ? `\\${rawTitle}` : rawTitle;
  const sep = ` — ${date ?? 'no date'} — `;
  const room = BRIEF_MAX - sep.length;
  if (title.length + status.length <= room) return `${title}${sep}${status}`;
  const shownTitle = cut(title, Math.max(room - status.length, Math.min(title.length, TITLE_FLOOR)));
  return `${shownTitle}${sep}${cut(status, room - shownTitle.length)}`;
}

/**
 * The brief answer's lines plus its notes. A line starting `-- ` is a note,
 * not an item: `-- none` when there is nothing, and `-- more` when the page
 * came back full — the `hasMore: true` the other rungs report, since these
 * endpoints send no total. A full page with nothing to show answers `-- more`
 * alone, never `-- none`: the rows it could not read may hold an item.
 */
export function briefNotes(lines: string[], more: boolean): string[] {
  if (more) return [...lines, '-- more'];
  return lines.length === 0 ? ['-- none'] : lines;
}

/**
 * The brief answer: the lines inside the fleet's untrusted-data envelope as
 * `data: string[]`, minified, marker and note first — every brief line here
 * carries text the practice wrote (service and clinician names, document and
 * announcement titles). mcp-host's intent tools unwrap it and read `data`.
 */
export function briefResult(lines: string[], note: string): ReturnType<typeof untrustedResult> {
  return untrustedResult(lines, { note });
}
