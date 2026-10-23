/**
 * Builds the Trust Index data: public/data/index.json and public/data/pkg/<name>.json.
 *
 *   npx tsx scripts/build-index.ts [--limit N] [--only a,b] [--concurrency 4] [--timeout 90]
 *
 * Calls reportPackage from the Vouch core (../src) for the latest version of each
 * package in scripts/packages.json. Tarballs over 15 MB are skipped. Set GITHUB_TOKEN
 * to raise the GitHub API rate limit used for source matching.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reportPackage } from '../../src/index';
import type { PackageReport } from '../src/types';
import { slug, summarize, type IndexEntry, type IndexFile } from '../src/summary';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'public', 'data');
const MAX_TARBALL = 15 * 1024 * 1024;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const concurrency = Number(arg('concurrency') ?? 4);
const timeoutMs = Number(arg('timeout') ?? 90) * 1000;
const limit = arg('limit') ? Number(arg('limit')) : Infinity;
const resume = process.argv.includes('--resume');
const only = arg('only')?.split(',').map((s) => s.trim()).filter(Boolean);

interface Packument {
  'dist-tags'?: { latest?: string };
  versions?: Record<string, { dist?: { unpackedSize?: number; tarball?: string } }>;
}

async function latest(name: string): Promise<{ version: string; size?: number; tarball?: string }> {
  const res = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2F')}`, {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
  });
  if (!res.ok) throw new Error(`registry ${res.status}`);
  const p = (await res.json()) as Packument;
  const version = p['dist-tags']?.latest;
  if (!version) throw new Error('no latest dist-tag');
  const dist = p.versions?.[version]?.dist;
  return { version, size: dist?.unpackedSize, tarball: dist?.tarball };
}

async function tarballSize(url?: string): Promise<number | undefined> {
  if (!url) return undefined;
  try {
    const r = await fetch(url, { method: 'HEAD' });
    const n = Number(r.headers.get('content-length'));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  } catch {
    return undefined;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout after ${ms / 1000}s (${label})`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function main() {
  let names = JSON.parse(await readFile(join(here, 'packages.json'), 'utf8')) as string[];
  names = Array.from(new Set(names));
  if (only?.length) names = names.filter((n) => only.includes(n));
  names = names.slice(0, limit);

  await mkdir(join(outDir, 'pkg'), { recursive: true });
  const entries: IndexEntry[] = [];
  const skipped: { name: string; reason: string }[] = [];
  const opts = { githubToken: process.env.GITHUB_TOKEN || process.env.GH_TOKEN || undefined };

  const writeIndex = async () => {
    const pkgs = [...entries].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    const index: IndexFile = { generatedAt: new Date().toISOString(), source: 'live', count: pkgs.length, skipped, packages: pkgs };
    await writeFile(join(outDir, 'index.json'), JSON.stringify(index));
  };

  let next = 0;
  let done = 0;
  async function worker() {
    while (next < names.length) {
      const name = names[next++];
      const started = Date.now();
      try {
        const cached = join(outDir, 'pkg', `${slug(name)}.json`);
        if (resume && existsSync(cached)) {
          entries.push(summarize(JSON.parse(await readFile(cached, 'utf8')) as PackageReport));
          done++;
          continue;
        }
        const meta = await latest(name);
        const size = await tarballSize(meta.tarball);
        if (size && size > MAX_TARBALL) throw new Error(`tarball ${(size / 1048576).toFixed(1)} MB exceeds 15 MB`);
        const report: PackageReport = await withTimeout(reportPackage({ name, version: meta.version }, opts), timeoutMs, name);
        await writeFile(join(outDir, 'pkg', `${slug(name)}.json`), JSON.stringify(report, null, 2));
        entries.push(summarize(report));
        done++;
        await writeIndex();
        console.log(`[${done + skipped.length}/${names.length}] ${name}@${report.version} ${report.grade} ${report.score} (${Date.now() - started} ms)`);
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        skipped.push({ name, reason });
        console.warn(`[${done + skipped.length}/${names.length}] SKIP ${name}: ${reason}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));

  await writeIndex();
  console.log(`\nwrote ${entries.length} reports, skipped ${skipped.length}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
