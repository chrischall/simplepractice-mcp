import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Drive a real initialize + tools/list handshake over stdio. */
async function handshake(entry: string, cwd: string): Promise<string[]> {
  const child = spawn(process.execPath, [entry], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    // No practice configured on purpose: the deferred-config-error pattern
    // means the server must still boot and answer tools/list.
    env: { ...process.env, SIMPLEPRACTICE_PRACTICE: '' },
  });

  const send = (msg: unknown) => child.stdin.write(`${JSON.stringify(msg)}\n`);
  let buffer = '';
  const names = new Promise<string[]>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out; stderr: ${stderr}`)), 20_000);
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      for (const line of buffer.split('\n').slice(0, -1)) {
        if (!line.trim()) continue;
        let msg: { id?: number; result?: { tools?: { name: string }[] } };
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id === 1) send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
        if (msg.id === 2 && msg.result?.tools) {
          clearTimeout(timer);
          resolve(msg.result.tools.map((t) => t.name));
        }
      }
      buffer = buffer.slice(buffer.lastIndexOf('\n') + 1);
    });
    let stderr = '';
    child.stderr.on('data', (c: Buffer) => {
      stderr += c.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => reject(new Error(`exited ${code}; stderr: ${stderr}`)));
  });

  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'boot-test', version: '0' },
    },
  });

  try {
    return await names;
  } finally {
    child.kill();
  }
}

const built = existsSync(join(repoRoot, 'dist/bundle.js'));

describe.skipIf(!built)('server boot', () => {
  it('boots the bin entry and lists its tools', async () => {
    const names = await handshake(join(repoRoot, 'dist/index.js'), repoRoot);
    expect(names).toContain('simplepractice_list_appointments');
    // Not an exact count: PR CI runs the branch merged with main, so a
    // hardcoded length breaks the moment another PR adds a tool.
    expect(names.length).toBeGreaterThanOrEqual(14);
  }, 30_000);

  it('boots the mcpb bundle with NO node_modules beside it', async () => {
    // This is the .mcpb runtime. An eager import of an esbuild-externalised
    // dep crashes here at load, before the server answers initialize — and
    // unit tests, which mock everything, never see it.
    const dir = mkdtempSync(join(tmpdir(), 'sp-bundle-'));
    cpSync(join(repoRoot, 'dist/bundle.js'), join(dir, 'bundle.js'));
    const names = await handshake(join(dir, 'bundle.js'), dir);
    expect(names).toContain('simplepractice_get_account');
    expect(names.length).toBeGreaterThanOrEqual(14);
  }, 30_000);
});
