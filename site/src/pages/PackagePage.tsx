import { loadPackage, pkgJsonUrl, useAsync } from '../data';
import type { Capability, Severity } from '../types';
import { CAP_LABEL, CodeBlock, GradeBadge, HOT_CAPS, Link, Panel, Pill, ProvenancePill, SourcePill, formatBytes, gradeColor, gradeWord } from '../ui';

const SEV_TONE: Record<Severity, 'ok' | 'warn' | 'bad' | 'muted'> = { info: 'muted', low: 'muted', medium: 'warn', high: 'bad', critical: 'bad' };

function Evidence({ cap }: { cap: Capability }) {
  const hot = HOT_CAPS.includes(cap.id);
  return (
    <li className="border-b border-line py-4 first:pt-0 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={hot ? 'bad' : 'warn'}>{CAP_LABEL[cap.id] ?? cap.id}</Pill>
        <span className="text-sm text-ink-2">{cap.detail}</span>
      </div>
      {cap.evidence.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {cap.evidence.slice(0, 4).map((e, i) => (
            <li key={i} className="border-l-2 border-line-2 bg-bg-2">
              <div className="mono px-3 pt-2 text-[11px] text-ink-3">
                {e.file}
                <span className="text-ink-3">:{e.line}</span>
              </div>
              <pre className="mono overflow-x-auto px-3 pb-2 pt-1 text-[12.5px] leading-relaxed text-ink">
                <code>{e.excerpt}</code>
              </pre>
            </li>
          ))}
          {cap.evidence.length > 4 && <li className="mono text-[11px] text-ink-3">+{cap.evidence.length - 4} more locations in the raw JSON</li>}
        </ul>
      )}
    </li>
  );
}

function FileList({ files, tone, empty }: { files: string[]; tone: 'bad' | 'warn' | 'muted'; empty: string }) {
  if (!files.length) return <p className="mono text-[12px] text-ink-3">{empty}</p>;
  const color = tone === 'bad' ? 'text-danger' : tone === 'warn' ? 'text-warn' : 'text-ink-2';
  return (
    <ul className="mono flex max-h-64 flex-col gap-1 overflow-y-auto text-[12.5px]">
      {files.slice(0, 200).map((f) => (
        <li key={f} className={`break-all ${color}`}>
          {f}
        </li>
      ))}
      {files.length > 200 && <li className="text-ink-3">+{files.length - 200} more</li>}
    </ul>
  );
}

function short(sha?: string) {
  return sha ? sha.slice(0, 12) : undefined;
}

function repoUrl(repo?: string) {
  if (!repo) return undefined;
  const r = repo.replace(/^git\+/, '').replace(/\.git$/, '');
  if (/^https?:\/\//.test(r)) return r;
  if (/^[\w.-]+\.[a-z]{2,}\//i.test(r)) return `https://${r}`;
  return `https://github.com/${r}`;
}

export function PackagePage({ name }: { name: string }) {
  const { data, loading } = useAsync(() => loadPackage(name), [name]);

  if (loading) return <p className="mono py-20 text-center text-[13px] text-ink-3">Loading report for {name}...</p>;
  if (!data)
    return (
      <div className="py-20 text-center">
        <p className="font-display text-2xl font-bold">{name} is not in the index yet.</p>
        <p className="mt-3 text-ink-2">You can still score it locally:</p>
        <div className="mx-auto mt-4 max-w-md text-left">
          <CodeBlock>{`npx vouchjs report ${name}`}</CodeBlock>
        </div>
        <Link to="/" className="mono mt-6 inline-block text-[13px] uppercase tracking-wider text-accent">Back to the index</Link>
      </div>
    );

  const r = data.report;
  const { provenance: prov, source: src } = r.verify;
  const compared = src.identical + src.differs.length + src.builtOnly.length + src.onlyInPackage.length;
  const pct = (n: number) => (compared ? (n / compared) * 100 : 0);
  const scripts = Object.entries(r.installScripts ?? {});
  const repo = repoUrl(prov.repo ?? src.repo);

  return (
    <article className="pt-8">
      <nav aria-label="Breadcrumb" className="mono text-[12px] text-ink-3">
        <Link to="/" className="hover:text-ink">Index</Link> <span aria-hidden>/</span> <span className="text-ink-2">{r.name}</span>
      </nav>

      {data.mock && (
        <p role="status" className="mono mt-4 border border-warn/50 bg-warn/10 px-3 py-2 text-[12px] text-warn">
          Preview record: hand-written sample data, not a measurement.
        </p>
      )}

      {/* Header */}
      <header className="mt-5 grid gap-6 border border-line bg-panel p-5 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:p-6">
        <GradeBadge grade={r.grade} size="lg" />
        <div className="min-w-0">
          <h1 className="mono break-all text-3xl font-semibold tracking-tight sm:text-4xl">{r.name}</h1>
          <p className="mono mt-1 text-[13px] text-ink-3">
            v{r.version} · {r.files} files · {formatBytes(r.unpackedSize)} unpacked
          </p>
          <p className="mt-3 text-[15px] font-medium" style={{ color: gradeColor(r.grade) }}>{gradeWord(r.grade)}</p>
        </div>
        <dl className="grid grid-cols-2 gap-px bg-line text-center sm:w-56">
          <div className="bg-panel-2 px-3 py-3">
            <dt className="label">Trust</dt>
            <dd className="mono tabular mt-1 text-3xl font-semibold">{Math.round(r.score)}</dd>
          </div>
          <div className="bg-panel-2 px-3 py-3">
            <dt className="label">Risk</dt>
            <dd className="mono tabular mt-1 text-3xl font-semibold text-ink-2">{Math.round(r.risk)}</dd>
          </div>
        </dl>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="flex min-w-0 flex-col gap-6">
          {/* Capabilities */}
          <Panel title="What it can do" kicker={`${r.capabilities.length} capabilit${r.capabilities.length === 1 ? 'y' : 'ies'}`}>
            {r.capabilities.length ? (
              <ul>
                {r.capabilities.map((c, i) => (
                  <Evidence key={`${c.id}-${i}`} cap={c} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-2">No sensitive capabilities detected. The code does not touch the network, filesystem, child processes, environment or dynamic evaluation as far as static analysis can see.</p>
            )}
          </Panel>

          {/* Source match */}
          <Panel title="Does it match its source?" kicker={src.ref ? `${src.repo ?? ''} @ ${/^[0-9a-f]{40}$/.test(src.ref) ? src.ref.slice(0, 10) : src.ref}` : src.repo}>
            <div className="flex flex-wrap items-center gap-3">
              <SourcePill status={src.status} only={src.onlyInPackage.length} />
              <span className="text-sm text-ink-2">{src.note ?? (compared ? `${compared} published files compared with the repository.` : 'No file comparison was possible.')}</span>
            </div>

            {compared > 0 && (
              <>
                <div className="mt-4 flex h-3 w-full overflow-hidden bg-line" role="img" aria-label={`${src.identical} identical, ${src.builtOnly.length} build output, ${src.differs.length} differ, ${src.onlyInPackage.length} only in package`}>
                  <span style={{ width: `${pct(src.identical)}%`, background: 'var(--g-a)' }} />
                  <span style={{ width: `${pct(src.builtOnly.length)}%`, background: 'var(--g-b)' }} />
                  <span style={{ width: `${pct(src.differs.length)}%`, background: 'var(--warn)' }} />
                  <span style={{ width: `${pct(src.onlyInPackage.length)}%`, background: 'var(--danger)' }} />
                </div>
                <dl className="mono mt-3 grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-4">
                  {[
                    ['Identical', src.identical, 'var(--g-a)'],
                    ['Build output', src.builtOnly.length, 'var(--g-b)'],
                    ['Differs', src.differs.length, 'var(--warn)'],
                    ['Only in package', src.onlyInPackage.length, 'var(--danger)'],
                  ].map(([k, v, c]) => (
                    <div key={k as string} className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5" style={{ background: c as string }} aria-hidden />
                      <dt className="text-ink-3">{k}</dt>
                      <dd className="tabular ml-auto text-ink">{v}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}

            <div className={`mt-5 border p-4 ${src.onlyInPackage.length ? 'border-danger/60 bg-danger/10' : 'border-line bg-bg-2'}`}>
              <h3 className="flex items-center gap-2 font-display text-[15px] font-bold">
                <span className={src.onlyInPackage.length ? 'text-danger' : 'text-ink-3'} aria-hidden>■</span>
                Only in package
                <span className="mono tabular ml-auto text-[12px] font-normal text-ink-3">{src.onlyInPackage.length}</span>
              </h3>
              <p className="mb-3 mt-1 text-[13px] text-ink-2">Files in the published tarball that exist nowhere in the repository and are not explained as build output. This is where hijacked releases hide.</p>
              <FileList files={src.onlyInPackage} tone="bad" empty="None. Every published file traces back to the repository." />
            </div>

            {(src.differs.length > 0 || src.builtOnly.length > 0) && (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="label mb-2">Differs from source ({src.differs.length})</p>
                  <FileList files={src.differs} tone="warn" empty="None." />
                </div>
                <div>
                  <p className="label mb-2">Build output ({src.builtOnly.length})</p>
                  <FileList files={src.builtOnly} tone="muted" empty="None." />
                </div>
              </div>
            )}
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          {/* Provenance */}
          <Panel title="Provenance" kicker="npm attestation">
            <div className="flex items-center gap-2">
              <ProvenancePill status={prov.status} />
              <span className="text-sm text-ink-2">{prov.status === 'present' ? 'npm publishes a provenance statement naming the CI build. Vouch decodes it; the Sigstore signature check is not done yet.' : prov.note ?? 'No attestation published.'}</span>
            </div>
            <dl className="mono mt-4 flex flex-col gap-3 text-[12.5px]">
              <div>
                <dt className="label">Repository</dt>
                <dd className="mt-0.5 break-all">{repo ? <a href={repo} className="text-accent hover:underline">{prov.repo ?? src.repo}</a> : <span className="text-ink-3">Not declared</span>}</dd>
              </div>
              <div>
                <dt className="label">Commit</dt>
                <dd className="mt-0.5 break-all">
                  {prov.commit ? repo ? <a href={`${repo}/commit/${prov.commit}`} className="text-accent hover:underline">{short(prov.commit)}</a> : short(prov.commit) : <span className="text-ink-3">Unknown</span>}
                </dd>
              </div>
              <div>
                <dt className="label">Workflow</dt>
                <dd className="mt-0.5 break-all">{prov.workflow ?? <span className="text-ink-3">Unknown</span>}</dd>
              </div>
            </dl>
          </Panel>

          {/* Findings */}
          <Panel title="Findings" kicker={`${r.findings.length}`}>
            {r.findings.length ? (
              <ul className="flex flex-col gap-3">
                {r.findings.map((f) => (
                  <li key={f.id} className="border-l-2 pl-3" style={{ borderColor: SEV_TONE[f.severity] === 'bad' ? 'var(--danger)' : SEV_TONE[f.severity] === 'warn' ? 'var(--warn)' : 'var(--line-2)' }}>
                    <Pill tone={SEV_TONE[f.severity]}>{f.severity}</Pill>
                    <p className="mt-1.5 text-[14px] font-medium">{f.title}</p>
                    <p className="mt-0.5 text-[13px] text-ink-2">{f.detail}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-2">No findings.</p>
            )}
          </Panel>

          {/* Install scripts / env / endpoints */}
          <Panel title="Surface" kicker="install, env, hosts">
            <p className="label mb-2">Install scripts</p>
            {scripts.length ? (
              <ul className="mono mb-4 flex flex-col gap-1 text-[12.5px]">
                {scripts.map(([k, v]) => (
                  <li key={k} className="break-all">
                    <span className="text-warn">{k}</span> <span className="text-ink-2">{v}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mono mb-4 text-[12px] text-ink-3">None. Nothing runs on install.</p>
            )}
            <p className="label mb-2">Environment variables read ({r.envVars.length})</p>
            {r.envVars.length ? (
              <div className="mb-4 flex flex-wrap gap-1.5">
                {r.envVars.slice(0, 60).map((v) => (
                  <span key={v} className="mono border border-line-2 px-1.5 py-0.5 text-[11.5px] text-ink-2">{v}</span>
                ))}
              </div>
            ) : (
              <p className="mono mb-4 text-[12px] text-ink-3">None.</p>
            )}
            <p className="label mb-2">Hard-coded endpoints ({r.endpoints.length})</p>
            {r.endpoints.length ? (
              <ul className="mono flex flex-col gap-1 text-[12px]">
                {r.endpoints.slice(0, 40).map((e) => (
                  <li key={e} className="break-all text-ink-2">{e}</li>
                ))}
              </ul>
            ) : (
              <p className="mono text-[12px] text-ink-3">None.</p>
            )}
          </Panel>

          <Panel title="Reproduce" kicker="raw data">
            <CodeBlock>{`npx vouchjs report ${r.name}@${r.version}`}</CodeBlock>
            {!data.mock && (
              <a href={pkgJsonUrl(r.name)} className="mono mt-3 inline-block text-[12px] uppercase tracking-wider text-accent hover:underline">
                Raw report JSON
              </a>
            )}
          </Panel>
        </div>
      </div>
    </article>
  );
}
