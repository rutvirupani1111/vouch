import { describe, expect, it } from 'vitest';
import { compareToSource, isBuildArtifact, reportPackage, scoreReport, verifyPackage } from '../src/index.js';
import { decodeProvenance, parseGitHubUrl } from '../src/verify.js';
import { benignV1, maliciousV2, toBuffers } from './fixtures/packages.mjs';
import { fakeNet, slsaV1Attestation, tempDir } from './helpers.js';

const SHA = 'a'.repeat(40);

describe('parseGitHubUrl', () => {
  it.each([
    ['git+https://github.com/chalk/chalk.git', 'chalk/chalk'],
    ['git://github.com/expressjs/express.git', 'expressjs/express'],
    ['github:sindresorhus/ky', 'sindresorhus/ky'],
    ['sindresorhus/ky', 'sindresorhus/ky'],
    ['git@github.com:owner/repo.git', 'owner/repo'],
    ['https://github.com/owner/repo/tree/main/packages/x', 'owner/repo'],
  ])('%s', (input, expected) => {
    const r = parseGitHubUrl(input)!;
    expect(`${r.owner}/${r.repo}`).toBe(expected);
  });
  it('reads commit suffixes and rejects non-GitHub hosts', () => {
    expect(parseGitHubUrl(`git+https://github.com/o/r@${SHA}`)?.commit).toBe(SHA);
    expect(parseGitHubUrl('https://gitlab.com/o/r')).toBeUndefined();
  });
});

describe('decodeProvenance', () => {
  it('reads repo, commit and workflow from a SLSA v1 DSSE payload', () => {
    const d = decodeProvenance(slsaV1Attestation({ repo: 'o/r', commit: SHA, workflow: '.github/workflows/release.yml' }));
    expect(d).toMatchObject({ repo: 'o/r', commit: SHA, workflow: '.github/workflows/release.yml@refs/heads/main' });
  });
});

describe('compareToSource', () => {
  const src = benignV1();
  it('matches an identical package', () => {
    const r = compareToSource(toBuffers(src), toBuffers(src), { name: 'tiny-colors' });
    expect(r.status).toBe('match');
    expect(r.identical).toBe(Object.keys(src).length);
  });
  it('treats build outputs as expected and unexplained code as suspicious', () => {
    const pkg = toBuffers({ ...src, 'dist/index.js': 'built', 'index.min.js': 'x', 'lib/setup.js': 'evil()' });
    const repo = toBuffers({ ...src, '.gitignore': 'dist\n' });
    const r = compareToSource(pkg, repo, { name: 'tiny-colors' });
    expect(r.builtOnly).toEqual(expect.arrayContaining(['dist/index.js', 'index.min.js', 'lib/setup.js']));
    const r2 = compareToSource(toBuffers({ ...src, 'payload.js': 'evil()' }), repo, { name: 'tiny-colors' });
    expect(r2.onlyInPackage).toEqual(['payload.js']);
    expect(r2.status).toBe('mismatch');
  });
  it('flags a changed source file and an injected install hook', () => {
    const pkg = toBuffers({ ...src, 'index.js': src['index.js'] + '\nsteal();\n' });
    expect(compareToSource(pkg, toBuffers(src), { name: 'tiny-colors' })).toMatchObject({ status: 'mismatch', differs: ['index.js'] });
    const hooked = toBuffers(maliciousV2());
    hooked.delete('lib/setup.js');
    const r = compareToSource(hooked, toBuffers(src), { name: 'tiny-colors' });
    expect(r.differs[0]).toMatch(/install scripts differ/);
  });
  it('tolerates CRLF differences and non-code extras as partial', () => {
    const crlf = toBuffers({ ...src, 'index.js': src['index.js']!.replace(/\n/g, '\r\n'), 'NOTES.md': 'hi' });
    const r = compareToSource(crlf, toBuffers(src), { name: 'tiny-colors' });
    expect(r.status).toBe('partial');
    expect(r.onlyInPackage).toEqual(['NOTES.md']);
  });
  it('finds the package inside a monorepo', () => {
    const repo: Record<string, string> = { 'package.json': '{"name":"root"}' };
    for (const [k, v] of Object.entries(src)) repo[`packages/colors/${k}`] = v;
    const r = compareToSource(toBuffers(src), toBuffers(repo), { name: 'tiny-colors' });
    expect(r.status).toBe('match');
  });
  it('knows common build artifact paths', () => {
    expect(isBuildArtifact('dist/a.js')).toBe(true);
    expect(isBuildArtifact('esm/a.mjs')).toBe(true);
    expect(isBuildArtifact('types/index.d.ts')).toBe(true);
    expect(isBuildArtifact('src/a.js')).toBe(false);
  });
});

describe('verifyPackage / reportPackage (offline)', () => {
  const files = benignV1();
  const net = () =>
    fakeNet(
      {
        'tiny-colors': {
          '1.0.0': { files, provenance: { repo: 'acme/tiny-colors', commit: SHA, workflow: '.github/workflows/publish.yml' } },
          '1.0.1': { files, repository: 'git+https://github.com/acme/tiny-colors.git', gitHead: SHA },
          '1.0.2': { files: maliciousV2(), repository: 'git+https://github.com/acme/tiny-colors.git', gitHead: SHA },
          '1.0.3': { files },
        },
      },
      { [`acme/tiny-colors@${SHA}`]: files },
    );

  it('uses provenance for repo + commit', async () => {
    const tmp = tempDir('verify');
    try {
      const v = await verifyPackage({ name: 'tiny-colors', version: '1.0.0' }, { fetch: net().fetch, cacheDir: tmp.dir });
      expect(v.provenance).toMatchObject({ status: 'present', repo: 'acme/tiny-colors', commit: SHA });
      expect(v.provenance.note).toMatch(/planned, not done/);
      expect(v.provenance.note).toMatch(/digest matches/);
      expect(v.source).toMatchObject({ status: 'match', repo: 'acme/tiny-colors', ref: SHA });
    } finally {
      tmp.cleanup();
    }
  });

  it('falls back to repository + gitHead and catches a tampered tarball', async () => {
    const tmp = tempDir('verify');
    try {
      const ok = await verifyPackage({ name: 'tiny-colors', version: '1.0.1' }, { fetch: net().fetch, cacheDir: tmp.dir });
      expect(ok.provenance.status).toBe('absent');
      expect(ok.source.status).toBe('match');
      const bad = await reportPackage({ name: 'tiny-colors', version: '1.0.2' }, { fetch: net().fetch, cacheDir: tmp.dir });
      expect(bad.verify.source.status).toBe('mismatch');
      expect(bad.verify.source.onlyInPackage).toContain('lib/setup.js');
      expect(bad.grade).toBe('F');
    } finally {
      tmp.cleanup();
    }
  });

  it('reports unknown when no repository is declared', async () => {
    const tmp = tempDir('verify');
    try {
      const r = await reportPackage({ name: 'tiny-colors', version: '1.0.3' }, { fetch: net().fetch, cacheDir: tmp.dir });
      expect(r.verify.source.status).toBe('unknown');
      expect(r.score).toBeLessThan(90);
    } finally {
      tmp.cleanup();
    }
  });
});

describe('scoreReport', () => {
  const base = { name: 'x', version: '1.0.0', capabilities: [], envVars: [], endpoints: [], installScripts: {}, files: 1, unpackedSize: 1, risk: 0, findings: [] };
  it('gives a clean, provenance-backed, source-matched package an A', () => {
    const s = scoreReport(base, {
      provenance: { status: 'present' },
      source: { status: 'match', identical: 1, differs: [], builtOnly: [], onlyInPackage: [] },
    });
    expect(s).toEqual({ score: 100, grade: 'A' });
  });
  it('caps a critical finding at F', () => {
    const s = scoreReport(
      { ...base, findings: [{ id: 'crypto-wallet', severity: 'critical', title: '', detail: '' }] },
      { provenance: { status: 'present' }, source: { status: 'match', identical: 1, differs: [], builtOnly: [], onlyInPackage: [] } },
    );
    expect(s.grade).toBe('F');
  });
});
