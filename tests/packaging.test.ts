import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createTestHarness } from '@chrischall/mcp-utils/test';
import { registerAuthTools } from '../src/tools/auth.js';
import { registerAccountTools } from '../src/tools/account.js';
import { registerAppointmentTools } from '../src/tools/appointments.js';
import { registerBillingTools } from '../src/tools/billing.js';
import { registerDocumentTools } from '../src/tools/documents.js';
import { makeClient } from './helpers.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p: string) => JSON.parse(readFileSync(join(repoRoot, p), 'utf8'));

const pkg = readJson('package.json');
const manifest = readJson('manifest.json');
const server = readJson('server.json');
const plugin = readJson('.claude-plugin/plugin.json');
const marketplace = readJson('.claude-plugin/marketplace.json');

describe('package.json', () => {
  it('declares the repository url npm provenance validates against', () => {
    // Missing this fails `npm publish --provenance` with E422 AFTER
    // release-please has already tagged, and a re-run cannot fix it.
    expect(pkg.repository?.url).toBe(
      'git+https://github.com/chrischall/simplepractice-mcp.git'
    );
  });

  it('ships the skills directory, so the fpx skill is actually published', () => {
    expect(pkg.files).toContain('skills');
    expect(pkg.files).toContain('dist');
    expect(pkg.files).toContain('.claude-plugin');
  });

  it('keeps the mcpb runtime floor on an LTS node, not the CI node', () => {
    expect(manifest.compatibility.runtimes.node).toBe('>=22.5');
  });
});

describe('registry metadata', () => {
  it('keeps the server.json description within the registry limit', () => {
    // Over 100 characters and `mcp-publisher publish` 422s.
    expect(server.description.length).toBeLessThanOrEqual(100);
  });

  it('agrees on the package identifier', () => {
    expect(server.packages[0].identifier).toBe(pkg.name);
    expect(server.name).toBe(pkg.mcpName);
  });

  it('points the plugin at the skills directory so both skills are discovered', () => {
    expect(plugin.skills).toBe('./skills/');
  });

  it('keeps every version literal equal to package.json', () => {
    for (const v of [
      manifest.version,
      server.version,
      server.packages[0].version,
      plugin.version,
      marketplace.metadata.version,
      ...marketplace.plugins.map((p: { version: string }) => p.version),
    ]) {
      expect(v).toBe(pkg.version);
    }
  });
});

describe('manifest tool roster', () => {
  it('matches the tools the server actually registers, in both directions', async () => {
    const { client } = makeClient();
    const harness = await createTestHarness((s) => {
      registerAuthTools(s, client);
      registerAccountTools(s, client);
      registerAppointmentTools(s, client);
      registerBillingTools(s, client);
      registerDocumentTools(s, client);
    });
    const registered = (await harness.listTools()).map((t) => t.name).sort();
    const declared = manifest.tools.map((t: { name: string }) => t.name).sort();
    // A tool missing from manifest.json is invisible to an mcpb host even
    // though the server answers it — nothing else reads that file.
    expect(declared).toEqual(registered);
    await harness.close();
  });

  it('gives every declared tool a non-empty description', () => {
    for (const tool of manifest.tools) {
      expect(tool.description?.trim()).toBeTruthy();
    }
  });
});
