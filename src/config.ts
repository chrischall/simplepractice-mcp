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
 * Resolve the practice's portal host from `SIMPLEPRACTICE_PRACTICE`, which
 * accepts either the bare slug (`achievebalancetherapy`) or the full host
 * (`achievebalancetherapy.clientsecure.me`) — users copy whichever half of the
 * link they happen to have.
 *
 * Returns `null` rather than throwing so the server still boots without
 * configuration and reports the problem on the first tool call.
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
