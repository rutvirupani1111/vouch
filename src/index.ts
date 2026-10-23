import type {
  AnalyzeOptions,
  PackageAnalysis,
  PackageReport,
  PackageSpec,
  VerifyOptions,
  VerifyResult,
} from './types.js';

export * from './types.js';

export async function analyzePackage(spec: PackageSpec, _opts: AnalyzeOptions = {}): Promise<PackageAnalysis> {
  throw new Error(`analyzePackage(${spec.name}@${spec.version}) is not implemented yet`);
}

export async function verifyPackage(spec: PackageSpec, _opts: VerifyOptions = {}): Promise<VerifyResult> {
  throw new Error(`verifyPackage(${spec.name}@${spec.version}) is not implemented yet`);
}

export async function reportPackage(spec: PackageSpec, _opts: VerifyOptions = {}): Promise<PackageReport> {
  throw new Error(`reportPackage(${spec.name}@${spec.version}) is not implemented yet`);
}
