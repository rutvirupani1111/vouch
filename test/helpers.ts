import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeIntegrity } from '../src/engine/fetch/integrity.js';
import type { FetchLike } from '../src/types.js';
import { makeTgz } from './fixtures/tar.mjs';
import type { Files } from './fixtures/packages.mjs';

export const REGISTRY = 'https://registry.npmjs.org';

type Res = Awaited<ReturnType<FetchLike>>;

export function response(status: number, body: unknown): Res {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
    arrayBuffer: async () => {
      const buf = body instanceof Buffer ? body : Buffer.from(JSON.stringify(body));
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    },
  };
}

export interface FakePackage {
  files: Files;
  /** registry metadata extras: repository, gitHead */
  repository?: string | { url: string; directory?: string };
  gitHead?: string;
  /** SLSA v1 provenance to serve from the attestations endpoint */
  provenance?: { repo: string; commit: string; workflow: string };
}

export interface FakeNet {
  fetch: FetchLike;
  requests: string[];
}

export function slsaV1Attestation(p: { repo: string; commit: string; workflow: string }, sha512Hex?: string) {
  const statement = {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{ name: 'pkg:npm/x', digest: { sha512: sha512Hex ?? '00' } }],
    predicateType: 'https://slsa.dev/provenance/v1',
    predicate: {
      buildDefinition: {
        externalParameters: { workflow: { ref: 'refs/heads/main', repository: `https://github.com/${p.repo}`, path: p.workflow } },
        resolvedDependencies: [{ uri: `git+https://github.com/${p.repo}@refs/heads/main`, digest: { gitCommit: p.commit } }],
      },
    },
  };
  return {
    predicateType: 'https://slsa.dev/provenance/v1',
    bundle: { dsseEnvelope: { payloadType: 'application/vnd.in-toto+json', payload: Buffer.from(JSON.stringify(statement)).toString('base64') } },
  };
}

/**
 * An offline npm registry + attestations endpoint + codeload.github.com.
 * `packages` is { name: { version: FakePackage } }; `repos` is { "owner/repo@sha": files }.
 */
export function fakeNet(packages: Record<string, Record<string, FakePackage>>, repos: Record<string, Files> = {}): FakeNet {
  const tarballs = new Map<string, Buffer>();
  const integrities = new Map<string, string>();
  const tarballUrl = (name: string, version: string) => `${REGISTRY}/${name}/-/${name.split('/').pop()}-${version}.tgz`;
  for (const [name, versions] of Object.entries(packages)) {
    for (const [version, p] of Object.entries(versions)) {
      const tgz = makeTgz(p.files);
      integrities.set(`${name}@${version}`, computeIntegrity(tgz));
      tarballs.set(tarballUrl(name, version), tgz);
    }
  }
  const requests: string[] = [];
  const fetch: FetchLike = async (url) => {
    requests.push(url);
    if (tarballs.has(url)) return response(200, tarballs.get(url));
    const code = url.match(/^https:\/\/codeload\.github\.com\/([^/]+)\/([^/]+)\/tar\.gz\/(.+)$/);
    if (code) {
      const files = repos[`${code[1]}/${code[2]}@${decodeURIComponent(code[3]!)}`];
      if (!files) return response(404, {});
      return response(200, makeTgz(files, { prefix: `${code[2]}-${code[3]}/` }));
    }
    const att = url.match(/\/-\/npm\/v1\/attestations\/(.+)@([^@]+)$/);
    if (att) {
      const name = decodeURIComponent(att[1]!);
      const p = packages[name]?.[decodeURIComponent(att[2]!)];
      if (!p?.provenance) return response(404, { error: 'not found' });
      const sri = integrities.get(`${name}@${att[2]}`)!;
      const hex = Buffer.from(sri.replace(/^sha512-/, ''), 'base64').toString('hex');
      return response(200, { attestations: [slsaV1Attestation(p.provenance, hex)] });
    }
    const path = decodeURIComponent(url.slice(REGISTRY.length + 1));
    const m = /^(@[^/]+\/[^/]+|[^/]+)(?:\/([^/]+))?$/.exec(path);
    if (!m) return response(404, {});
    const [, name, version] = m;
    const versions = packages[name!];
    if (!versions) return response(404, {});
    const manifest = (v: string) => ({
      name,
      version: v,
      repository: versions[v]!.repository,
      gitHead: versions[v]!.gitHead,
      dist: { tarball: tarballUrl(name!, v), integrity: integrities.get(`${name}@${v}`) },
    });
    if (version) return versions[version] ? response(200, manifest(version)) : response(404, {});
    const all = Object.keys(versions);
    return response(200, { name, 'dist-tags': { latest: all[all.length - 1] }, versions: Object.fromEntries(all.map((v) => [v, manifest(v)])) });
  };
  return { fetch, requests };
}

/** A temp directory inside test/.tmp (never outside the project). */
export function tempDir(prefix: string): { dir: string; cleanup(): void } {
  const base = join(dirname(fileURLToPath(import.meta.url)), '.tmp');
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, `${prefix}-`));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** An npm v3 lockfile for a flat set of packages. */
export function npmLock(rootDeps: Record<string, string>, entries: Record<string, { version: string; integrity?: string; resolved?: string }>): string {
  const packages: Record<string, unknown> = { '': { name: 'my-app', version: '1.0.0', dependencies: rootDeps } };
  for (const [path, e] of Object.entries(entries)) packages[path] = e;
  return JSON.stringify({ name: 'my-app', version: '1.0.0', lockfileVersion: 3, requires: true, packages }, null, 2) + '\n';
}
