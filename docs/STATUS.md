# Status

Phase 1, October 2026.

## Done

- **Public API and types** (`src/types.ts`): `analyzePackage`, `verifyPackage`,
  `reportPackage`; the Trust Index site codes against these shapes.
- **Capability analysis** (`src/analyze.ts`, engine in `src/engine/`, ported from
  depdelta): registry fetch with SRI integrity check and on-disk cache, a
  dependency-free tar/gzip reader, acorn AST scanning. Ten public capabilities with
  file:line evidence, env vars, endpoints, install scripts, findings and a 0-100
  risk.
- **Provenance** (`src/verify.ts`): fetches
  `/-/npm/v1/attestations/<name>@<version>`, decodes the DSSE envelope, reads SLSA
  v1 and v0.2 predicates (repo, commit, workflow) and checks the attested subject
  digest against the downloaded tarball. The cryptographic Sigstore check is
  **not** done; every result says so in `note`.
- **Source match**: repo + commit from provenance, else `repository` + `gitHead`,
  else tags `v<version>` / `<version>` / `<name>@<version>`. Downloads
  `codeload.github.com/<owner>/<repo>/tar.gz/<sha>` (honours `GITHUB_TOKEN`,
  caches by commit), finds the package directory in monorepos, compares every
  file by SHA-256 (CRLF tolerant). Classifies identical / differs / builtOnly /
  onlyInPackage; status match / partial / mismatch / unknown.
- **Trust score and grade** (`src/report.ts`, weights in `SCORE_WEIGHTS`).
- **CLI**: `vouch report`, `vouch init`, `vouch check`
  (`--format pretty|json|markdown`, exit 1 on new packages or gained
  capabilities), `vouch approve`. npm, pnpm, yarn classic and berry lockfiles.
- **Tests**: offline (fake registry, attestations endpoint and codeload), inert
  fixtures from depdelta; CI workflow ready in `docs/ci-workflow.yml` (copy to `.github/workflows/`; the push token lacked the `workflow` scope).
- **Live checks** (2026-10-23): `report` on chalk 6.0.1 (85 B), express 5.3.0
  (99 A, provenance), zod 4.6.7 (91 A, monorepo `packages/zod/`, 335 identical +
  505 build outputs), ky, debug, @sindresorhus/is: all source `match`.
  `init` + `check` on Vouch's own 137-package lockfile: passes; took about 3
  minutes cold (dominated by the large esbuild/rollup platform binaries), then
  instant from cache. That run exposed `prepare` false positives, now fixed.

## Known limits

- Build outputs are recognised by path convention, `.gitignore` and tsconfig
  `outDir`, not by rebuilding. A malicious file placed in an ignored build
  directory is reported as `builtOnly`; its capabilities still show up in the
  analysis, and files run by install scripts are never excused.
- Only GitHub repositories are compared.
- `check` diffs capabilities, not provenance/source.

## Next

1. Sigstore verification of the attestation bundle (Fulcio cert chain, Rekor
   inclusion proof, identity matches the repo/workflow).
2. Reachability: advisories mapped to vulnerable symbols, call-graph reachability
   from the project's own code.
3. Runtime enforcement: compile `vouch.lock.json` into a Node permission policy.
4. GitHub App / Action: `vouch check --format markdown` as a PR comment, approve
   from the PR.
5. Source match hardening: run the repo's declared build in a sandbox to explain
   `builtOnly` files byte-for-byte instead of by path convention; GitLab and
   other hosts.
6. `vouch check` should also verify provenance/source for changed versions
   (today it compares capabilities only, which keeps CI fast).
7. Publish `vouchjs` to npm (with provenance).
