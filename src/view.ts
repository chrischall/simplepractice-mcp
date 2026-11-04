import { z } from 'zod';
import {
  minifiedResult,
  resolveView,
  stripMediaUrls,
  untrustedEnvelope,
  viewParam,
  type View,
} from '@chrischall/mcp-utils';

/**
 * The rungs this server honours (`@chrischall/mcp-utils`' `view` vocabulary;
 * `chrischall/workflows` `docs/fleet-conventions.md`, "Response shape").
 *
 * A GROUNDED repo: it already had a field projection, and it was opt-in —
 * `compact: false`, so the caller had to know the slim rung existed and ask
 * for it. An efficiency that has to be requested is one that usually is not,
 * and the caller paying for it is the one least able to know.
 *
 * `compact` is the default now. SimplePractice payloads that have no projection get
 * media stripping instead, which needs no knowledge of the shape.
 *
 * A hand-written projection is NOT then media-stripped. Its field choices were
 * made WITH knowledge of the API; running a blind subtractive rule over its
 * output would let an un-grounded rule overrule a grounded one — which bit
 * viator-mcp, where the projection deliberately keeps a cover image.
 *
 * No `raw` rung: `full` already returns the untouched upstream payload.
 */
export const SP_VIEWS = ['compact', 'full'] as const;

const NOTE =
  'compact returns the slim projection where one exists and strips image URLs elsewhere; ' +
  '"full" returns SimplePractice\'s whole records.';

/** The `view` parameter every read tool in this server takes. */
export const viewArg = (): ReturnType<typeof viewParam> => viewParam(SP_VIEWS, { note: NOTE });

const BRIEF_NOTE =
  '"brief" answers one text line per item — title — <ISO date or "no date"> — <status> — for a host ' +
  'that only needs to say what is there.';

/**
 * The `view` parameter of a context-group canonical read (src/hints.ts): the
 * server's own rungs plus `brief`, which is not a fleet rung (mcp-utils'
 * `viewParam` refuses it) but the host contract's one-line-per-item answer.
 * `rungs` is the rungs this tool honours besides it.
 */
export const briefViewArg = (rungs: readonly string[], what: string) =>
  z
    .enum(['brief', ...rungs] as [string, ...string[]])
    .optional()
    .describe(`${what} ${BRIEF_NOTE}`);

/** Is this call asking for the slim rung? Replaces the old `compact` boolean. */
export function isCompact(view: string | undefined): boolean {
  const rung: View = resolveView(view, SP_VIEWS);
  return rung === 'compact';
}

/**
 * Answer a payload that has NO hand-written projection: compact strips media,
 * full passes through.
 *
 * Pass `untrustedNote` when the payload carries text a third party wrote: the
 * result is then wrapped in mcp-utils' untrusted envelope, markers first,
 * AFTER the rung is applied — so the fence is never itself compacted away.
 */
export function viewResponse(
  view: string | undefined,
  data: unknown,
  untrustedNote?: string
): ReturnType<typeof minifiedResult> {
  const shaped = isCompact(view) ? stripMediaUrls(data) : data;
  return minifiedResult(untrustedNote ? untrustedEnvelope(shaped, { note: untrustedNote }) : shaped);
}

/** {@link viewArg}'s rungs plus `brief`, for this server's canonical reads that otherwise take {@link viewArg}. */
export const viewArgWithBrief = () => briefViewArg(SP_VIEWS, NOTE);
