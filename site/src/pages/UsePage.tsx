import { CodeBlock } from '../ui';

const WORKFLOW = `name: vouch
on: [pull_request]
jobs:
  vouch:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npx vouchjs check`;

export function UsePage() {
  return (
    <article className="mx-auto max-w-3xl pt-10">
      <p className="label">Use Vouch</p>
      <h1 className="mt-3 font-display text-4xl font-bold tracking-tight sm:text-5xl">Run it on your own packages</h1>
      <p className="mt-5 text-[1.05rem] leading-relaxed text-ink-2">
        The index covers popular packages. The CLI scores anything on npm, and in CI it fails the build when a dependency gains a power or stops matching its source.
      </p>

      <section className="mt-10" aria-labelledby="u1">
        <h2 id="u1" className="font-display text-xl font-bold"><span className="mono mr-2 text-accent">01</span>Report on one package</h2>
        <p className="mt-2 text-ink-2">No install needed. Pass a name, optionally with a version.</p>
        <div className="mt-4 flex flex-col gap-3">
          <CodeBlock>{`npx vouchjs report express\nnpx vouchjs report chalk@5.4.1`}</CodeBlock>
          <CodeBlock label="example output, abridged">{`chalk@5.4.1   grade A   trust 97
  can do       env (FORCE_COLOR, TERM, CI ...)
  provenance   attested, github.com/chalk/chalk
  source       match, 11 identical, 0 only in package`}</CodeBlock>
        </div>
      </section>

      <section className="mt-10" aria-labelledby="u2">
        <h2 id="u2" className="font-display text-xl font-bold"><span className="mono mr-2 text-accent">02</span>Baseline your project</h2>
        <p className="mt-2 text-ink-2">
          <code className="mono border border-line bg-panel-2 px-1">vouch init</code> scores every package in your lockfile and writes the result as a baseline file you commit. It records what each dependency is allowed to do today.
        </p>
        <div className="mt-4">
          <CodeBlock>{`npm i -D vouchjs\nnpx vouch init`}</CodeBlock>
        </div>
      </section>

      <section className="mt-10" aria-labelledby="u3">
        <h2 id="u3" className="font-display text-xl font-bold"><span className="mono mr-2 text-accent">03</span>Check in CI</h2>
        <p className="mt-2 text-ink-2">
          <code className="mono border border-line bg-panel-2 px-1">vouch check</code> re-scores the lockfile against the baseline and exits non-zero when a dependency gains a capability, adds an install script, loses provenance, or ships files that are not in its repository. That is the moment a hijacked release would show up.
        </p>
        <div className="mt-4 flex flex-col gap-3">
          <CodeBlock>{`npx vouch check`}</CodeBlock>
          <CodeBlock label=".github/workflows/vouch.yml">{WORKFLOW}</CodeBlock>
        </div>
      </section>

      <section className="mt-10 border border-line bg-panel p-5" aria-labelledby="u4">
        <h2 id="u4" className="font-display text-lg font-bold">As a library</h2>
        <p className="mt-2 text-sm text-ink-2">The same engine powers this site. Every report has the shape published in the raw JSON.</p>
        <div className="mt-4">
          <CodeBlock label="ts">{`import { reportPackage } from 'vouchjs';

const r = await reportPackage({ name: 'debug', version: '4.4.0' });
console.log(r.grade, r.score, r.verify.source.onlyInPackage);`}</CodeBlock>
        </div>
      </section>
    </article>
  );
}
