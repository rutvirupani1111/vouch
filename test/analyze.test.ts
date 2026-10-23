import { describe, expect, it } from 'vitest';
import { analyzeFileMap, analyzePackage } from '../src/index.js';
import { benignV1, maliciousV2, nativeAddon, toBuffers, walletHookV2 } from './fixtures/packages.mjs';
import { fakeNet, tempDir } from './helpers.js';

const ids = (a: { capabilities: { id: string }[] }) => a.capabilities.map((c) => c.id).sort();

describe('analyzeFileMap', () => {
  it('reports a benign package as low risk', () => {
    const a = analyzeFileMap(toBuffers(benignV1()), { name: 'tiny-colors', version: '1.0.0' });
    expect(a.name).toBe('tiny-colors');
    expect(a.installScripts).toEqual({});
    expect(a.risk).toBeLessThan(10);
    expect(a.findings.every((f) => f.severity !== 'critical' && f.severity !== 'high')).toBe(true);
    expect(a.files).toBeGreaterThan(0);
    expect(a.unpackedSize).toBeGreaterThan(0);
  });

  it('flags a credential-stealing postinstall', () => {
    const a = analyzeFileMap(toBuffers(maliciousV2()), { name: 'tiny-colors', version: '1.0.2' });
    expect(a.installScripts).toEqual({ postinstall: 'node lib/setup.js' });
    expect(ids(a)).toEqual(expect.arrayContaining(['install_script', 'network', 'env', 'obfuscation']));
    expect(a.envVars).toEqual(expect.arrayContaining(['NPM_TOKEN', 'GITHUB_TOKEN', 'AWS_SECRET_ACCESS_KEY']));
    expect(a.endpoints.join(' ')).toMatch(/discord\.com/);
    expect(a.findings.map((f) => f.id)).toContain('install-script-dangerous');
    expect(a.risk).toBeGreaterThanOrEqual(80);
    const net = a.capabilities.find((c) => c.id === 'network')!;
    expect(net.evidence[0]).toMatchObject({ file: expect.any(String), line: expect.any(Number), excerpt: expect.any(String) });
  });

  it('flags a chalk-2025 style wallet hook', () => {
    const a = analyzeFileMap(toBuffers(walletHookV2()), { name: 'tiny-colors', version: '1.0.3' });
    expect(ids(a)).toEqual(expect.arrayContaining(['crypto_wallet', 'global_hook']));
    expect(a.findings.find((f) => f.id === 'crypto-wallet')?.severity).toBe('critical');
  });

  it('detects native build steps', () => {
    const a = analyzeFileMap(toBuffers(nativeAddon()), { name: 'addon', version: '2.0.0' });
    expect(ids(a)).toContain('install_script');
  });
});

describe('analyzePackage', () => {
  it('downloads, integrity-checks and analyses from the registry (offline fake)', async () => {
    const net = fakeNet({ 'tiny-colors': { '1.0.0': { files: benignV1() }, '1.0.2': { files: maliciousV2() } } });
    const tmp = tempDir('analyze');
    try {
      const a = await analyzePackage({ name: 'tiny-colors', version: 'latest' }, { fetch: net.fetch, cacheDir: tmp.dir });
      expect(a.version).toBe('1.0.2');
      expect(a.installScripts.postinstall).toBeDefined();
      // second call is served from the tarball cache
      const before = net.requests.filter((u) => u.endsWith('.tgz')).length;
      await analyzePackage({ name: 'tiny-colors', version: '1.0.2' }, { fetch: net.fetch, cacheDir: tmp.dir });
      expect(net.requests.filter((u) => u.endsWith('.tgz')).length).toBe(before);
    } finally {
      tmp.cleanup();
    }
  });
});
