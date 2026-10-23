import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main, parseSpec } from '../src/cli/main.js';
import { createStyle } from '../src/engine/util/ansi.js';
import { benignV1, benignV2, maliciousV2 } from './fixtures/packages.mjs';
import { fakeNet, npmLock, tempDir, type FakeNet } from './helpers.js';

const SHA = 'b'.repeat(40);

function run(argv: string[], net: FakeNet, cwd: string) {
  let out = '';
  let err = '';
  const ui = { s: createStyle(false), u: true };
  return main([...argv, '--cache-dir', join(cwd, '.cache')], { out: (s) => (out += s), err: (s) => (err += s), ui, fetch: net.fetch, cwd }).then(
    (code) => ({ code, out, err }),
  );
}

describe('parseSpec', () => {
  it('splits names and versions, including scopes', () => {
    expect(parseSpec('chalk')).toEqual({ name: 'chalk', version: 'latest' });
    expect(parseSpec('chalk@5.3.0')).toEqual({ name: 'chalk', version: '5.3.0' });
    expect(parseSpec('@scope/pkg@1.0.0')).toEqual({ name: '@scope/pkg', version: '1.0.0' });
    expect(parseSpec('@scope/pkg')).toEqual({ name: '@scope/pkg', version: 'latest' });
  });
});

describe('vouch CLI', () => {
  let tmp: ReturnType<typeof tempDir>;
  let net: FakeNet;
  const lock = (version: string) =>
    npmLock(
      { 'tiny-colors': `^${version}`, 'left-ish': '1.0.0' },
      {
        'node_modules/tiny-colors': { version, integrity: net.integrity('tiny-colors', version), resolved: net.tarballUrl('tiny-colors', version) },
        'node_modules/left-ish': { version: '1.0.0', integrity: net.integrity('left-ish', '1.0.0'), resolved: net.tarballUrl('left-ish', '1.0.0') },
      },
    );

  beforeEach(() => {
    tmp = tempDir('cli');
    net = fakeNet(
      {
        'tiny-colors': {
          '1.0.0': { files: benignV1(), repository: 'github:acme/tiny-colors', gitHead: SHA },
          '1.0.1': { files: benignV2() },
          '1.0.2': { files: maliciousV2(), repository: 'github:acme/tiny-colors', gitHead: SHA },
        },
        'left-ish': { '1.0.0': { files: { 'package.json': '{"name":"left-ish","version":"1.0.0"}', 'index.js': 'module.exports = (s) => s;' } } },
      },
      { [`acme/tiny-colors@${SHA}`]: benignV1() },
    );
    writeFileSync(join(tmp.dir, 'package.json'), '{"name":"my-app","version":"1.0.0"}');
    writeFileSync(join(tmp.dir, 'package-lock.json'), lock('1.0.0'));
  });
  afterEach(() => tmp.cleanup());

  it('report: pretty, json, and exit 1 on grade F', async () => {
    const ok = await run(['report', 'tiny-colors@1.0.0'], net, tmp.dir);
    expect(ok.code).toBe(0);
    expect(ok.out).toContain('tiny-colors@1.0.0');
    expect(ok.out).toMatch(/source\s+match/);
    const bad = await run(['report', 'tiny-colors@1.0.2', '--json'], net, tmp.dir);
    expect(bad.code).toBe(1);
    const json = JSON.parse(bad.out);
    expect(json.grade).toBe('F');
    expect(json.verify.source.status).toBe('mismatch');
  });

  it('init writes the manifest; check passes; a capability gain fails; approve accepts it', async () => {
    const init = await run(['init'], net, tmp.dir);
    expect(init.code).toBe(0);
    const manifest = JSON.parse(readFileSync(join(tmp.dir, 'vouch.lock.json'), 'utf8'));
    expect(Object.keys(manifest.packages)).toEqual(['left-ish', 'tiny-colors']);

    expect((await run(['check'], net, tmp.dir)).code).toBe(0);

    writeFileSync(join(tmp.dir, 'package-lock.json'), lock('1.0.2'));
    const fail = await run(['check'], net, tmp.dir);
    expect(fail.code).toBe(1);
    expect(fail.out).toContain('tiny-colors@1.0.2');
    expect(fail.out).toContain('install_script');

    const md = await run(['check', '--format', 'markdown'], net, tmp.dir);
    expect(md.out).toContain('| `tiny-colors@1.0.2` | gained capabilities |');
    const js = JSON.parse((await run(['check', '--format', 'json'], net, tmp.dir)).out);
    expect(js.ok).toBe(false);
    expect(js.violations[0].capabilities).toContain('install_script');

    const ap = await run(['approve', 'tiny-colors'], net, tmp.dir);
    expect(ap.code).toBe(0);
    expect((await run(['check'], net, tmp.dir)).code).toBe(0);
  });

  it('check flags brand-new packages', async () => {
    writeFileSync(join(tmp.dir, 'vouch.lock.json'), JSON.stringify({ vouch: 1, packages: {} }));
    const r = await run(['check', '--json'], net, tmp.dir);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.out).violations.map((v: { kind: string }) => v.kind)).toEqual(['new-package', 'new-package']);
  });

  it('usage errors exit 2', async () => {
    expect((await run(['bogus'], net, tmp.dir)).code).toBe(2);
    expect((await run(['check'], net, tmp.dir)).code).toBe(2); // no manifest yet
    expect((await run(['--help'], net, tmp.dir)).code).toBe(0);
  });
});
