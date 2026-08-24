import { describe, expect, it, afterEach } from 'vitest';
import { resolvePortalHost, readPortalHost, sessionFilePath } from '../src/config.js';

describe('resolvePortalHost', () => {
  it('expands a bare practice slug to the portal host', () => {
    expect(resolvePortalHost('achievebalancetherapy')).toBe(
      'achievebalancetherapy.clientsecure.me'
    );
  });

  it('accepts a full host unchanged', () => {
    expect(resolvePortalHost('achievebalancetherapy.clientsecure.me')).toBe(
      'achievebalancetherapy.clientsecure.me'
    );
  });

  it('accepts a pasted URL, because that is what the provider emails', () => {
    expect(resolvePortalHost('https://achievebalancetherapy.clientsecure.me/sign-in')).toBe(
      'achievebalancetherapy.clientsecure.me'
    );
  });

  it('normalises case and surrounding whitespace', () => {
    expect(resolvePortalHost('  AchieveBalanceTherapy  ')).toBe(
      'achievebalancetherapy.clientsecure.me'
    );
  });

  it.each([
    ['undefined', undefined],
    ['empty', ''],
    ['whitespace only', '   '],
    ['a URL with no host', 'https:///'],
  ])('returns null for %s', (_label, input) => {
    expect(resolvePortalHost(input as string | undefined)).toBeNull();
  });

  it('refuses a host outside clientsecure.me', () => {
    // Otherwise a mistyped env var would point the session cookie at a
    // stranger's domain.
    expect(resolvePortalHost('evil.example.com')).toBeNull();
  });

  it('refuses a nested subdomain under the portal apex', () => {
    expect(resolvePortalHost('a.b.clientsecure.me')).toBeNull();
  });

  it('refuses a slug with characters a practice label cannot contain', () => {
    expect(resolvePortalHost('bad_slug')).toBeNull();
    expect(resolvePortalHost('-leading')).toBeNull();
  });
});

describe('environment-backed config', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('reads the practice from SIMPLEPRACTICE_PRACTICE', () => {
    process.env.SIMPLEPRACTICE_PRACTICE = 'achievebalancetherapy';
    expect(readPortalHost()).toBe('achievebalancetherapy.clientsecure.me');
  });

  it('is null when unset, so the server can still boot', () => {
    delete process.env.SIMPLEPRACTICE_PRACTICE;
    expect(readPortalHost()).toBeNull();
  });

  it('defaults the session file under the home directory', () => {
    delete process.env.SIMPLEPRACTICE_SESSION_FILE;
    expect(sessionFilePath()).toMatch(/\.simplepractice-mcp\/session\.json$/);
  });

  it('honours a SIMPLEPRACTICE_SESSION_FILE override', () => {
    process.env.SIMPLEPRACTICE_SESSION_FILE = '/tmp/sp-test/session.json';
    expect(sessionFilePath()).toBe('/tmp/sp-test/session.json');
  });

  it('does not collide with the path the fpx skill writes', () => {
    // The skill keeps a curl cookie jar at ~/.simplepractice-cookies; sharing a
    // path would have each format corrupt the other.
    delete process.env.SIMPLEPRACTICE_SESSION_FILE;
    expect(sessionFilePath()).not.toMatch(/\.simplepractice-cookies$/);
  });
});
