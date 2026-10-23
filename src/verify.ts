/**
 * Verification: does the published tarball come from where it claims, and does
 * it match that source?
 *
 *  1. Provenance: npm's attestation endpoint returns Sigstore bundles. We decode
 *     the DSSE envelope and read the SLSA provenance predicate (repo, commit,
 *     workflow). The cryptographic Sigstore signature check is NOT done yet.
 *  2. Source match: download the repo at that commit from codeload.github.com and
 *     compare every file in the npm tarball by SHA-256.
 */
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { fetchPackageFiles } from './analyze.js';
import { Cache, defaultCacheDir } from './engine/fetch/cache.js';
import { extractPackage } from './engine/fetch/tar.js';
import { DEFAULT_REGISTRY, encodePackageName, normalizeRegistry } from './engine/fetch/registry.js';
import { matchGlob } from './engine/util/glob.js';
import type { FetchLike, PackageSpec, ProvenanceResult, SourceMatchResult, VerifyOptions, VerifyResult } from './types.js';

export const SIGSTORE_NOTE =
  'Provenance statement decoded from the npm attestation bundle; the cryptographic Sigstore signature check is planned, not done.';

function getFetch(opts: VerifyOptions): FetchLike {
  if (opts.fetch) return opts.fetch;
  return (url, init) => {
    if (process.env.VOUCH_NO_NETWORK === '1') return Promise.reject(new Error(`network access is disabled (VOUCH_NO_NETWORK=1): ${url}`));
    return fetch(url, init);
  };
}

async function getJson(f: FetchLike, url: string, headers: Record<string, string> = {}): Promise<{ status: number; body?: unknown }> {
  const res = await f(url, { headers: { accept: 'application/json', 'user-agent': 'vouch', ...headers } });
  if (!res.ok) return { status: res.status };
  return { status: res.status, body: await res.json() };
}

// ---------------------------------------------------------------- provenance

interface Attestation {
  predicateType?: string;
  bundle?: { dsseEnvelope?: { payload?: string; payloadType?: string } };
}

export interface GitRef {
  owner: string;
  repo: string;
  commit?: string;
  directory?: string;
}

/** Parses the many spellings of a GitHub repository URL. */
export function parseGitHubUrl(input: string | undefined): GitRef | undefined {
  if (!input) return undefined;
  let s = input.trim().replace(/^git\+/, '');
  let commit: string | undefined;
  const at = s.match(/@([0-9a-f]{40})$/i) ?? s.match(/#([0-9a-f]{40})$/i);
  if (at) {
    commit = at[1]!.toLowerCase();
    s = s.slice(0, at.index);
  }
  s = s.replace(/@refs\/.*$/, '').replace(/#.*$/, '');
  let m = s.match(/^(?:github:)?([\w.-]+)\/([\w.-]+)$/);
  if (!m) m = s.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/[^/]+\/(.+))?\/?$/i);
  if (!m) return undefined;
  const ref: GitRef = { owner: m[1]!, repo: m[2]!.replace(/\.git$/, '') };
  if (commit) ref.commit = commit;
  if (m[3]) ref.directory = m[3];
  return ref;
}

/** Decodes one attestation's in-toto statement and extracts SLSA provenance facts. */
export function decodeProvenance(att: Attestation): { repo?: string; commit?: string; workflow?: string; subjects: { name?: string; sha512?: string }[] } | undefined {
  const payload = att.bundle?.dsseEnvelope?.payload;
  if (!payload) return undefined;
  let stmt: any;
  try {
    stmt = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  } catch {
    return undefined;
  }
  const pred = stmt?.predicate ?? {};
  const subjects = Array.isArray(stmt?.subject)
    ? stmt.subject.map((s: any) => ({ name: s?.name, sha512: s?.digest?.sha512 }))
    : [];
  // SLSA v1
  const bd = pred.buildDefinition;
  if (bd) {
    const wf = bd.externalParameters?.workflow ?? {};
    const dep = (bd.resolvedDependencies ?? [])[0] ?? {};
    const gh = parseGitHubUrl(wf.repository) ?? parseGitHubUrl(dep.uri);
    return {
      repo: gh ? `${gh.owner}/${gh.repo}` : wf.repository,
      commit: dep.digest?.gitCommit ?? dep.digest?.sha1,
      workflow: wf.path ? `${wf.path}${wf.ref ? `@${wf.ref}` : ''}` : undefined,
      subjects,
    };
  }
  // SLSA v0.2
  const cs = pred.invocation?.configSource;
  if (cs) {
    const gh = parseGitHubUrl(cs.uri);
    return { repo: gh ? `${gh.owner}/${gh.repo}` : cs.uri, commit: cs.digest?.sha1, workflow: cs.entryPoint, subjects };
  }
  return { subjects };
}

function sriToHex(integrity: string | undefined): string | undefined {
  const m = integrity?.match(/sha512-([A-Za-z0-9+/=]+)/);
  return m ? Buffer.from(m[1]!, 'base64').toString('hex') : undefined;
}

export async function readProvenance(spec: PackageSpec, opts: VerifyOptions & { integrity?: string } = {}): Promise<ProvenanceResult> {
  const registry = normalizeRegistry(opts.registry ?? DEFAULT_REGISTRY);
  const url = `${registry}/-/npm/v1/attestations/${encodePackageName(spec.name)}@${encodeURIComponent(spec.version)}`;
  let res: { status: number; body?: unknown };
  try {
    res = await getJson(getFetch(opts), url);
  } catch (err) {
    return { status: 'error', note: `attestations request failed: ${(err as Error).message}` };
  }
  if (res.status === 404) return { status: 'absent', note: 'No npm provenance attestation was published for this version.' };
  if (!res.body) return { status: 'error', note: `attestations endpoint answered HTTP ${res.status}` };
  const atts = ((res.body as { attestations?: Attestation[] }).attestations ?? []).filter((a) => /slsa\.dev\/provenance/.test(a.predicateType ?? ''));
  if (atts.length === 0) return { status: 'absent', note: 'Attestations exist but none is SLSA provenance (publish attestation only).' };
  const decoded = decodeProvenance(atts[0]!);
  if (!decoded?.repo) return { status: 'error', note: 'Could not decode the provenance statement.' };
  const notes = [SIGSTORE_NOTE];
  const hex = sriToHex(opts.integrity);
  if (hex && decoded.subjects.length) {
    notes.push(
      decoded.subjects.some((s) => s.sha512 === hex)
        ? 'The attested subject digest matches the tarball.'
        : 'WARNING: the attested subject digest does not match the downloaded tarball.',
    );
  }
  return { status: 'present', repo: decoded.repo, commit: decoded.commit, workflow: decoded.workflow, note: notes.join(' ') };
}

// ---------------------------------------------------------------- source match

const BUILD_DIRS = /^(dist|build|lib|esm|cjs|es|umd|out|bundle|types|typings|_cjs|_esm|_types)\//;
const BUILD_FILES = /(\.min\.(js|mjs|cjs|css)|\.d\.(ts|mts|cts)|\.map)$/;
const CODE_FILE = /\.(js|cjs|mjs|jsx|ts|tsx|mts|cts|node|wasm|sh|bash|ps1|cmd|bat|py|exe|dll|so|dylib)$|^bin\//i;

function sha256(b: Uint8Array): string {
  return createHash('sha256').update(b).digest('hex');
}

function normalizeEol(b: Buffer): string {
  return sha256(Buffer.from(b.toString('utf8').replace(/\r\n/g, '\n')));
}

/** Directory outputs a repo declares: tsconfig outDir/declarationDir and ignored build dirs. */
export function buildOutputGlobs(repo: Map<string, Buffer>, dir: string): string[] {
  const globs: string[] = [];
  const read = (p: string) => repo.get(dir ? `${dir}/${p}` : p)?.toString('utf8');
  {
    for (const src of [read('.gitignore'), dir ? repo.get('.gitignore')?.toString('utf8') : undefined]) {
      for (const raw of (src ?? '').split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#') || line.startsWith('!')) continue;
        const g = line.replace(/^\//, '').replace(/\/$/, '');
        if (g === '*' || g === '**') continue;
        globs.push(g, `${g}/**`);
      }
    }
  }
  for (const ts of ['tsconfig.json', 'tsconfig.build.json']) {
    const text = read(ts);
    if (!text) continue;
    for (const key of ['outDir', 'declarationDir']) {
      const m = text.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`));
      if (m) globs.push(`${m[1]!.replace(/^\.\//, '').replace(/\/$/, '')}/**`);
    }
  }
  return globs;
}

export function isBuildArtifact(path: string, globs: string[] = []): boolean {
  if (BUILD_DIRS.test(path) || BUILD_FILES.test(path)) return true;
  return globs.some((g) => matchGlob(g, path) || (!g.includes('/') && path.split('/').some((seg) => matchGlob(g, seg))));
}

/** Finds the repo directory holding the package (monorepos), by package.json name. */
export function findPackageDir(repo: Map<string, Buffer>, name: string, hint?: string): string {
  if (hint) {
    const h = hint.replace(/^\.?\//, '').replace(/\/$/, '');
    if (repo.has(`${h}/package.json`)) return h;
  }
  const candidates: string[] = [];
  for (const [p, data] of repo) {
    if (!p.endsWith('package.json') || p.includes('node_modules/')) continue;
    if (p !== 'package.json' && !p.endsWith('/package.json')) continue;
    try {
      if (JSON.parse(data.toString('utf8')).name === name) candidates.push(posix.dirname(p) === '.' ? '' : posix.dirname(p));
    } catch {
      /* not JSON */
    }
  }
  candidates.sort((a, b) => a.length - b.length);
  return candidates[0] ?? '';
}

const INSTALL_HOOKS = ['preinstall', 'install', 'postinstall'];

function installHooks(pkgJson: Buffer | undefined): string {
  try {
    const scripts = JSON.parse(pkgJson?.toString('utf8') ?? '{}').scripts ?? {};
    return INSTALL_HOOKS.map((k) => `${k}=${scripts[k] ?? ''}`).join('\n');
  } catch {
    return '';
  }
}

function parseJson(b: Buffer | undefined): any {
  try {
    return b ? JSON.parse(b.toString('utf8')) : undefined;
  } catch {
    return undefined;
  }
}

const BUILD_SCRIPT = /build|bundle|compile|prepack|prepublish|prepare|dist/i;
const SOURCE_SEG = new Set(['src', 'source', 'modules', 'internals', 'lib-src']);
const stemOf = (p: string) => posix.basename(p).replace(/\.[^.]+$/, '').replace(/\.d$/, '');

/**
 * Monorepo packages are often assembled by a build script from the repo's source
 * folders (core-js generates its entry points from modules/). A package file with
 * no counterpart path counts as generated when the repo has a build script and
 * either its name exists under a source folder, or the package's "files" field
 * names a folder the repo does not track.
 */
function monorepoGenerated(pkg: Map<string, Buffer>, repo: Map<string, Buffer>, dir: string, tracked: Set<string>): (p: string) => boolean {
  const hasBuild = [repo.get(`${dir}/package.json`), repo.get('package.json')].some((b) => {
    const scripts = parseJson(b)?.scripts;
    return scripts && typeof scripts === 'object' && Object.entries(scripts).some(([k, v]) => BUILD_SCRIPT.test(k) && typeof v === 'string' && v.trim() !== '');
  });
  if (!hasBuild) return () => false;
  const names = new Set<string>();
  for (const p of repo.keys()) {
    if (p.includes('node_modules/')) continue;
    const segs = p.split('/');
    if (!segs.slice(0, -1).some((s) => SOURCE_SEG.has(s))) continue;
    const base = segs[segs.length - 1]!;
    const stem = stemOf(base);
    names.add(base).add(stem);
    // core-js style dotted module names: es.array.at -> at, array.at
    const parts = stem.split('.');
    for (let i = 1; i < parts.length; i++) names.add(parts.slice(i).join('.'));
  }
  const filesField = [parseJson(pkg.get('package.json'))?.files, parseJson(repo.get(`${dir}/package.json`))?.files]
    .flatMap((f) => (Array.isArray(f) ? f : []))
    .filter((f): f is string => typeof f === 'string' && !f.startsWith('!'))
    .map((f) => f.replace(/^\.\//, '').split('/')[0]!.replace(/\*.*$/, ''))
    .filter((top) => top && !top.includes('.') && !tracked.has(top));
  const absentFolders = new Set(filesField);
  return (p: string) => {
    const segs = p.split('/');
    if (segs.length > 1 && absentFolders.has(segs[0]!)) return true;
    const base = segs[segs.length - 1]!;
    if (names.has(base) || names.has(stemOf(base))) return true;
    // features/array/at.js <- modules/es.array.at.js
    if (segs.length > 1) {
      const dotted = [...segs.slice(1, -1), stemOf(base)].join('.');
      if (names.has(dotted)) return true;
    }
    return false;
  };
}

/**
 * Compares a published package's files against the repository at a commit.
 * Pure: both sides are in-memory maps of path -> bytes.
 */
export function compareToSource(
  pkg: Map<string, Buffer>,
  repo: Map<string, Buffer>,
  opts: { name: string; directory?: string },
): Omit<SourceMatchResult, 'repo' | 'ref'> {
  const dir = findPackageDir(repo, opts.name, opts.directory);
  const globs = buildOutputGlobs(repo, dir);
  const inRepo = (p: string) => repo.get(dir ? `${dir}/${p}` : p) ?? (dir ? repo.get(p) : undefined);
  // A build dir the repo itself tracks (express commits lib/) is source, not output.
  const prefix = dir ? `${dir}/` : '';
  const tracked = new Set<string>();
  for (const p of repo.keys()) if (p.startsWith(prefix)) tracked.add(p.slice(prefix.length).split('/')[0]!);
  const built = (p: string): boolean => {
    if (BUILD_FILES.test(p) || globs.some((g) => matchGlob(g, p))) return true;
    return BUILD_DIRS.test(p) && !tracked.has(p.split('/')[0]!);
  };
  // Files an install hook runs are never "expected build output".
  const hookTargets = new Set<string>();
  for (const cmd of installHooks(pkg.get('package.json')).split('\n')) {
    for (const tok of cmd.split(/[\s=;&|]+/)) if (/\.(c|m)?js$|\.sh$/.test(tok)) hookTargets.add(tok.replace(/^\.\//, ''));
  }
  const generated = dir ? monorepoGenerated(pkg, repo, dir, tracked) : () => false;
  let identical = 0;
  const differs: string[] = [];
  const builtOnly: string[] = [];
  const onlyInPackage: string[] = [];
  const notes: string[] = [];
  for (const path of [...pkg.keys()].sort()) {
    const data = pkg.get(path)!;
    const src = inRepo(path);
    if (path === 'package.json') {
      // npm/pnpm/yarn rewrite package.json on publish; only install hooks must agree.
      if (!src || installHooks(src) !== installHooks(data)) {
        if (src) differs.push('package.json (install scripts differ from source)');
        else onlyInPackage.push(path);
      } else identical++;
      continue;
    }
    if (src) {
      if (sha256(src) === sha256(data) || normalizeEol(src) === normalizeEol(data)) identical++;
      else if (built(path) && !hookTargets.has(path)) builtOnly.push(path);
      else differs.push(path);
      continue;
    }
    if ((built(path) || generated(path)) && !hookTargets.has(path)) builtOnly.push(path);
    else onlyInPackage.push(path);
  }
  if (dir) notes.push(`package found in repo directory ${dir}/`);
  const suspicious = [...differs, ...onlyInPackage].filter((p) => p.startsWith('package.json (') || CODE_FILE.test(p));
  const status: SourceMatchResult['status'] = suspicious.length ? 'mismatch' : differs.length || onlyInPackage.length ? 'partial' : 'match';
  return { status, identical, differs, builtOnly, onlyInPackage, note: notes.join('; ') || undefined };
}

interface RegistryMeta {
  repository?: string | { url?: string; directory?: string };
  gitHead?: string;
}

async function downloadRepo(
  f: FetchLike,
  ref: GitRef,
  rev: string,
  token: string | undefined,
  cache: Cache,
): Promise<Map<string, Buffer> | undefined> {
  const immutable = /^[0-9a-f]{40}$/i.test(rev);
  const key = `gh-${ref.owner}-${ref.repo}-${rev}`;
  let data = immutable ? cache.getTarball(key) : undefined;
  if (!data) {
    const headers: Record<string, string> = { 'user-agent': 'vouch' };
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await f(`https://codeload.github.com/${ref.owner}/${ref.repo}/tar.gz/${encodeURIComponent(rev)}`, { headers });
    if (!res.ok) return undefined;
    data = Buffer.from(await res.arrayBuffer());
    if (immutable) cache.putTarball(key, data);
  }
  return extractPackage(data, { maxBytes: 1024 * 1024 * 1024, maxEntries: 200_000 });
}

/** Verifies an already-downloaded package (provenance + source match). */
export async function verifyFiles(
  spec: PackageSpec,
  pkg: Map<string, Buffer>,
  opts: VerifyOptions & { integrity?: string } = {},
): Promise<VerifyResult> {
  const f = getFetch(opts);
  const token = opts.githubToken ?? process.env.GITHUB_TOKEN;
  const cache = new Cache(opts.cacheDir ?? defaultCacheDir());
  const provenance = await readProvenance(spec, opts);
  const empty: SourceMatchResult = { status: 'unknown', identical: 0, differs: [], builtOnly: [], onlyInPackage: [] };

  let ref: GitRef | undefined;
  let basis = '';
  if (provenance.status === 'present' && provenance.repo && provenance.commit) {
    ref = parseGitHubUrl(provenance.repo);
    if (ref) ref.commit = provenance.commit;
    basis = 'provenance';
  }
  let directory: string | undefined;
  let meta: RegistryMeta | undefined;
  try {
    const registry = normalizeRegistry(opts.registry ?? DEFAULT_REGISTRY);
    const r = await getJson(f, `${registry}/${encodePackageName(spec.name)}/${encodeURIComponent(spec.version)}`);
    meta = r.body as RegistryMeta | undefined;
  } catch {
    /* metadata is optional */
  }
  const repoField = typeof meta?.repository === 'string' ? meta.repository : meta?.repository?.url;
  directory = typeof meta?.repository === 'object' ? meta.repository.directory : undefined;
  if (!ref) {
    ref = parseGitHubUrl(repoField);
    if (ref && meta?.gitHead && /^[0-9a-f]{40}$/i.test(meta.gitHead)) {
      ref.commit = meta.gitHead.toLowerCase();
      basis = 'gitHead';
    }
  }
  if (!ref) {
    return { provenance, source: { ...empty, note: repoField ? `repository ${repoField} is not on GitHub; source match skipped` : 'no repository declared; source match skipped' } };
  }
  directory ??= ref.directory;
  const repoName = `${ref.owner}/${ref.repo}`;
  const revs = ref.commit ? [ref.commit] : [`v${spec.version}`, spec.version, `${spec.name}@${spec.version}`];
  for (const rev of revs) {
    let repo: Map<string, Buffer> | undefined;
    try {
      repo = await downloadRepo(f, ref, rev, token, cache);
    } catch (err) {
      return { provenance, source: { ...empty, repo: repoName, ref: rev, note: `could not download source: ${(err as Error).message}` } };
    }
    if (!repo) continue;
    const result = compareToSource(pkg, repo, { name: spec.name, directory });
    const how = ref.commit ? `commit from ${basis}` : `tag ${rev} (no commit recorded; tags can move)`;
    return { provenance, source: { ...result, repo: repoName, ref: rev, note: [`compared against ${how}`, result.note].filter(Boolean).join('; ') } };
  }
  return { provenance, source: { ...empty, repo: repoName, note: ref.commit ? `commit ${ref.commit} not found on GitHub` : 'no commit recorded and no matching tag found' } };
}

export async function verifyPackage(spec: PackageSpec, opts: VerifyOptions = {}): Promise<VerifyResult> {
  const { files, version, integrity } = await fetchPackageFiles(spec, opts);
  return verifyFiles({ name: spec.name, version }, files, { ...opts, integrity });
}
