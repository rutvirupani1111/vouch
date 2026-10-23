import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from '../src/cli/main.js';
import { createStyle } from '../src/engine/util/ansi.js';
import { findImports, packageOf, type OsvFetch } from '../src/vulns.js';
import { npmLock, tempDir } from './helpers.js';

const VULNS: Record<string, { id: string; modified: string; summary: string; database_specific: { severity: string }; affected: unknown[] }> = {
  'GHSA-lodash': { id: 'GHSA-lodash', modified: '2026-01-01T00:00:00Z', summary: 'Prototype pollution in lodash', database_specific: { severity: 'HIGH' }, affected: [{ package: { ecosystem: 'npm', name: 'lodash' }, ranges: [{ events: [{ introduced: '0' }, { fixed: '4.17.21' }] }] }] },
  'GHSA-minimist': { id: 'GHSA-minimist', modified: '2026-01-01T00:00:00Z', summary: 'minimist prototype pollution', database_specific: { severity: 'CRITICAL' }, affected: [] },
  'GHSA-axios': { id: 'GHSA-axios', modified: '2026-01-01T00:00:00Z', summary: 'axios SSRF', database_specific: { severity: 'MODERATE' }, affected: [] },
};
const AFFECTED: Record<string, string> = { lodash: 'GHSA-lodash', minimist: 'GHSA-minimist', axios: 'GHSA-axios' };

function fakeOsv() {
  const calls: string[] = [];
  const fetch: OsvFetch = async (url, init) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url.endsWith('/v1/querybatch')) {
      const { queries } = JSON.parse(init!.body!) as { queries: { package: { name: string } }[] };
      const results = queries.map((q) => {
        const id = AFFECTED[q.package.name];
        return id ? { vulns: [{ id, modified: VULNS[id]!.modified }] } : {};
      });
      return { ok: true, status: 200, json: async () => ({ results }) };
    }
    const id = decodeURIComponent(url.split('/').pop()!);
    const v = VULNS[id];
    return v ? { ok: true, status: 200, json: async () => v } : { ok: false, status: 404, json: async () => ({}) };
  };
  return { fetch, calls };
}

describe('import scanning', () => {
  it('maps specifiers to package names', () => {
    expect(packageOf('lodash/fp')).toBe('lodash');
    expect(packageOf('@scope/pkg/sub')).toBe('@scope/pkg');
    expect(packageOf('./local')).toBeUndefined();
    expect(packageOf('node:fs')).toBeUndefined();
  });
  it('finds import, require and dynamic import with lines', () => {
    const src = "import a from 'lodash';\nconst m = require('minimist');\nawait import('axios');\nexport * from '@x/y';\n";
    expect(findImports(src)).toEqual([
      { spec: 'lodash', line: 1 },
      { spec: 'minimist', line: 2 },
      { spec: 'axios', line: 3 },
      { spec: '@x/y', line: 4 },
    ]);
  });
  it('falls back to a line scan for TypeScript', () => {
    const src = "import type { X } from 'lodash';\nconst f = (a: number): string => require('minimist');\n";
    expect(findImports(src).map((i) => i.spec)).toEqual(['lodash', 'minimist']);
  });
});

describe('vouch vulns', () => {
  let tmp: ReturnType<typeof tempDir>;
  beforeEach(() => {
    tmp = tempDir('vulns');
    writeFileSync(
      join(tmp.dir, 'package-lock.json'),
      npmLock(
        { lodash: '^4.17.0', axios: '^1.0.0', chalk: '^5.0.0' },
        {
          'node_modules/lodash': { version: '4.17.20', resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.20.tgz' },
          'node_modules/axios': { version: '1.0.0', resolved: 'https://registry.npmjs.org/axios/-/axios-1.0.0.tgz' },
          'node_modules/chalk': { version: '5.3.0', resolved: 'https://registry.npmjs.org/chalk/-/chalk-5.3.0.tgz' },
          'node_modules/minimist': { version: '1.2.5', resolved: 'https://registry.npmjs.org/minimist/-/minimist-1.2.5.tgz' },
        },
      ),
    );
    mkdirSync(join(tmp.dir, 'src'));
    writeFileSync(join(tmp.dir, 'src', 'index.ts'), "import chalk from 'chalk';\nimport { merge } from 'lodash';\n");
    mkdirSync(join(tmp.dir, 'node_modules', 'x'), { recursive: true });
    writeFileSync(join(tmp.dir, 'node_modules', 'x', 'i.js'), "require('axios')\n");
  });
  afterEach(() => tmp.cleanup());

  const run = (argv: string[], fetch: OsvFetch) => {
    let out = '';
    let err = '';
    const ui = { s: createStyle(false), u: true };
    return main(['vulns', ...argv, '--cache-dir', join(tmp.dir, '.cache')], { out: (s) => (out += s), err: (s) => (err += s), ui, fetch: fetch as never, cwd: tmp.dir }).then(
      (code) => ({ code, out, err }),
    );
  };

  it('classifies reachability, sorts and fails on imported', async () => {
    const { fetch } = fakeOsv();
    const r = await run(['--json'], fetch);
    expect(r.err).toBe('');
    expect(r.code).toBe(1);
    const res = JSON.parse(r.out);
    expect(res.packages.map((p: { name: string; reachability: string }) => `${p.name}:${p.reachability}`)).toEqual([
      'lodash:imported',
      'axios:direct',
      'minimist:transitive',
    ]);
    expect(res.packages[0].imports).toEqual([{ file: 'src/index.ts', line: 2 }]);
    expect(res.packages[0].vulns[0]).toMatchObject({ id: 'GHSA-lodash', severity: 'high', fixed: '4.17.21' });
    expect(res.packages[2].severity).toBe('critical');
  });

  it('pretty output groups by reachability; --fail-on never exits 0; details are cached', async () => {
    const osv = fakeOsv();
    const r = await run(['--fail-on', 'never'], osv.fetch);
    expect(r.code).toBe(0);
    expect(r.out).toContain('imported by your code');
    expect(r.out).toContain('direct dependency, not imported');
    expect(r.out).toContain('transitive only');
    expect(r.out).toContain('src/index.ts:2');
    expect(r.out.indexOf('lodash@4.17.20')).toBeLessThan(r.out.indexOf('axios@1.0.0'));
    const again = fakeOsv();
    await run(['--fail-on', 'never'], again.fetch);
    expect(again.calls.filter((c) => c.startsWith('GET'))).toEqual([]);
  });

  it('--fail-on any fails when nothing is imported; clean projects pass', async () => {
    writeFileSync(join(tmp.dir, 'src', 'index.ts'), "import chalk from 'chalk';\n");
    expect((await run([], fakeOsv().fetch)).code).toBe(0);
    expect((await run(['--fail-on', 'any'], fakeOsv().fetch)).code).toBe(1);
    expect((await run(['--fail-on', 'bogus'], fakeOsv().fetch)).code).toBe(2);
  });
});
