import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse } from 'yaml';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

interface MintEnv {
  name: string;
  secret?: boolean;
  required?: boolean;
  help?: string;
  default?: string;
}
interface Mint {
  version: number;
  name?: string;
  slug?: string;
  summary?: string;
  env?: MintEnv[];
  state?: { dataDir: boolean; reason?: string };
  identity?: { perUserChild: boolean };
  egress?: { allow: string[] };
  command?: { bin: string };
}

const raw = readFileSync(join(repoRoot, 'mint.yaml'), 'utf8');
const mint = parse(raw) as Mint;

/** Every env var name the source actually reads. */
function envVarsUsedInSource(): string[] {
  const dir = join(repoRoot, 'src');
  const walk = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]
    );
  const names = new Set<string>();
  for (const file of walk(dir)) {
    if (!file.endsWith('.ts')) continue;
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/(?:readEnvVar|requireEnvVar|parseBoolEnv|readPortEnv)\(\s*'([A-Z][A-Z0-9_]*)'/g)) {
      names.add(m[1]);
    }
  }
  return [...names].sort();
}

describe('mint.yaml', () => {
  it('parses and declares the v1 major', () => {
    expect(mint.version).toBe(1);
  });

  it('names the slug the connector URL will carry', () => {
    expect(mint.slug).toBe('simplepractice');
  });

  // The guard that actually earns its keep: mcp-host's nightly check compares
  // a pinned version's manifest against what the registration supplies, so a
  // new env var that never reaches this file makes the manifest quietly wrong.
  it('declares exactly the environment variables the source reads', () => {
    const declared = (mint.env ?? []).map((e) => e.name).sort();
    expect(declared).toEqual(envVarsUsedInSource());
  });

  it('marks every environment variable optional, because none is needed', () => {
    // The practice comes out of the emailed sign-in link, so an owner can
    // install this with no configuration at all. Marking it required would
    // put a mandatory field in front of a connector that does not need one.
    const byName = Object.fromEntries((mint.env ?? []).map((e) => [e.name, e]));
    expect(byName.SIMPLEPRACTICE_PRACTICE.required).toBe(false);
    expect(byName.SIMPLEPRACTICE_SESSION_FILE.required).toBe(false);
  });

  it('carries no secret values, as a file in a public repo must not', () => {
    for (const entry of mint.env ?? []) {
      // The reader refuses a default on a secret field outright; not shipping
      // one is the same rule stated where it can fail early.
      if (entry.secret) expect(entry.default).toBeUndefined();
    }
    // This MCP has no credential env var at all — the session is established
    // at runtime — so nothing here should be marked secret.
    expect((mint.env ?? []).filter((e) => e.secret)).toEqual([]);
  });

  it('gives a reason for the data dir, which is what an owner judges', () => {
    expect(mint.state?.dataDir).toBe(true);
    expect(mint.state?.reason?.trim()).toBeTruthy();
  });

  it('asks for a child per caller, because auth is per caller', () => {
    // There is no credential in the environment: each caller signs in with a
    // magic link mailed to them. A shared child would hand the first caller's
    // portal session to everyone else on the connector.
    expect(mint.identity?.perUserChild).toBe(true);
    expect((mint.env ?? []).some((e) => e.secret)).toBe(false);
  });

  it('allows egress only to the portal hosts the client actually calls', () => {
    expect(mint.egress?.allow).toEqual(['*.clientsecure.me']);
  });

  it('omits command.bin, which is only meaningful with several bins', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
    expect(Object.keys(pkg.bin)).toHaveLength(1);
    expect(mint.command).toBeUndefined();
  });
});
