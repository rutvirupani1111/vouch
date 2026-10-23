import { useEffect, useState, type ReactNode } from 'react';
import type { CapabilityId, Grade } from './types';

export const CAP_LABEL: Record<CapabilityId, string> = {
  network: 'Network',
  filesystem: 'Filesystem',
  child_process: 'Child processes',
  env: 'Env vars',
  eval: 'Dynamic eval',
  install_script: 'Install scripts',
  native_binary: 'Native binary',
  obfuscation: 'Obfuscation',
  global_hook: 'Global hooks',
  crypto_wallet: 'Crypto wallet',
};

export const CAP_SHORT: Record<CapabilityId, string> = {
  network: 'NET',
  filesystem: 'FS',
  child_process: 'PROC',
  env: 'ENV',
  eval: 'EVAL',
  install_script: 'INST',
  native_binary: 'BIN',
  obfuscation: 'OBF',
  global_hook: 'HOOK',
  crypto_wallet: 'WLT',
};

/** Capabilities that deserve attention even in a healthy package. */
export const HOT_CAPS: CapabilityId[] = ['install_script', 'eval', 'obfuscation', 'native_binary', 'crypto_wallet', 'global_hook'];

const GRADE_VAR: Record<Grade, string> = { A: 'var(--g-a)', B: 'var(--g-b)', C: 'var(--g-c)', D: 'var(--g-d)', F: 'var(--g-f)' };
const GRADE_WORD: Record<Grade, string> = {
  A: 'Strong evidence of trust',
  B: 'Trustworthy with minor gaps',
  C: 'Review before trusting',
  D: 'Weak evidence, notable powers',
  F: 'Do not trust without review',
};

export const gradeColor = (g: Grade) => GRADE_VAR[g];
export const gradeWord = (g: Grade) => GRADE_WORD[g];

export function GradeBadge({ grade, size = 'md' }: { grade: Grade; size?: 'sm' | 'md' | 'lg' }) {
  const dim = size === 'lg' ? 'h-24 w-24 text-6xl' : size === 'md' ? 'h-9 w-9 text-xl' : 'h-7 w-7 text-base';
  const c = GRADE_VAR[grade];
  return (
    <span
      role="img"
      aria-label={`Grade ${grade}: ${GRADE_WORD[grade]}`}
      title={`Grade ${grade}: ${GRADE_WORD[grade]}`}
      className={`relative inline-grid shrink-0 place-items-center font-mono font-semibold leading-none ${dim}`}
      style={{
        color: c,
        border: `${size === 'lg' ? 3 : 2}px solid ${c}`,
        background: `color-mix(in srgb, ${c} 12%, transparent)`,
        clipPath: 'polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 8px 100%, 0 calc(100% - 8px))',
      }}
    >
      {grade}
    </span>
  );
}

export function ScoreBar({ score, grade }: { score: number; grade: Grade }) {
  return (
    <span className="flex items-center gap-2">
      <span className="mono tabular w-7 text-right text-sm">{score}</span>
      <span className="relative hidden h-1.5 w-16 bg-line sm:inline-block" aria-hidden>
        <span className="absolute inset-y-0 left-0" style={{ width: `${score}%`, background: gradeColor(grade) }} />
      </span>
    </span>
  );
}

type Tone = 'ok' | 'warn' | 'bad' | 'muted';
const TONE: Record<Tone, string> = {
  ok: 'text-g-a border-g-a/40',
  warn: 'text-warn border-warn/40',
  bad: 'text-danger border-danger/50',
  muted: 'text-ink-3 border-line-2',
};

export function Pill({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`mono inline-flex items-center gap-1 whitespace-nowrap border px-1.5 py-0.5 text-[11px] uppercase tracking-wider ${TONE[tone]}`}>
      {children}
    </span>
  );
}

export function ProvenancePill({ status }: { status: 'present' | 'absent' | 'error' }) {
  if (status === 'present') return <Pill tone="ok" title="Signed npm provenance attestation links this version to a CI build">Signed</Pill>;
  if (status === 'error') return <Pill tone="warn" title="Provenance could not be checked">Error</Pill>;
  return <Pill tone="muted" title="No provenance attestation was published">None</Pill>;
}

export function SourcePill({ status, only }: { status: 'match' | 'partial' | 'mismatch' | 'unknown'; only?: number }) {
  if (only && only > 0)
    return (
      <Pill tone="bad" title={`${only} file(s) are in the published package but not in the repository`}>
        +{only} unsourced
      </Pill>
    );
  if (status === 'match') return <Pill tone="ok" title="Every published file matches the repository">Match</Pill>;
  if (status === 'partial') return <Pill tone="warn" title="Most files match; some differ or are build output">Partial</Pill>;
  if (status === 'mismatch') return <Pill tone="bad" title="Published files differ from the repository">Mismatch</Pill>;
  return <Pill tone="muted" title="The source could not be compared">Unknown</Pill>;
}

export function Panel({ title, kicker, children, className = '' }: { title?: ReactNode; kicker?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`border border-line bg-panel ${className}`}>
      {(title || kicker) && (
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
          {title && <h2 className="font-display text-base font-bold tracking-tight">{title}</h2>}
          {kicker && <span className="label">{kicker}</span>}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function CodeBlock({ children, label }: { children: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <div className="border border-line bg-bg-2">
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
        <span className="label">{label ?? 'shell'}</span>
        <button
          type="button"
          className="mono cursor-pointer text-[11px] uppercase tracking-wider text-ink-3 hover:text-accent"
          onClick={() => {
            navigator.clipboard?.writeText(children).then(() => setCopied(true), () => undefined);
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="mono overflow-x-auto p-3 text-[13px] leading-relaxed text-ink">
        <code>{children}</code>
      </pre>
    </div>
  );
}

export function formatBytes(n: number): string {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

export function Link({ to, children, className, ariaCurrent }: { to: string; children: ReactNode; className?: string; ariaCurrent?: boolean }) {
  return (
    <a href={`#${to}`} className={className} aria-current={ariaCurrent ? 'page' : undefined}>
      {children}
    </a>
  );
}
