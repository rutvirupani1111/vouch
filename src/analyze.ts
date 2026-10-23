/**
 * Capability analysis: maps the static-analysis engine (ported from depdelta)
 * onto Vouch's public `PackageAnalysis` shape, and derives findings + risk.
 * Nothing from the analysed package is ever executed.
 */
import { analyzeFiles } from './engine/analysis/analyze.js';
import { analyzePackage as engineAnalyze, createContext } from './engine/load.js';
import { extractPackage } from './engine/fetch/tar.js';
import type { Capabilities, CapabilityKey, PackageAnalysis as EnginePackageAnalysis } from './engine/types.js';
import type { AnalyzeOptions, Capability, CapabilityId, Evidence, Finding, PackageAnalysis, PackageSpec, Severity } from './types.js';

/** Which engine capability keys roll up into each public capability id. */
export const CAPABILITY_MAP: Record<CapabilityId, CapabilityKey[]> = {
  network: ['network', 'suspicious-endpoint'],
  filesystem: ['fs', 'credential-files'],
  child_process: ['child_process', 'shell-download', 'worker_threads'],
  env: ['env', 'env-secrets', 'env-dump'],
  eval: ['eval', 'vm', 'dynamic-require'],
  install_script: ['install-script'],
  native_binary: ['native-binary'],
  obfuscation: ['obfuscation', 'encoded-blob'],
  global_hook: ['global-patch', 'prototype-patch', 'loader-hook', 'module', 'process.binding'],
  crypto_wallet: ['crypto-wallet'],
};

export const CAPABILITY_ORDER: CapabilityId[] = [
  'install_script',
  'crypto_wallet',
  'obfuscation',
  'child_process',
  'network',
  'env',
  'eval',
  'global_hook',
  'native_binary',
  'filesystem',
];

export const CAPABILITY_LABEL: Record<CapabilityId, string> = {
  network: 'Network access',
  filesystem: 'Filesystem access',
  child_process: 'Runs other programs',
  env: 'Reads environment variables',
  eval: 'Evaluates code at runtime',
  install_script: 'Runs code on install',
  native_binary: 'Ships native binaries',
  obfuscation: 'Obfuscated or encoded code',
  global_hook: 'Patches globals or the module loader',
  crypto_wallet: 'Touches crypto wallets',
};

const MAX_EVIDENCE = 5;
const MAX_VALUES = 6;

/** Risk points per finding severity; the sum is capped at 100. */
export const RISK_POINTS: Record<Severity, number> = { critical: 45, high: 22, medium: 9, low: 3, info: 0 };

function list(values: string[]): string {
  const shown = values.slice(0, MAX_VALUES);
  const more = values.length - shown.length;
  return shown.join(', ') + (more > 0 ? ` (+${more} more)` : '');
}

function values(caps: Capabilities, keys: CapabilityKey[]): string[] {
  const out = new Set<string>();
  for (const k of keys) for (const v of caps[k]?.values ?? []) out.add(v);
  return [...out].sort();
}

function installTime(caps: Capabilities, keys: CapabilityKey[]): boolean {
  return keys.some((k) => caps[k]?.installTime);
}

/** Converts the engine's analysis to the public shape. Pure: used by tests directly. */
export function toPublicAnalysis(a: EnginePackageAnalysis): PackageAnalysis {
  const caps = a.capabilities;
  const capabilities: Capability[] = [];
  for (const id of CAPABILITY_ORDER) {
    const keys = CAPABILITY_MAP[id].filter((k) => caps[k]);
    if (keys.length === 0) continue;
    const evidence: Evidence[] = [];
    const seen = new Set<string>();
    for (const k of keys) {
      for (const e of caps[k]!.evidence) {
        const sig = `${e.file}:${e.line}`;
        if (seen.has(sig) || evidence.length >= MAX_EVIDENCE) continue;
        seen.add(sig);
        evidence.push({ file: e.file, line: e.line, excerpt: e.excerpt });
      }
    }
    const vals = values(caps, keys);
    const when = installTime(caps, keys) ? ' (reachable at install time)' : '';
    capabilities.push({ id, detail: (vals.length ? list(vals) : CAPABILITY_LABEL[id]) + when, evidence });
  }

  const installScripts: Record<string, string> = {};
  for (const s of a.installScripts) installScripts[s.event] = s.command;

  const envVars = values(caps, ['env', 'env-secrets']);
  const endpoints = values(caps, ['endpoint', 'suspicious-endpoint']);
  const findings = deriveFindings(a, installScripts);
  const risk = Math.min(100, findings.reduce((n, f) => n + RISK_POINTS[f.severity], 0));

  return {
    name: a.name,
    version: a.version,
    capabilities,
    envVars,
    endpoints,
    installScripts,
    files: a.stats.files,
    unpackedSize: a.stats.bytes,
    risk,
    findings,
  };
}

function deriveFindings(a: EnginePackageAnalysis, installScripts: Record<string, string>): Finding[] {
  const caps = a.capabilities;
  const out: Finding[] = [];
  const add = (id: string, severity: Severity, title: string, detail: string) => out.push({ id, severity, title, detail });
  const has = (k: CapabilityKey) => Boolean(caps[k]);
  const v = (k: CapabilityKey) => list(caps[k]?.values ?? []);

  const events = Object.keys(installScripts);
  if (events.length) {
    const dangerous = (['network', 'child_process', 'shell-download', 'env-secrets', 'obfuscation'] as CapabilityKey[]).filter(
      (k) => caps[k]?.installTime,
    );
    if (dangerous.length) {
      add(
        'install-script-dangerous',
        'critical',
        'Install script does dangerous things',
        `${events.join(', ')} runs on \`npm install\` and reaches: ${dangerous.join(', ')}.`,
      );
    } else {
      add('install-script', 'medium', 'Runs code on install', `${events.map((e) => `${e}: ${installScripts[e]}`).join('; ')}`);
    }
  }
  if (has('npm-publish')) add('npm-publish', 'critical', 'Can publish npm packages', `Worm-like self-propagation signal (Shai-Hulud pattern): ${v('npm-publish')}.`);
  if (has('ci-tamper')) add('ci-tamper', 'critical', 'Writes CI configuration', `Touches CI workflow files: ${v('ci-tamper')}.`);
  if (has('crypto-wallet')) add('crypto-wallet', 'critical', 'Touches crypto wallets', `Wallet APIs or address patterns (the 2025 chalk/debug hijack pattern): ${v('crypto-wallet')}.`);
  if (has('shell-download')) add('shell-download', 'critical', 'Downloads and runs a shell payload', v('shell-download'));
  if (has('suspicious-endpoint')) add('suspicious-endpoint', 'high', 'Talks to a suspicious endpoint', v('suspicious-endpoint'));
  if (has('credential-files')) add('credential-files', 'high', 'Reads credential files', v('credential-files'));
  if (has('env-dump')) add('env-dump', 'high', 'Reads the whole environment', 'Enumerates process.env instead of named variables.');
  if (has('obfuscation')) add('obfuscation', 'high', 'Obfuscated code', v('obfuscation'));
  if (has('loader-hook')) add('loader-hook', 'high', 'Hooks the module loader', v('loader-hook'));
  if (has('env-secrets')) add('env-secrets', 'medium', 'Reads secret-looking environment variables', v('env-secrets'));
  if (has('encoded-blob')) add('encoded-blob', 'medium', 'Large encoded blob', v('encoded-blob'));
  if (has('global-patch') || has('prototype-patch')) {
    add('global-patch', 'medium', 'Patches globals', list([...(caps['global-patch']?.values ?? []), ...(caps['prototype-patch']?.values ?? [])]));
  }
  if (has('native-binary')) add('native-binary', 'medium', 'Ships native binaries', v('native-binary'));
  if (has('eval') || has('vm')) add('eval', 'medium', 'Evaluates code at runtime', list([...(caps.eval?.values ?? []), ...(caps.vm?.values ?? [])]));
  if (has('child_process')) add('child-process', 'low', 'Runs other programs', v('child_process'));
  if (has('network')) add('network', 'low', 'Network access', v('network'));
  if (has('minified')) add('minified', 'info', 'Minified code', `${a.stats.minifiedFiles} minified file(s); harder to review.`);
  return out;
}

/** Downloads (or reads from cache) a package tarball, verifying its registry integrity. */
export async function fetchPackageFiles(
  spec: PackageSpec,
  opts: AnalyzeOptions = {},
): Promise<{ files: Map<string, Buffer>; version: string; integrity: string; verified: boolean }> {
  const ctx = createContext({ cacheDir: opts.cacheDir, fetch: opts.fetch, registry: opts.registry });
  const version = await ctx.client.resolveVersion(spec.name, spec.version || 'latest');
  const manifest = await ctx.client.getVersionManifest(spec.name, version);
  const tarball = await ctx.client.fetchTarball(manifest.dist.tarball, manifest.dist.integrity);
  return { files: extractPackage(tarball.data), version, integrity: tarball.integrity, verified: tarball.verified };
}

/** Analyses an in-memory file map (tests, local tarballs). */
export function analyzeFileMap(files: Map<string, Buffer>, spec?: Partial<PackageSpec>): PackageAnalysis {
  const a = analyzeFiles(files, { name: spec?.name, version: spec?.version, source: { kind: 'memory', verified: false } });
  if (spec?.name) a.name = spec.name;
  if (spec?.version) a.version = spec.version;
  return toPublicAnalysis(a);
}

export async function analyzePackage(spec: PackageSpec, opts: AnalyzeOptions = {}): Promise<PackageAnalysis> {
  const { files, version } = await fetchPackageFiles(spec, opts);
  return analyzeFileMap(files, { name: spec.name, version });
}

/** Analyses a lockfile entry; uses the lockfile integrity so the result is cached by it. */
export async function analyzeLocked(
  pkg: { name: string; version: string; integrity?: string; resolved?: string },
  opts: AnalyzeOptions = {},
): Promise<PackageAnalysis> {
  const a = await engineAnalyze(
    { name: pkg.name, version: pkg.version, integrity: pkg.integrity, tarballUrl: pkg.resolved },
    { cacheDir: opts.cacheDir, fetch: opts.fetch, registry: opts.registry },
  );
  return toPublicAnalysis(a);
}
