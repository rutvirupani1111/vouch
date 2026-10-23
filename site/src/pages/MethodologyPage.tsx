import { CAP_LABEL, GradeBadge } from '../ui';
import type { CapabilityId, Grade } from '../types';

const CAP_DOC: [CapabilityId, string][] = [
  ['network', 'Imports of http, https, net, dgram, tls, or calls to fetch and WebSocket. Hard-coded URLs and IPs are listed as endpoints.'],
  ['filesystem', 'Use of fs and fs/promises, especially writes outside the package directory.'],
  ['child_process', 'spawn, exec, execFile and fork. Common in build tools, rare in runtime libraries.'],
  ['env', 'Reads of process.env. Vouch records which variables are read; enumerating the whole environment is treated as far more serious than reading NODE_ENV.'],
  ['eval', 'eval, new Function, and vm with string input. Dynamic code cannot be reviewed statically.'],
  ['install_script', 'preinstall, install and postinstall hooks in package.json. They run with your user privileges the moment you install, before any of your code runs. Shai-Hulud spread this way.'],
  ['native_binary', 'Shipped or downloaded executables and .node addons. Their behaviour is opaque to source analysis.'],
  ['obfuscation', 'Long encoded blobs, hex or base64 strings fed to eval, and minified code that has no readable source in the repository.'],
  ['global_hook', 'Patching of globals and prototypes such as fetch, XMLHttpRequest or window.ethereum. The 2025 chalk and debug payload worked this way.'],
  ['crypto_wallet', 'References to wallet providers, address formats and transaction-signing APIs.'],
];

const BANDS: [Grade, string, string][] = [
  ['A', '90 to 100', 'Few powers and strong evidence: provenance present and source matches.'],
  ['B', '75 to 89', 'Trustworthy with a gap, usually missing provenance or some build output.'],
  ['C', '60 to 74', 'Real powers or weak verification. Read the report before adopting.'],
  ['D', '40 to 59', 'Significant powers with little evidence of where the code came from.'],
  ['F', '0 to 39', 'A critical finding, or a package that does not match its source.'],
];

export function MethodologyPage() {
  return (
    <article className="mx-auto max-w-3xl pt-10">
      <p className="label">Methodology</p>
      <h1 className="mt-3 font-display text-4xl font-bold tracking-tight sm:text-5xl">How a package is scored</h1>
      <div className="prose-lab mt-6">
        <p>
          Vouch downloads the exact tarball npm would install, never the repository, and works from those bytes. Every package in the index gets three answers and a score. Nothing is executed: all analysis is static.
        </p>

        <h2>1. What can it do?</h2>
        <p>
          Each JavaScript file is parsed into a syntax tree and walked for the capabilities below. Every detection keeps its evidence: the file, the line, and an excerpt, so you can check the claim yourself. The capabilities and findings roll up into a risk number from 0 to 100.
        </p>
        <dl className="not-prose mb-6 divide-y divide-line border border-line bg-panel">
          {CAP_DOC.map(([id, text]) => (
            <div key={id} className="grid gap-1 px-4 py-3 sm:grid-cols-[10rem_1fr] sm:gap-4">
              <dt className="mono text-[13px] font-semibold text-ink">{CAP_LABEL[id]}</dt>
              <dd className="text-[14px] leading-relaxed text-ink-2">{text}</dd>
            </div>
          ))}
        </dl>

        <h2>2. Does it match its source?</h2>
        <h3>Provenance</h3>
        <p>
          npm provenance is a Sigstore-signed statement, published with the package, saying which repository, commit and CI workflow built it. Vouch fetches the attestation and checks that it covers this exact tarball. Present means the build is tied to a public commit; absent means you are trusting the publisher's laptop.
        </p>
        <h3>File-by-file source match</h3>
        <p>
          Vouch resolves the repository and the commit or tag for the version, fetches the tree, and compares every published file against it. Each file lands in one bucket:
        </p>
        <ul>
          <li><code>identical</code>: byte-for-byte the same as the repository after line-ending normalisation.</li>
          <li><code>builtOnly</code>: not in the repository, but explained as build output, for example <code>dist/</code> produced from sources that are.</li>
          <li><code>differs</code>: the path exists in the repository but the content is different.</li>
          <li><code>onlyInPackage</code>: in the tarball, nowhere in the repository, and not explained as build output. This is the strongest signal of a tampered release, and the site always calls it out.</li>
        </ul>

        <h2>3. The trust score</h2>
        <p>The score starts at 100 and subtracts three things:</p>
        <div className="not-prose my-4 border border-line bg-bg-2 p-4">
          <pre className="mono overflow-x-auto text-[13px] leading-relaxed text-ink">{`score = 100
      - 0.5 x risk                      (capabilities + findings, 0-100)
      - provenance   present 0 | error 5 | absent 15
      - source       match 0 | partial 10 | unknown 15 | mismatch 35
capped at 39 if any finding is critical, clamped to 0-100`}</pre>
        </div>
        <p>The grade is a fixed band over the score:</p>
        <ul className="not-prose mb-6 flex flex-col gap-2">
          {BANDS.map(([g, range, text]) => (
            <li key={g} className="flex items-center gap-3 border border-line bg-panel px-3 py-2.5">
              <GradeBadge grade={g} />
              <span className="mono tabular w-20 shrink-0 text-[12px] text-ink-3">{range}</span>
              <span className="text-[14px] text-ink-2">{text}</span>
            </li>
          ))}
        </ul>

        <h2>Honest limits</h2>
        <ul>
          <li>Static analysis sees what the code says, not what it does. Strings assembled at runtime, network calls through a dependency, and well-hidden payloads can slip past it. A clean report is evidence, not proof.</li>
          <li>Each package is scored on its own files. Its dependencies are scored separately, and a package is only as safe as its tree.</li>
          <li>Source match depends on finding the right commit. Monorepos, unpublished build steps and missing tags push packages into <code>partial</code> or <code>unknown</code>, which lowers scores for honest packages too.</li>
          <li>Powers are not malice. A bundler that spawns processes and a test runner that reads the filesystem are doing their job. Read the grade alongside what the package is for.</li>
          <li>Scores are a snapshot of the latest version at scan time. A new release can change everything, which is why <code>vouch check</code> belongs in CI.</li>
          <li>If you think a score is wrong, open an issue with the package and version. The raw JSON for every package is published so you can check the evidence.</li>
        </ul>
      </div>
    </article>
  );
}
