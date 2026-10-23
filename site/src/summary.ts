import type { CapabilityId, Grade, PackageReport } from './types';

/** One row of public/data/index.json. Derived from a PackageReport. */
export interface IndexEntry {
  name: string;
  version: string;
  score: number;
  grade: Grade;
  risk: number;
  capabilities: CapabilityId[];
  installScripts: boolean;
  network: boolean;
  envReads: number;
  provenance: 'present' | 'absent' | 'error';
  source: 'match' | 'partial' | 'mismatch' | 'unknown';
  onlyInPackage: number;
  files: number;
  unpackedSize: number;
  findings: number;
}

export interface IndexFile {
  generatedAt: string;
  /** 'live' = produced by reportPackage; 'mock' = hand-written preview records. */
  source: 'live' | 'mock';
  count: number;
  skipped?: { name: string; reason: string }[];
  packages: IndexEntry[];
}

export function summarize(r: PackageReport): IndexEntry {
  const caps = Array.from(new Set(r.capabilities.map((c) => c.id)));
  return {
    name: r.name,
    version: r.version,
    score: Math.round(r.score),
    grade: r.grade,
    risk: Math.round(r.risk),
    capabilities: caps,
    installScripts: Object.keys(r.installScripts ?? {}).length > 0 || caps.includes('install_script'),
    network: caps.includes('network'),
    envReads: r.envVars?.length ?? 0,
    provenance: r.verify.provenance.status,
    source: r.verify.source.status,
    onlyInPackage: r.verify.source.onlyInPackage?.length ?? 0,
    files: r.files,
    unpackedSize: r.unpackedSize,
    findings: r.findings?.length ?? 0,
  };
}

/** File name for a package's detail JSON. Scoped names keep their scope folder-free. */
export function slug(name: string): string {
  return name.replace('/', '__');
}
