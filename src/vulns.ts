/**
 * `vouch vulns`: known vulnerabilities (OSV) in the lockfile, ranked by whether
 * your own code imports the vulnerable package. First step of reachability:
 * package-level, not function-level.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import * as acorn from 'acorn';
import { defaultCacheDir } from './engine/fetch/cache.js';
import { parseLockfile } from './engine/lockfile/index.js';
import type { Ui } from './format.js';

export type Reachability = 'imported' | 'direct' | 'transitive';
export type VulnSeverity = 'critical' | 'high' | 'medium' | 'low' | 'unknown';

export interface OsvFetch {
  (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
}

export interface ImportSite {
  file: string;
  line: number;
}

export interface Advisory {
  id: string;
  summary: string;
  severity: VulnSeverity;
  aliases: string[];
  fixed?: string;
  url: string;
}

export interface VulnerablePackage {
  name: string;
  version: string;
  reachability: Reachability;
  imports: ImportSite[];
  vulns: Advisory[];
  severity: VulnSeverity;
}

export interface VulnsResult {
  scannedFiles: number;
  packagesChecked: number;
  packages: VulnerablePackage[];
}

export interface VulnsOptions {
  fetch?: OsvFetch;
  cacheDir?: string;
  /** OSV API base (default https://api.osv.dev). */
  api?: string;
}

const SEV_RANK: Record<VulnSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3, unknown: 4 };
const REACH_RANK: Record<Reachability, number> = { imported: 0, direct: 1, transitive: 2 };
const SOURCE_EXT = /\.(?:[cm]?js|jsx|ts|tsx|mts|cts)$/i;
const SKIP_DIRS = new Set(['node_modules']);

/** Bare package name of an import specifier, or undefined for relative/builtin/URL imports. */
export function packageOf(spec: string): string | undefined {
  if (!spec || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('#') || /^[a-z]+:/i.test(spec)) return undefined;
  const parts = spec.split('/');
  if (spec.startsWith('@')) return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : undefined;
  return parts[0];
}

/** Every package import (import/export from, require, dynamic import) in one source file. */
export function findImports(source: string): { spec: string; line: number }[] {
  const out: { spec: string; line: number }[] = [];
  let ast: unknown;
  for (const sourceType of ['module', 'script'] as const) {
    try {
      ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType, locations: true, allowHashBang: true, allowReturnOutsideFunction: true, allowImportExportEverywhere: true, allowAwaitOutsideFunction: true });
      break;
    } catch {
      ast = undefined;
    }
  }
  if (ast) {
    const visit = (n: unknown): void => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) return n.forEach(visit);
      const node = n as { type?: string; loc?: { start: { line: number } }; [k: string]: unknown };
      const lit = (x: unknown) => (x && typeof x === 'object' && (x as { type?: string }).type === 'Literal' && typeof (x as { value?: unknown }).value === 'string' ? ((x as { value: string }).value) : undefined);
      let spec: string | undefined;
      if (node.type === 'ImportDeclaration' || node.type === 'ExportAllDeclaration' || node.type === 'ExportNamedDeclaration' || node.type === 'ImportExpression') spec = lit(node.source);
      else if (node.type === 'CallExpression') {
        const callee = node.callee as { type?: string; name?: string } | undefined;
        const args = node.arguments as unknown[] | undefined;
        if (callee?.type === 'Identifier' && callee.name === 'require' && args?.length) spec = lit(args[0]);
      }
      if (spec !== undefined && node.loc) out.push({ spec, line: node.loc.start.line });
      for (const k of Object.keys(node)) if (k !== 'loc' && k !== 'type') visit(node[k]);
    };
    visit(ast);
    return out;
  }
  // TypeScript / JSX: acorn cannot parse it, so fall back to a line scan.
  const re = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/g;
  source.split(/\r?\n/).forEach((text, i) => {
    if (/^\s*(?:\/\/|\*)/.test(text)) return;
    for (const m of text.matchAll(re)) out.push({ spec: m[2]!, line: i + 1 });
  });
  return out;
}

/** Scans the project's own source files (outside node_modules) for package imports. */
export function scanProjectImports(dir: string): { files: number; imports: Map<string, ImportSite[]> } {
  const imports = new Map<string, ImportSite[]>();
  let files = 0;
  const walk = (d: string): void => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(p);
      } else if (e.isFile() && SOURCE_EXT.test(e.name) && !e.name.endsWith('.d.ts')) {
        let text: string;
        try {
          text = readFileSync(p, 'utf8');
        } catch {
          continue;
        }
        files++;
        const file = relative(dir, p).split('\\').join('/');
        for (const { spec, line } of findImports(text)) {
          const name = packageOf(spec);
          if (!name) continue;
          const list = imports.get(name) ?? [];
          if (!list.some((s) => s.file === file && s.line === line)) list.push({ file, line });
          imports.set(name, list);
        }
      }
    }
  };
  walk(dir);
  return { files, imports };
}

interface OsvVuln {
  id: string;
  modified?: string;
  summary?: string;
  details?: string;
  aliases?: string[];
  database_specific?: { severity?: string };
  affected?: { package?: { ecosystem?: string; name?: string }; ranges?: { events?: { fixed?: string }[] }[] }[];
}

function severityOf(v: OsvVuln): VulnSeverity {
  const s = String(v.database_specific?.severity ?? '').toLowerCase();
  if (s === 'critical' || s === 'high' || s === 'low') return s;
  if (s === 'moderate' || s === 'medium') return 'medium';
  return 'unknown';
}

function fixedFor(v: OsvVuln, name: string): string | undefined {
  for (const a of v.affected ?? []) {
    if (a.package?.name !== name) continue;
    for (const r of a.ranges ?? []) for (const e of r.events ?? []) if (e.fixed) return e.fixed;
  }
  return undefined;
}

async function vulnDetails(id: string, modified: string | undefined, fetch: OsvFetch, api: string, cacheDir: string | null): Promise<OsvVuln> {
  const file = cacheDir ? join(cacheDir, 'osv', `${id.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`) : null;
  if (file && existsSync(file)) {
    try {
      const cached = JSON.parse(readFileSync(file, 'utf8')) as OsvVuln;
      if (!modified || cached.modified === modified) return cached;
    } catch {
      /* refetch */
    }
  }
  const res = await fetch(`${api}/v1/vulns/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`OSV ${id}: HTTP ${res.status}`);
  const v = (await res.json()) as OsvVuln;
  if (file) {
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(v));
    } catch {
      /* cache is optional */
    }
  }
  return v;
}

/** Reads the lockfile, asks OSV about every package and ranks the hits by reachability then severity. */
export async function findVulns(lockfilePath: string, projectDir: string, options: VulnsOptions = {}): Promise<VulnsResult> {
  const fetch = options.fetch ?? (globalThis.fetch as unknown as OsvFetch);
  const api = (options.api ?? 'https://api.osv.dev').replace(/\/$/, '');
  const cacheDir = options.cacheDir ?? defaultCacheDir();
  const pkgJsonPath = join(dirname(lockfilePath), 'package.json');
  const parsed = parseLockfile(readFileSync(lockfilePath, 'utf8'), lockfilePath, {
    packageJson: existsSync(pkgJsonPath) ? readFileSync(pkgJsonPath, 'utf8') : undefined,
  });
  const pkgs = new Map<string, { name: string; version: string; direct: boolean; installedAs: Set<string> }>();
  for (const p of parsed.packages) {
    if (p.source !== 'registry' && p.source !== 'tarball') continue;
    const key = `${p.name}@${p.version}`;
    const e = pkgs.get(key) ?? { name: p.name, version: p.version, direct: false, installedAs: new Set<string>() };
    e.direct ||= p.direct;
    e.installedAs.add(p.alias ?? p.name);
    pkgs.set(key, e);
  }
  const list = [...pkgs.values()];
  const hits: { pkg: (typeof list)[number]; ids: { id: string; modified?: string }[] }[] = [];
  for (let i = 0; i < list.length; i += 1000) {
    const chunk = list.slice(i, i + 1000);
    const res = await fetch(`${api}/v1/querybatch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ queries: chunk.map((p) => ({ package: { ecosystem: 'npm', name: p.name }, version: p.version })) }),
    });
    if (!res.ok) throw new Error(`OSV querybatch: HTTP ${res.status}`);
    const body = (await res.json()) as { results?: { vulns?: { id: string; modified?: string }[] }[] };
    (body.results ?? []).forEach((r, j) => {
      if (r?.vulns?.length && chunk[j]) hits.push({ pkg: chunk[j]!, ids: r.vulns });
    });
  }
  const { files, imports } = hits.length ? scanProjectImports(projectDir) : { files: 0, imports: new Map<string, ImportSite[]>() };
  const details = new Map<string, Promise<OsvVuln>>();
  const out: VulnerablePackage[] = [];
  for (const { pkg, ids } of hits) {
    const vulns: Advisory[] = [];
    for (const { id, modified } of ids) {
      if (!details.has(id)) details.set(id, vulnDetails(id, modified, fetch, api, cacheDir));
      const v = await details.get(id)!;
      vulns.push({
        id,
        summary: (v.summary || v.details || '').split('\n')[0]!.trim(),
        severity: severityOf(v),
        aliases: v.aliases ?? [],
        fixed: fixedFor(v, pkg.name),
        url: `https://osv.dev/vulnerability/${id}`,
      });
    }
    vulns.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || a.id.localeCompare(b.id));
    const sites = [...pkg.installedAs].flatMap((n) => imports.get(n) ?? []);
    const reachability: Reachability = sites.length ? 'imported' : pkg.direct ? 'direct' : 'transitive';
    out.push({ name: pkg.name, version: pkg.version, reachability, imports: sites, vulns, severity: vulns[0]?.severity ?? 'unknown' });
  }
  out.sort(
    (a, b) => REACH_RANK[a.reachability] - REACH_RANK[b.reachability] || SEV_RANK[a.severity] - SEV_RANK[b.severity] || a.name.localeCompare(b.name),
  );
  return { scannedFiles: files, packagesChecked: list.length, packages: out };
}

export type FailOn = 'imported' | 'any' | 'never';

export function vulnsExitCode(r: VulnsResult, failOn: FailOn): number {
  if (failOn === 'never') return 0;
  if (failOn === 'any') return r.packages.length ? 1 : 0;
  return r.packages.some((p) => p.reachability === 'imported') ? 1 : 0;
}

const REACH_LABEL: Record<Reachability, string> = {
  imported: 'imported by your code',
  direct: 'direct dependency, not imported',
  transitive: 'transitive only',
};

/** Pretty output in the CLI's house style. */
export function renderVulns(r: VulnsResult, ui: Ui): string {
  const s = ui.s;
  const sym = ui.u ? { bad: '✖', warn: '▲', dot: '●', ok: '✔', arrow: '→' } : { bad: 'x', warn: '!', dot: '*', ok: '+', arrow: '->' };
  const sev = (v: VulnSeverity) => (v === 'critical' ? s.bold(s.red(v)) : v === 'high' ? s.red(v) : v === 'medium' ? s.yellow(v) : v === 'low' ? s.cyan(v) : s.gray(v));
  const lines: string[] = [];
  if (!r.packages.length) {
    lines.push(`  ${s.green(sym.ok)} no known vulnerabilities in ${r.packagesChecked} packages (OSV)`);
    return lines.join('\n') + '\n';
  }
  const advisories = r.packages.reduce((n, p) => n + p.vulns.length, 0);
  lines.push(`  ${s.bold('vouch vulns')}  ${r.packages.length} vulnerable of ${r.packagesChecked} packages, ${advisories} advisories, ${r.scannedFiles} source files scanned`);
  for (const reach of ['imported', 'direct', 'transitive'] as const) {
    const group = r.packages.filter((p) => p.reachability === reach);
    if (!group.length) continue;
    const head = reach === 'imported' ? s.red(`${sym.bad} ${REACH_LABEL[reach]}`) : reach === 'direct' ? s.yellow(`${sym.warn} ${REACH_LABEL[reach]}`) : s.gray(`${sym.dot} ${REACH_LABEL[reach]}`);
    lines.push('', `  ${s.bold(head)} (${group.length})`);
    for (const p of group) {
      lines.push(`    ${s.bold(`${p.name}@${p.version}`)}  ${sev(p.severity)}`);
      for (const v of p.vulns) {
        const fix = v.fixed ? s.green(`  fix ${sym.arrow} ${v.fixed}`) : '';
        lines.push(`      ${sev(v.severity)} ${v.id}  ${v.summary}${fix}`);
      }
      for (const site of p.imports.slice(0, 5)) lines.push(`      ${s.gray(`${site.file}:${site.line}`)}`);
      if (p.imports.length > 5) lines.push(`      ${s.gray(`and ${p.imports.length - 5} more`)}`);
    }
  }
  return lines.join('\n') + '\n';
}
