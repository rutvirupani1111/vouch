# Vouch

**Know an npm package is safe before you install it.**

```bash
npx vouchjs report express
```

In September 2025 an attacker phished one maintainer and pushed malicious
versions of `chalk`, `debug` and 16 other packages with over two billion weekly
downloads between them. The payload hooked `fetch`, `XMLHttpRequest` and
`window.ethereum` to swap crypto wallet addresses in the browser. A week later
the **Shai-Hulud** worm went further: a `postinstall` script that stole npm and
GitHub tokens, published them to public repos, wrote GitHub Actions workflows,
and used each stolen npm token to republish *other* packages with itself
inside. Hundreds of packages were infected before anyone noticed.

In both cases the code on npm **did not match the code on GitHub**, and it could
suddenly do things the previous version could not. Nobody was checking either.

Vouch checks both, without ever running the package.

## The three questions

| | Question | How Vouch answers it |
| --- | --- | --- |
| 1 | **What can this package do?** | Static analysis (acorn AST, never executed) of every file in the tarball: network, filesystem, child processes, env reads, eval, install scripts, native binaries, obfuscation, global/loader hooks, crypto-wallet access. Each capability comes with file:line evidence. |
| 2 | **Does it match its source?** | Reads the npm provenance attestation (SLSA, built by CI) for the repo + commit + workflow, falls back to `repository` + `gitHead`, downloads the repo at that exact commit, and compares **every file by SHA-256**: identical, differs, expected build output, or unexplained. |
| 3 | **Do its vulnerabilities reach your code?** | On the roadmap (reachability analysis). Phase 1 answers 1 and 2. |

The answers roll up into a **0-100 trust score** and a letter grade.

## Real output

`vouch report express` (express 5.3.0, published from CI with provenance):

```text
  express@5.3.0  10 files · 74.8 kB
  ████████████████████  99/100  grade A

  What it can do
    ● Network access                         http, net
      lib/application.js:19  var http = require('node:http');
    ● Reads environment variables            NODE_ENV
      lib/application.js:91  var env = process.env.NODE_ENV || 'development';
    ● Evaluates code at runtime              require(expression)
      lib/view.js:81  var fn = require(mod).__express
    ● Filesystem access                      fs
      lib/view.js:18  var fs = require('node:fs');

  Does it match its source?
    ✔ provenance  expressjs/express @ cf6722b via .github/workflows/npm-publish.yml@refs/tags/v5.3.0
      Provenance statement decoded from the npm attestation bundle; the cryptographic Sigstore signature check is planned, not done. The attested subject digest matches the tarball.
    ✔ source      match  expressjs/express @ cf6722b
      10 identical · 0 differ · 0 build output · 0 unexplained
      compared against commit from provenance

  Findings
    low      Network access                       http, net
```

`vouch report chalk` (chalk 6.0.1, published from a laptop, no provenance):

```text
  chalk@6.0.1  12 files · 54.9 kB
  █████████████████░░░  85/100  grade B

  What it can do
    ● Reads environment variables            AGENT_NAME, CI, CI_NAME, COLORTERM, FORCE_COLOR, TEAMCITY_VERSION (+4 more)
      source/vendor/supports-color/index.js:102  if ('TF_BUILD' in env && 'AGENT_NAME' in env) {

  Does it match its source?
    ▲ provenance  absent
      No npm provenance attestation was published for this version.
    ✔ source      match  chalk/chalk @ 47fc05a
      12 identical · 0 differ · 0 build output · 0 unexplained
      compared against commit from gitHead

  Findings
    ✔ none
```

The hijacked `chalk@5.6.1` has since been removed from npm, so it cannot be
reported live. The test suite carries an inert replica of its payload
(`walletHookV2` in `test/fixtures/packages.mjs`): Vouch flags it with
`crypto_wallet` and `global_hook` capabilities the previous version never had,
a critical finding that caps the grade at **F** (and `vouch report` exits 1).
Its payload was not in any commit on GitHub either, which the source match
reports as `mismatch`.

## Guard a project: `init`, `check`, `approve`

```bash
npx vouchjs init      # analyse every package in your lockfile, write vouch.lock.json
git add vouch.lock.json

npx vouchjs check     # in CI: exit 1 if a dependency is new or gained a capability
npx vouchjs approve debug   # after review, accept the new capabilities
```

`vouch.lock.json` is your **approved capability manifest**: for each package the
versions you have seen and the union of what they can do. `vouch check` only
re-analyses versions that changed, and fails when:

- a package appears that was never approved (`new-package`), or
- a new version can do something no approved version could (`new-capability`):
  the exact signature of the chalk/debug hijack (`crypto_wallet`, `global_hook`)
  and of Shai-Hulud (`install_script`, `child_process`, `network`).

Illustrative output, the shape of what a hijack like `debug@4.4.2` produces:

```text
  ✖ 1 unapproved change(s)  214 checked · 213 unchanged

  debug@4.4.2  gained  crypto_wallet, global_hook
    critical Touches crypto wallets Wallet APIs or address patterns ...

  Review, then: vouch approve <package>
```

`--format markdown` renders a PR-comment table; `--format json` is for tooling.
npm, pnpm and yarn (classic and berry) lockfiles are supported.

## `vouch run` (preview)

`vouch check` guards what you install; `vouch run` guards what installed code
does when it runs. It starts Node with a preload (`--require` for CommonJS,
`--import` with `module.register` for ESM, passed through `NODE_OPTIONS`) that
reads `vouch.lock.json` and checks every `require`/`import` of a sensitive
builtin against the approved capabilities of the package asking for it:

| Builtin | Capability |
| --- | --- |
| `net`, `http`, `https`, `http2`, `dns`, `tls`, `dgram` | `network` |
| `child_process`, `worker_threads` | `child_process` |
| `fs` (and `fs/promises`) | `filesystem` |
| `vm` | `eval` |

```bash
vouch run -- node app.js                 # warn: print [vouch warn] once per package and builtin
vouch run --mode block -- node app.js    # block: throw VouchPermissionError (code ERR_VOUCH_PERMISSION)
vouch run --mode block -- npm start      # NODE_OPTIONS reaches child Node processes too
```

The calling package is taken from the importer's path under `node_modules`
(scoped names included); your own code outside `node_modules` is always
allowed, and a package missing from the manifest has no approved capabilities.
`globalThis.fetch` is also wrapped: the caller is found from the stack trace,
best effort, and only ever warned about.

Limits of the preview: it checks module loading, not individual calls, so a
package can still reach a builtin through an object another package hands it;
builtins loaded before the preload, `process.binding`, native addons and
non-Node runtimes are not covered; the fetch check is warn-only. Treat it as a
tripwire, not a sandbox.

## vouch vulns (preview): reachability, first step

`npm audit` tells you a package somewhere in your tree has an advisory. `vouch
vulns` asks the more useful question first: does your own code import it?

```sh
vouch vulns                    # pretty, grouped by reachability
vouch vulns --json             # machine-readable
vouch vulns --fail-on any      # exit 1 on any advisory (default: imported)
```

It reads the lockfile with the same parsers as `init`/`check`, sends every
`name@version` to [OSV](https://osv.dev) in one `querybatch` call, fetches each
advisory's details once (cached by id and `modified` time), and then scans your
own `.js/.ts/.mjs/.cjs/.jsx/.tsx` files (never `node_modules`) with acorn for
`import`, `export ... from`, `require()` and `import()`. Each vulnerable
package lands in one bucket, sorted by bucket then severity:

| Bucket | Meaning |
| --- | --- |
| imported by your code | your source imports it; `file:line` is shown |
| direct dependency, not imported | in `package.json`, but no import was found |
| transitive only | pulled in by another dependency |

Exit codes: `--fail-on imported` (default) exits 1 only when a vulnerable package
is imported by your code, `any` on any advisory, `never` always 0.

This is package-level reachability: an imported package is not proof the
vulnerable function is called, and "not imported" does not cover a dependency
that loads it for you. Function-level call reachability is the next step.

## Trust score

```
score = 100
      - 0.5 x risk                       risk is 0-100 from capability findings
      - provenance:   present 0 | error 5 | absent 15
      - source match: match 0 | partial 10 | unknown 15 | mismatch 35
capped at 39 if any finding is critical; grade A >= 90, B >= 75, C >= 60, D >= 40, else F
```

Risk adds 45 per critical finding, 22 per high, 9 per medium, 3 per low. The
weights live in `SCORE_WEIGHTS` and `RISK_POINTS` and are part of the API.

**Source match statuses.** `match`: every published file is identical to the
repo or an expected build output (`dist/`, `build/`, `lib/`, `esm/`, `cjs/`,
`*.min.js`, `.d.ts`, `.map`, or anything the repo's `.gitignore` or tsconfig
`outDir` declares as output). A build directory the repo actually commits (express
commits `lib/`) is treated as source, so a file slipped into it is caught. A
file an install script runs is never excused as build output. `partial`: only
non-code files differ or are extra. `mismatch`: code that is not in the source,
or code that differs from it, or install scripts that differ from the source
`package.json`. `unknown`: no GitHub repo or commit to compare against.

## Library

```ts
import { analyzePackage, verifyPackage, reportPackage } from 'vouchjs';

const report = await reportPackage({ name: 'express', version: '5.3.0' });
report.score;                  // 99
report.verify.source.status;   // 'match'
report.capabilities;           // [{ id: 'network', detail: 'http, net', evidence: [...] }, ...]
```

All three accept `{ cacheDir, githubToken, fetch }`. Types are in
[`src/types.ts`](src/types.ts). ESM and CommonJS, Node 18+, one dependency (acorn).

## Safety

Vouch never executes, installs or `require`s the packages it inspects. Tarballs
are integrity-checked against the registry and cached by integrity; GitHub
source tarballs are cached by commit. Set `GITHUB_TOKEN` for higher GitHub rate
limits.

## Roadmap

- **Sigstore cryptographic verification**: verify the attestation bundle's
  signature, certificate chain and Rekor inclusion proof, not just decode it.
- **Reachability**: map known advisories to the vulnerable functions and check
  whether your code can actually reach them (question 3).
- **Runtime enforcement**: turn the approved manifest into a Node permission
  policy so a package can only do at runtime what you approved.
- **GitHub App**: `vouch check` on every pull request, with the Markdown report
  as a comment and one-click approve.
- **Trust Index**: a public site scoring the most-installed packages.

See [docs/STATUS.md](docs/STATUS.md) for what is done and what is next.

## License

MIT, Rutvi Rupani
