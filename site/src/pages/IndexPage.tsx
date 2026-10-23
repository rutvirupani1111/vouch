import { useMemo, useState } from 'react';
import { loadIndex, useAsync } from '../data';
import type { IndexEntry } from '../summary';
import type { Grade } from '../types';
import { GradeBadge, Link, Pill, ProvenancePill, ScoreBar, SourcePill, gradeColor } from '../ui';

type SortKey = 'name' | 'score' | 'installScripts' | 'network' | 'envReads' | 'provenance' | 'source';
const GRADES: Grade[] = ['A', 'B', 'C', 'D', 'F'];
const SOURCE_RANK = { match: 0, partial: 1, unknown: 2, mismatch: 3 } as const;
const PROV_RANK = { present: 0, error: 1, absent: 2 } as const;

const COLS: { key: SortKey; label: string; className?: string }[] = [
  { key: 'name', label: 'Package' },
  { key: 'score', label: 'Grade / score' },
  { key: 'installScripts', label: 'Install scripts' },
  { key: 'network', label: 'Network' },
  { key: 'envReads', label: 'Env reads', className: 'text-right' },
  { key: 'provenance', label: 'Provenance' },
  { key: 'source', label: 'Source match' },
];

function cmp(a: IndexEntry, b: IndexEntry, key: SortKey): number {
  switch (key) {
    case 'name':
      return a.name.localeCompare(b.name);
    case 'score':
      return a.score - b.score;
    case 'installScripts':
      return Number(a.installScripts) - Number(b.installScripts);
    case 'network':
      return Number(a.network) - Number(b.network);
    case 'envReads':
      return a.envReads - b.envReads;
    case 'provenance':
      return PROV_RANK[a.provenance] - PROV_RANK[b.provenance];
    case 'source':
      return SOURCE_RANK[a.source] + a.onlyInPackage * 10 - (SOURCE_RANK[b.source] + b.onlyInPackage * 10);
  }
}

function Yes({ on, label }: { on: boolean; label: string }) {
  return on ? <Pill tone="warn">{label}</Pill> : <span className="mono text-[12px] text-ink-3" aria-label="No">--</span>;
}

export function IndexPage() {
  const { data, loading } = useAsync(loadIndex, []);
  const [q, setQ] = useState('');
  const [grades, setGrades] = useState<Set<Grade>>(new Set());
  const [flags, setFlags] = useState({ install: false, network: false, noProv: false, sourceIssue: false });
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'score', dir: -1 });

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    const out = data.packages.filter((p) => {
      if (needle && !p.name.toLowerCase().includes(needle)) return false;
      if (grades.size && !grades.has(p.grade)) return false;
      if (flags.install && !p.installScripts) return false;
      if (flags.network && !p.network) return false;
      if (flags.noProv && p.provenance === 'present') return false;
      if (flags.sourceIssue && !(p.source === 'mismatch' || p.onlyInPackage > 0 || p.source === 'partial')) return false;
      return true;
    });
    out.sort((a, b) => cmp(a, b, sort.key) * sort.dir || a.name.localeCompare(b.name));
    return out;
  }, [data, q, grades, flags, sort]);

  const stats = useMemo(() => {
    const p = data?.packages ?? [];
    const dist = Object.fromEntries(GRADES.map((g) => [g, p.filter((x) => x.grade === g).length])) as Record<Grade, number>;
    return {
      total: p.length,
      dist,
      install: p.filter((x) => x.installScripts).length,
      prov: p.filter((x) => x.provenance === 'present').length,
      unsourced: p.filter((x) => x.onlyInPackage > 0).length,
    };
  }, [data]);

  const toggleGrade = (g: Grade) =>
    setGrades((s) => {
      const n = new Set(s);
      if (n.has(g)) n.delete(g);
      else n.add(g);
      return n;
    });
  const setSortKey = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === 'name' ? 1 : -1 }));

  const filterBtn = (on: boolean) =>
    `mono cursor-pointer border px-2.5 py-1.5 text-[12px] uppercase tracking-wider ${on ? 'border-accent bg-accent text-accent-ink' : 'border-line-2 text-ink-2 hover:border-ink-3 hover:text-ink'}`;

  return (
    <>
      {/* Hero */}
      <section className="grid gap-8 pb-10 pt-10 sm:pt-16 lg:grid-cols-[1.35fr_1fr] lg:gap-12">
        <div>
          <p className="label mb-4">
            <span className="text-accent">●</span> Supply-chain lab / npm
          </p>
          <h1 className="font-display text-[2.4rem] font-bold leading-[1.02] tracking-[-0.03em] sm:text-6xl">
            Know what a package can do <span className="text-accent">before</span> it runs.
          </h1>
          <p className="mt-6 max-w-xl text-[1.05rem] leading-relaxed text-ink-2">
            The Vouch Trust Index reads the published tarball of popular npm packages and answers three questions: what can it do, does it match its source on GitHub, and how much evidence is there that you should trust it.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <a
              href="#/"
              onClick={(e) => {
                e.preventDefault();
                document.getElementById('table')?.scrollIntoView({ behavior: 'smooth' });
                document.getElementById('pkg-search')?.focus({ preventScroll: true });
              }}
              className="mono bg-accent px-4 py-2.5 text-[13px] font-semibold uppercase tracking-wider text-accent-ink no-underline hover:opacity-90">
              Browse the index
            </a>
            <Link to="/use" className="mono border border-line-2 px-4 py-2.5 text-[13px] uppercase tracking-wider text-ink no-underline hover:border-accent">
              npx vouchjs report &lt;pkg&gt;
            </Link>
          </div>
        </div>
        <aside className="scanline border border-line bg-panel" aria-label="Why this exists">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="label">Incident log / 2025</span>
            <span className="mono text-[11px] text-danger">
              <span className="blink">■</span> live threat class
            </span>
          </div>
          <ol className="divide-y divide-line">
            <li className="px-4 py-4">
              <p className="mono text-[11px] uppercase tracking-wider text-ink-3">Sep 2025 / maintainer phished</p>
              <p className="mt-1 font-display text-lg font-bold">chalk and debug hijacked</p>
              <p className="mt-1 text-sm leading-relaxed text-ink-2">
                A phished maintainer account pushed malicious releases of chalk, debug and more than a dozen sibling packages, together downloaded billions of times a week. The payload hooked browser wallet APIs to reroute crypto transfers. It shipped as plain code the repositories never contained.
              </p>
            </li>
            <li className="px-4 py-4">
              <p className="mono text-[11px] uppercase tracking-wider text-ink-3">Sep and Nov 2025 / self-replicating</p>
              <p className="mt-1 font-display text-lg font-bold">The Shai-Hulud worm</p>
              <p className="mt-1 text-sm leading-relaxed text-ink-2">
                An install-time script harvested npm, GitHub and cloud tokens from developer machines and CI, then used them to publish infected versions of every package the victim maintained. Hundreds of packages were hit before the registry caught up.
              </p>
            </li>
            <li className="bg-panel-2 px-4 py-3">
              <p className="text-sm leading-relaxed text-ink-2">
                Both would have shown up as <strong className="text-ink">new capabilities</strong> (wallet hooks, install scripts, network calls) and as <strong className="text-ink">files with no source</strong>. That is what Vouch measures.
              </p>
            </li>
          </ol>
        </aside>
      </section>

      {/* Stats strip */}
      <section aria-label="Index summary" className="grid grid-cols-2 border border-line bg-panel sm:grid-cols-4">
        {[
          { k: 'Packages scored', v: stats.total },
          { k: 'Run install scripts', v: stats.install },
          { k: 'With provenance', v: stats.prov },
          { k: 'Ship unsourced files', v: stats.unsourced },
        ].map((s, i) => (
          <div key={s.k} className={`px-4 py-4 ${i % 2 ? 'border-l border-line' : ''} ${i > 1 ? 'border-t border-line sm:border-t-0' : ''} ${i === 2 ? 'sm:border-l' : ''}`}>
            <div className="mono tabular text-2xl font-semibold sm:text-3xl">{loading ? '...' : s.v}</div>
            <div className="label mt-1">{s.k}</div>
          </div>
        ))}
      </section>
      {stats.total > 0 && (
        <div className="mt-2 flex h-2 w-full overflow-hidden" role="img" aria-label={`Grade distribution: ${GRADES.map((g) => `${g} ${stats.dist[g]}`).join(', ')}`}>
          {GRADES.map((g) => (stats.dist[g] ? <span key={g} style={{ flex: stats.dist[g], background: gradeColor(g) }} /> : null))}
        </div>
      )}

      {data?.source === 'mock' && (
        <p role="status" className="mono mt-6 border border-warn/50 bg-warn/10 px-3 py-2 text-[12px] text-warn">
          Preview data: these rows are hand-written sample records, not measurements. The full index is generated by scripts/build-index.ts.
        </p>
      )}

      {/* Table */}
      <section id="table" className="scroll-mt-20 pt-10" aria-labelledby="table-h">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="table-h" className="font-display text-2xl font-bold tracking-tight">The index</h2>
            <p className="mt-1 text-sm text-ink-3">
              {data ? (
                <>
                  {rows.length} of {data.count} packages
                  {data.source === 'live' && <> · scanned {new Date(data.generatedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</>}
                  {!!data.skipped?.length && (
                    <span className="block text-[12px]" title={data.skipped.map((s) => `${s.name}: ${s.reason}`).join('\n')}>
                      {data.skipped.length} more could not be scored in this run (timeout, or tarball over 15 MB): {data.skipped.slice(0, 8).map((s) => s.name).join(', ')}
                      {data.skipped.length > 8 ? ', ...' : ''}
                    </span>
                  )}
                </>
              ) : (
                'Loading'
              )}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3 border border-line bg-panel p-3 sm:p-4">
          <label className="relative block">
            <span className="sr-only">Search packages</span>
            <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
            <input
              id="pkg-search"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search packages, e.g. express"
              className="mono w-full border border-line-2 bg-bg-2 py-2.5 pl-9 pr-3 text-[14px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by grade">
            <span className="label mr-1">Grade</span>
            {GRADES.map((g) => (
              <button
                key={g}
                type="button"
                aria-pressed={grades.has(g)}
                onClick={() => toggleGrade(g)}
                className="mono h-8 w-8 cursor-pointer border text-[13px] font-semibold"
                style={grades.has(g) ? { background: gradeColor(g), color: 'var(--bg)', borderColor: gradeColor(g) } : { color: gradeColor(g), borderColor: 'var(--line-2)' }}
              >
                {g}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by signal">
            <span className="label mr-1">Show only</span>
            <button type="button" aria-pressed={flags.install} className={filterBtn(flags.install)} onClick={() => setFlags((f) => ({ ...f, install: !f.install }))}>Install scripts</button>
            <button type="button" aria-pressed={flags.network} className={filterBtn(flags.network)} onClick={() => setFlags((f) => ({ ...f, network: !f.network }))}>Network</button>
            <button type="button" aria-pressed={flags.noProv} className={filterBtn(flags.noProv)} onClick={() => setFlags((f) => ({ ...f, noProv: !f.noProv }))}>No provenance</button>
            <button type="button" aria-pressed={flags.sourceIssue} className={filterBtn(flags.sourceIssue)} onClick={() => setFlags((f) => ({ ...f, sourceIssue: !f.sourceIssue }))}>Source drift</button>
          </div>
        </div>

        {/* Mobile: cards */}
        <div className="mt-3 sm:hidden">
          <label className="mb-2 flex items-center gap-2">
            <span className="label">Sort</span>
            <select
              value={`${sort.key}:${sort.dir}`}
              onChange={(e) => {
                const [key, dir] = e.target.value.split(':');
                setSort({ key: key as SortKey, dir: Number(dir) as 1 | -1 });
              }}
              className="mono flex-1 border border-line-2 bg-bg-2 px-2 py-2 text-[13px] text-ink"
            >
              <option value="score:-1">Score, high to low</option>
              <option value="score:1">Score, low to high</option>
              <option value="name:1">Name, A to Z</option>
              <option value="envReads:-1">Most env reads</option>
              <option value="source:-1">Worst source match</option>
            </select>
          </label>
          <ul className="flex flex-col gap-2">
            {rows.map((p) => (
              <li key={p.name}>
                <a href={`#/pkg/${p.name}`} className="flex items-start gap-3 border border-line bg-panel p-3 no-underline hover:border-line-2">
                  <GradeBadge grade={p.grade} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="mono truncate text-[14px] font-semibold">{p.name}</span>
                      <span className="mono tabular text-[13px] text-ink-2">{p.score}</span>
                    </span>
                    <span className="mono block text-[11px] text-ink-3">v{p.version}</span>
                    <span className="mt-2 flex flex-wrap gap-1.5">
                      {p.installScripts && <Pill tone="warn">install</Pill>}
                      {p.network && <Pill tone="warn">net</Pill>}
                      {p.envReads > 0 && <Pill tone="muted">env {p.envReads}</Pill>}
                      <ProvenancePill status={p.provenance} />
                      <SourcePill status={p.source} only={p.onlyInPackage} />
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>

        {/* Desktop: table */}
        <div className="mt-3 hidden overflow-x-auto border border-line bg-panel sm:block">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Packages in the Vouch Trust Index. Column headers sort the table.</caption>
            <thead>
              <tr className="border-b border-line-2 bg-panel-2">
                {COLS.map((c) => {
                  const active = sort.key === c.key;
                  return (
                    <th key={c.key} scope="col" aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} className={`px-3 py-2.5 font-normal ${c.className ?? ''}`}>
                      <button type="button" onClick={() => setSortKey(c.key)} className={`label inline-flex cursor-pointer items-center gap-1 whitespace-nowrap hover:text-ink ${active ? 'text-accent!' : ''}`}>
                        {c.label}
                        <span aria-hidden className="text-[10px]">{active ? (sort.dir === 1 ? '▲' : '▼') : '↕'}</span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.name} className="group border-b border-line last:border-b-0 hover:bg-panel-2">
                  <th scope="row" className="px-3 py-2.5 font-normal">
                    <a href={`#/pkg/${p.name}`} className="mono text-[14px] font-semibold no-underline group-hover:text-accent">
                      {p.name}
                    </a>
                    <span className="mono ml-2 text-[11px] text-ink-3">{p.version}</span>
                  </th>
                  <td className="px-3 py-2.5">
                    <span className="flex items-center gap-3">
                      <GradeBadge grade={p.grade} size="sm" />
                      <ScoreBar score={p.score} grade={p.grade} />
                    </span>
                  </td>
                  <td className="px-3 py-2.5"><Yes on={p.installScripts} label="Runs" /></td>
                  <td className="px-3 py-2.5"><Yes on={p.network} label="Yes" /></td>
                  <td className="mono tabular px-3 py-2.5 text-right text-[13px]">{p.envReads || <span className="text-ink-3">0</span>}</td>
                  <td className="px-3 py-2.5"><ProvenancePill status={p.provenance} /></td>
                  <td className="px-3 py-2.5"><SourcePill status={p.source} only={p.onlyInPackage} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && rows.length === 0 && (
          <p className="mono mt-3 border border-line bg-panel p-6 text-center text-[13px] text-ink-3">No packages match these filters.</p>
        )}
      </section>
    </>
  );
}
