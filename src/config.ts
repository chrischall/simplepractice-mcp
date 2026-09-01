import { homedir } from 'node:os';
import { join } from 'node:path';
import { expandPath, readEnvVar } from '@chrischall/mcp-utils';

/** The API contract version the Client Portal app currently sends. */
export const API_VERSION = '2026-05-25';

/**
 * The portal app reports itself as build `0.0.0`. The API only checks that the
 * header is PRESENT — it answers
 * `400 {"title":"Application build version is missing"}` when omitted — so this
 * is a required constant rather than anything version-like of ours.
 */
export const APPLICATION_BUILD_VERSION = '0.0.0';

export const APPLICATION_PLATFORM = 'web';

/** Every Client Portal API path hangs off this namespace. */
export const API_NAMESPACE = 'client-portal-api';

const PORTAL_DOMAIN = 'clientsecure.me';

/**
 * Resolve a practice's portal host from anything a user might hand over: the
 * bare slug (`achievebalancetherapy`), the full host, or a pasted URL — they
 * copy whichever half of the link they happen to have.
 *
 * The single gate on which hosts this server will talk to, so both routes in
 * (`SIMPLEPRACTICE_PRACTICE` and {@link practiceHostFromLink}) go through it:
 * a value outside `*.clientsecure.me`, or a nested subdomain under it, would
 * otherwise be enough to aim a session cookie at a stranger's domain.
 *
 * Returns `null` rather than throwing so the server still boots knowing no
 * practice — the ordinary first-run state — and reports it on the first call.
 */
export function resolvePortalHost(raw: string | undefined): string | null {
  if (!raw) return null;
  let value = raw.trim().toLowerCase();
  if (!value) return null;
  value = value.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!value) return null;
  if (!value.includes('.')) value = `${value}.${PORTAL_DOMAIN}`;
  if (!value.endsWith(`.${PORTAL_DOMAIN}`)) return null;
  // Reject anything that is not a single practice label under the apex.
  const label = value.slice(0, -(PORTAL_DOMAIN.length + 1));
  if (!/^[a-z0-9][a-z0-9-]*$/.test(label)) return null;
  return value;
}

/**
 * The practice named by an emailed sign-in link.
 *
 * The link is `https://<practice>.clientsecure.me/sign-in/token#<TOKEN>`, so
 * the practice is already in the user's hands the moment they have a link to
 * paste — which is why `SIMPLEPRACTICE_PRACTICE` is an override rather than a
 * requirement.
 *
 * Returns `null` when the link names no practice, which is not an error:
 * SimplePractice's mobile variant points at the bare apex
 * (`https://clientsecure.me/client-portal-api/sign-in/token#<TOKEN>`), and the
 * caller may equally have pasted a bare token.
 *
 * Only text with a `#` is considered — that is the shape of a link, and a bare
 * TOKEN must never be read as a host: `resolvePortalHost` slug-expands, so
 * `abc123` would otherwise resolve to `abc123.clientsecure.me` and the sign-in
 * POST would carry the token to a stranger's subdomain. The same reasoning
 * rules out slug-expanding the text in front of the fragment, so a link has to
 * spell out a host that is already under the portal apex.
 */
export function practiceHostFromLink(raw: string | undefined): string | null {
  if (!raw) return null;
  const hash = raw.indexOf('#');
  if (hash < 0) return null;
  const prefix = raw.slice(0, hash).trim();
  if (!prefix.includes('.')) return null;
  return resolvePortalHost(prefix);
}

export function readPortalHost(): string | null {
  return resolvePortalHost(readEnvVar('SIMPLEPRACTICE_PRACTICE'));
}

/**
 * Where the session cookie is persisted. Deliberately NOT the path the
 * `simplepractice-fpx` skill uses (`~/.simplepractice-cookies`): the two hold
 * different formats, and sharing a path would have each corrupt the other.
 */
export function sessionFilePath(): string {
  const override = readEnvVar('SIMPLEPRACTICE_SESSION_FILE');
  if (override) return expandPath(override);
  return join(homedir(), '.simplepractice-mcp', 'session.json');
}
