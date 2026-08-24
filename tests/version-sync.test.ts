import { describe, expect, it } from 'vitest';
import { versionSyncTest } from '@chrischall/mcp-utils/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('version sync', () => {
  it('keeps every x-release-please-version marker equal to package.json', () => {
    expect(
      versionSyncTest({ srcDir: join(repoRoot, 'src'), pkgPath: join(repoRoot, 'package.json') })
    ).toEqual([]);
  });
});
