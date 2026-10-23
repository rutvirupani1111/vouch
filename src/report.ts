/**
 * Trust score: one 0-100 number (higher is more trustworthy) and a letter grade.
 *
 *   score = 100
 *         - CAPABILITY_WEIGHT x risk          (risk is 0-100 from the capability findings)
 *         - provenance penalty                (present 0, error 5, absent 15)
 *         - source-match penalty              (match 0, partial 10, unknown 15, mismatch 35)
 *   then capped at 39 when any critical finding exists, clamped to 0-100.
 *
 *   grade: A >= 90, B >= 75, C >= 60, D >= 40, F below.
 */
import { analyzeFileMap, fetchPackageFiles } from './analyze.js';
import { verifyFiles } from './verify.js';
import type { Grade, PackageAnalysis, PackageReport, PackageSpec, VerifyOptions, VerifyResult } from './types.js';

export const SCORE_WEIGHTS = {
  capability: 0.5,
  provenance: { present: 0, error: 5, absent: 15 },
  source: { match: 0, partial: 10, unknown: 15, mismatch: 35 },
  criticalCap: 39,
  grades: { A: 90, B: 75, C: 60, D: 40 },
} as const;

export function gradeFor(score: number): Grade {
  const g = SCORE_WEIGHTS.grades;
  return score >= g.A ? 'A' : score >= g.B ? 'B' : score >= g.C ? 'C' : score >= g.D ? 'D' : 'F';
}

export function scoreReport(analysis: PackageAnalysis, verify: VerifyResult): { score: number; grade: Grade } {
  let score =
    100 -
    SCORE_WEIGHTS.capability * analysis.risk -
    SCORE_WEIGHTS.provenance[verify.provenance.status] -
    SCORE_WEIGHTS.source[verify.source.status];
  if (analysis.findings.some((f) => f.severity === 'critical')) score = Math.min(score, SCORE_WEIGHTS.criticalCap);
  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, grade: gradeFor(score) };
}

export function buildReport(analysis: PackageAnalysis, verify: VerifyResult): PackageReport {
  return { ...analysis, verify, ...scoreReport(analysis, verify) };
}

export async function reportPackage(spec: PackageSpec, opts: VerifyOptions = {}): Promise<PackageReport> {
  const { files, version, integrity } = await fetchPackageFiles(spec, opts);
  const resolved = { name: spec.name, version };
  const analysis = analyzeFileMap(files, resolved);
  const verify = await verifyFiles(resolved, files, { ...opts, integrity });
  return buildReport(analysis, verify);
}
