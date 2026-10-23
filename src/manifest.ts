/**
 * vouch.lock.json: the approved capability manifest for a project.
 *
 * `vouch init` records, per package name, the versions seen and the union of
 * their capabilities. `vouch check` fails when the lockfile brings a package
 * the manifest has never seen, or a version that gained a capability nobody
 * approved. `vouch approve <pkg>` accepts the current state of one package.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { analyzeLocked } from './analyze.js';
import { findLockfile, parseLockfile } from './engine/lockfile/index.js';
import type { AnalyzeOptions, CapabilityId, PackageAnalysis } from './types.js';

export const MANIFEST_FILE = 'vouch.lock.json';

export interface ManifestEntry {
  versions: string[];
  capabilities: CapabilityId[];
  installScripts: Record<string, string>;
  risk: number;
}

export interface Manifest {
  vouch: 1;
  packages: Record<string, ManifestEntry>;
}

export interface LockedPackage {
  name: string;
  version: string;
  integrity?: string;
  resolved?: string;
}

export interface CheckViolation {
  kind: 'new-package' | 'new-capability';
  name: string;
  version: string;
  capabilities: CapabilityId[];
  analysis: PackageAnalysis;
}

export interface CheckResult {
  checked: number;
  skipped: number;
  violations: CheckViolation[];
  errors: { name: string; version: string; message: string }[];
}

export function emptyManifest(): Manifest {
  return { vouch: 1, packages: {} };
}

export function readManifest(path: string): Manifest | undefined {
  if (!existsSync(path)) return undefined;
  const m = JSON.parse(readFileSync(path, 'utf8')) as Manifest;
  if (!m || typeof m.packages !== 'object') throw new Error(`${path} is not a vouch manifest`);
  return m;
}

export function writeManifest(path: string, m: Manifest): void {
  const sorted: Manifest = { vouch: 1, packages: {} };
  for (const name of Object.keys(m.packages).sort()) sorted.packages[name] = m.packages[name]!;
  writeFileSync(path, JSON.stringify(sorted, null, 2) + '\n');
}

/** Registry packages in the project lockfile, de-duplicated by name@version. */
export function lockedPackages(lockfilePath: string): LockedPackage[] {
  const pkgJsonPath = join(dirname(lockfilePath), 'package.json');
  const parsed = parseLockfile(readFileSync(lockfilePath, 'utf8'), lockfilePath, {
    packageJson: existsSync(pkgJsonPath) ? readFileSync(pkgJsonPath, 'utf8') : undefined,
  });
  const seen = new Map<string, LockedPackage>();
  for (const p of parsed.packages) {
    if (p.source !== 'registry' && p.source !== 'tarball') continue;
    const key = `${p.name}@${p.version}`;
    if (!seen.has(key)) seen.set(key, { name: p.name, version: p.version, integrity: p.integrity, resolved: p.resolved });
  }
  return [...seen.values()].sort((a, b) => (a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name)));
}

export function resolveLockfile(dir: string, explicit?: string): string {
  const path = explicit ?? findLockfile(dir);
  if (!path) throw new Error(`no lockfile found in ${dir} (package-lock.json, npm-shrinkwrap.json, pnpm-lock.yaml or yarn.lock)`);
  return path;
}

/** Records one analysis into the manifest (union of capabilities). */
export function approve(m: Manifest, a: PackageAnalysis): void {
  const e = (m.packages[a.name] ??= { versions: [], capabilities: [], installScripts: {}, risk: 0 });
  if (!e.versions.includes(a.version)) e.versions.push(a.version);
  e.versions.sort();
  e.capabilities = [...new Set([...e.capabilities, ...a.capabilities.map((c) => c.id)])].sort();
  Object.assign(e.installScripts, a.installScripts);
  e.risk = Math.max(e.risk, a.risk);
}

/** Pure comparison of one analysis against the manifest. */
export function compareToManifest(m: Manifest, a: PackageAnalysis): CheckViolation | undefined {
  const e = m.packages[a.name];
  const caps = a.capabilities.map((c) => c.id);
  if (!e) return { kind: 'new-package', name: a.name, version: a.version, capabilities: caps, analysis: a };
  const gained = caps.filter((c) => !e.capabilities.includes(c));
  if (gained.length) return { kind: 'new-capability', name: a.name, version: a.version, capabilities: gained, analysis: a };
  return undefined;
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]!);
      }
    }),
  );
  return out;
}

export type Progress = (done: number, total: number, name: string) => void;

export async function analyzeAll(
  pkgs: LockedPackage[],
  opts: AnalyzeOptions & { concurrency?: number; onProgress?: Progress } = {},
): Promise<{ analyses: PackageAnalysis[]; errors: CheckResult['errors'] }> {
  const errors: CheckResult['errors'] = [];
  let done = 0;
  const results = await pool(pkgs, opts.concurrency ?? 8, async (p) => {
    try {
      return await analyzeLocked(p, opts);
    } catch (err) {
      errors.push({ name: p.name, version: p.version, message: (err as Error).message });
      return undefined;
    } finally {
      opts.onProgress?.(++done, pkgs.length, p.name);
    }
  });
  return { analyses: results.filter((r): r is PackageAnalysis => Boolean(r)), errors };
}

export async function initManifest(pkgs: LockedPackage[], opts: Parameters<typeof analyzeAll>[1] = {}) {
  const { analyses, errors } = await analyzeAll(pkgs, opts);
  const m = emptyManifest();
  for (const a of analyses) approve(m, a);
  return { manifest: m, analyses, errors };
}

export async function checkManifest(m: Manifest, pkgs: LockedPackage[], opts: Parameters<typeof analyzeAll>[1] = {}): Promise<CheckResult> {
  // Versions already approved are skipped: nothing to re-analyse.
  const todo = pkgs.filter((p) => !m.packages[p.name]?.versions.includes(p.version));
  const { analyses, errors } = await analyzeAll(todo, opts);
  const violations: CheckViolation[] = [];
  for (const a of analyses) {
    const v = compareToManifest(m, a);
    if (v) violations.push(v);
  }
  return { checked: pkgs.length, skipped: pkgs.length - todo.length, violations, errors };
}
