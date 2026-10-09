import { describe, it, expect } from 'vitest';
import { registerAuthTools } from '../src/tools/auth.js';
import { registerAccountTools } from '../src/tools/account.js';
import { registerAppointmentTools } from '../src/tools/appointments.js';
import { registerBillingTools } from '../src/tools/billing.js';
import { registerDocumentTools } from '../src/tools/documents.js';
import { registerHealthcheckTools } from '../src/tools/health.js';
import { makeClient } from './helpers.js';

/**
 * The fleet annotation invariants, read off the REGISTERED config rather than a
 * hand-kept list. `destructiveHint` defaults to TRUE whenever readOnlyHint is
 * false and `openWorldHint` defaults to true, so a forgotten value and a
 * considered one are indistinguishable on the wire — each tool has to choose.
 */
interface Ann {
  readOnlyHint?: unknown;
  destructiveHint?: unknown;
  openWorldHint?: unknown;
}

function registeredAnnotations(): Record<string, Ann | undefined> {
  const seen: Record<string, Ann | undefined> = {};
  const server = {
    registerTool: (name: string, cfg: { annotations?: Ann }) => {
      seen[name] = cfg.annotations;
    },
  } as never;
  const { client } = makeClient();
  for (const register of [
    registerAuthTools,
    registerAccountTools,
    registerAppointmentTools,
    registerBillingTools,
    registerDocumentTools,
    registerHealthcheckTools,
  ]) {
    register(server, client);
  }
  return seen;
}

describe('every tool declares its annotations truthfully', () => {
  it('registers the full surface (guards against a registrar being dropped here)', () => {
    expect(Object.keys(registeredAnnotations())).toHaveLength(15);
  });

  it('sets an explicit boolean readOnlyHint on all of them', () => {
    const missing = Object.entries(registeredAnnotations())
      .filter(([, a]) => typeof a?.readOnlyHint !== 'boolean')
      .map(([name]) => name);
    expect(missing).toEqual([]);
  });

  it('sets an explicit boolean destructiveHint on every write', () => {
    const undeclared = Object.entries(registeredAnnotations())
      .filter(([, a]) => a?.readOnlyHint === false && typeof a?.destructiveHint !== 'boolean')
      .map(([name]) => name);
    expect(undeclared).toEqual([]);
  });

  it('never lets a read claim to be destructive', () => {
    const contradictory = Object.entries(registeredAnnotations())
      .filter(([, a]) => a?.readOnlyHint === true && a?.destructiveHint === true)
      .map(([name]) => name);
    expect(contradictory).toEqual([]);
  });

  it('sets an explicit boolean openWorldHint on all of them', () => {
    const missing = Object.entries(registeredAnnotations())
      .filter(([, a]) => typeof a?.openWorldHint !== 'boolean')
      .map(([name]) => name);
    expect(missing).toEqual([]);
  });

  it('marks only the local-state tools as closed-world', () => {
    // session_status and sign_out each say "makes no network call" in their
    // own description; everything else talks to clientsecure.me.
    const closed = Object.entries(registeredAnnotations())
      .filter(([, a]) => a?.openWorldHint === false)
      .map(([name]) => name)
      .sort();
    expect(closed).toEqual(['simplepractice_session_status', 'simplepractice_sign_out']);
  });

  it('marks the email send and the single-use credential exchanges destructive', () => {
    // request_sign_in_link reaches a person's inbox; the token and PIN are
    // spent on use — none of the three has an inverse in this tool set.
    const destructive = Object.entries(registeredAnnotations())
      .filter(([, a]) => a?.readOnlyHint === false && a?.destructiveHint === true)
      .map(([name]) => name)
      .sort();
    expect(destructive).toEqual([
      'simplepractice_request_sign_in_link',
      'simplepractice_verify_sign_in_pin',
      'simplepractice_verify_sign_in_token',
    ]);
  });
});
