/**
 * Public types for Vouch. The Trust Index site codes against these, so treat
 * every exported shape here as a stable contract: add fields, never rename.
 */

export interface PackageSpec {
  name: string;
  version: string;
}

export type CapabilityId =
  | 'network'
  | 'filesystem'
  | 'child_process'
  | 'env'
  | 'eval'
  | 'install_script'
  | 'native_binary'
  | 'obfuscation'
  | 'global_hook'
  | 'crypto_wallet';

export interface Evidence {
  file: string;
  line: number;
  excerpt: string;
}

export interface Capability {
  id: CapabilityId;
  detail: string;
  evidence: Evidence[];
}

export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
}

export interface PackageAnalysis {
  name: string;
  version: string;
  capabilities: Capability[];
  envVars: string[];
  endpoints: string[];
  installScripts: Record<string, string>;
  files: number;
  unpackedSize: number;
  /** 0-100 risk from capabilities and findings alone (higher is riskier). */
  risk: number;
  findings: Finding[];
}

export interface ProvenanceResult {
  status: 'present' | 'absent' | 'error';
  repo?: string;
  commit?: string;
  workflow?: string;
  note?: string;
}

export interface SourceMatchResult {
  status: 'match' | 'partial' | 'mismatch' | 'unknown';
  repo?: string;
  ref?: string;
  identical: number;
  differs: string[];
  builtOnly: string[];
  onlyInPackage: string[];
  note?: string;
}

export interface VerifyResult {
  provenance: ProvenanceResult;
  source: SourceMatchResult;
}

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface PackageReport extends PackageAnalysis {
  verify: VerifyResult;
  /** 0-100 trust (higher is more trustworthy). */
  score: number;
  grade: Grade;
}

export interface AnalyzeOptions {
  cacheDir?: string;
  /** Injected fetch, for tests and custom transports. Defaults to global fetch. */
  fetch?: typeof fetch;
}

export interface VerifyOptions extends AnalyzeOptions {
  githubToken?: string;
}
