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

/**
 * One item as one `view: 'brief'` line, `title — <ISO date | no date> —
 * <status>`, at most 120 characters (the title is shortened, never the date or
 * the status — those are what a host reads off the line).
 */
export function briefLine(title: string, date: string | undefined, status: string): string {
  const tail = ` — ${date ?? 'no date'} — ${status}`;
  const room = BRIEF_MAX - tail.length;
  const shown = title.length > room ? `${title.slice(0, Math.max(room - 1, 0))}…` : title;
  return `${shown}${tail}`;
}

/** The brief answer: one line per item, and an EMPTY text when there are none (a line would count as an item). */
export function briefResult(lines: string[]): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text', text: lines.join('\n') }] };
}
