/** Dependency-free terminal, JSON and Markdown rendering. */
import { CAPABILITY_LABEL } from './analyze.js';
import { createStyle, supportsColor, supportsUnicode, type Style } from './engine/util/ansi.js';
import type { CheckResult } from './manifest.js';
import type { Grade, PackageReport, Severity } from './types.js';

export interface Ui {
  s: Style;
  u: boolean;
}

export function makeUi(stream: { isTTY?: boolean } = process.stdout): Ui {
  return { s: createStyle(supportsColor({ isTTY: Boolean(stream.isTTY) })), u: supportsUnicode() };
}

function sym(ui: Ui) {
  return ui.u
    ? { ok: '✔', bad: '✖', warn: '▲', dot: '●', line: '─', arrow: '→', sep: '·' }
    : { ok: '+', bad: 'x', warn: '!', dot: '*', line: '-', arrow: '->', sep: '|' };
}

function sevColor(ui: Ui, sev: Severity): (t: string) => string {
  const s = ui.s;
  return sev === 'critical' ? (t) => s.bold(s.red(t)) : sev === 'high' ? s.red : sev === 'medium' ? s.yellow : sev === 'low' ? s.cyan : s.gray;
}

function gradeColor(ui: Ui, g: Grade): (t: string) => string {
  const s = ui.s;
  return g === 'A' ? s.green : g === 'B' ? s.green : g === 'C' ? s.yellow : g === 'D' ? s.red : (t) => s.bold(s.red(t));
}

const pad = (t: string, n: number) => (t.length >= n ? t : t + ' '.repeat(n - t.length));
const short = (sha?: string) => (sha && /^[0-9a-f]{40}$/.test(sha) ? sha.slice(0, 7) : sha ?? '');

function bar(ui: Ui, score: number): string {
  const width = 20;
  const full = Math.round((score / 100) * width);
  const [on, off] = ui.u ? ['█', '░'] : ['#', '.'];
  return on.repeat(full) + ui.s.gray(off.repeat(width - full));
}

export function renderReport(r: PackageReport, ui: Ui = makeUi()): string {
  const { s } = ui;
  const y = sym(ui);
  const g = gradeColor(ui, r.grade);
  const out: string[] = [];
  const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} kB`);
  out.push('');
  out.push(`  ${s.bold(`${r.name}@${r.version}`)}  ${s.gray(`${r.files} files ${y.sep} ${kb(r.unpackedSize)}`)}`);
  out.push(`  ${g(bar(ui, r.score))}  ${s.bold(g(`${r.score}/100`))}  ${s.bold(g(`grade ${r.grade}`))}`);
  out.push('');

  out.push(`  ${s.bold('What it can do')}`);
  if (r.capabilities.length === 0) out.push(`    ${s.green(y.ok)} nothing notable: no network, env, process, install or eval capabilities`);
  for (const c of r.capabilities) {
    const risky = ['install_script', 'crypto_wallet', 'obfuscation', 'child_process'].includes(c.id);
    const mark = risky ? s.yellow(y.dot) : s.cyan(y.dot);
    out.push(`    ${mark} ${pad(CAPABILITY_LABEL[c.id], 38)} ${s.gray(c.detail)}`);
    const e = c.evidence[0];
    if (e) out.push(`      ${s.gray(`${e.file}:${e.line}`)}  ${s.dim(e.excerpt.slice(0, 80))}`);
  }
  for (const [ev, cmd] of Object.entries(r.installScripts)) out.push(`    ${s.yellow(y.warn)} ${pad(ev, 38)} ${cmd}`);
  out.push('');

  out.push(`  ${s.bold('Does it match its source?')}`);
  const p = r.verify.provenance;
  const pMark = p.status === 'present' ? s.green(y.ok) : p.status === 'absent' ? s.yellow(y.warn) : s.red(y.bad);
  const pText =
    p.status === 'present'
      ? `provenance  ${p.repo} @ ${short(p.commit)} ${s.gray(`via ${p.workflow ?? 'unknown workflow'}`)}`
      : `provenance  ${p.status}`;
  out.push(`    ${pMark} ${pText}`);
  if (p.note) out.push(`      ${s.gray(p.note)}`);
  const m = r.verify.source;
  const mMark = m.status === 'match' ? s.green(y.ok) : m.status === 'partial' || m.status === 'unknown' ? s.yellow(y.warn) : s.red(y.bad);
  out.push(`    ${mMark} source      ${m.status}${m.repo ? `  ${m.repo} @ ${short(m.ref)}` : ''}`);
  out.push(
    `      ${s.gray(`${m.identical} identical ${y.sep} ${m.differs.length} differ ${y.sep} ${m.builtOnly.length} build output ${y.sep} ${m.onlyInPackage.length} unexplained`)}`,
  );
  if (m.note) out.push(`      ${s.gray(m.note)}`);
  for (const f of m.differs.slice(0, 8)) out.push(`      ${s.red(y.bad)} differs from source: ${f}`);
  for (const f of m.onlyInPackage.slice(0, 8)) out.push(`      ${s.red(y.bad)} not in source:        ${f}`);
  const more = m.differs.length + m.onlyInPackage.length - Math.min(8, m.differs.length) - Math.min(8, m.onlyInPackage.length);
  if (more > 0) out.push(`      ${s.gray(`(+${more} more, see --json)`)}`);
  out.push('');

  out.push(`  ${s.bold('Findings')}`);
  if (r.findings.length === 0) out.push(`    ${s.green(y.ok)} none`);
  for (const f of r.findings) {
    out.push(`    ${sevColor(ui, f.severity)(pad(f.severity, 9))}${pad(f.title, 36)} ${s.gray(f.detail.slice(0, 100))}`);
  }
  out.push('');
  out.push(`  ${s.gray('Reachability of known vulnerabilities is on the roadmap; this report covers capabilities and source integrity.')}`);
  out.push('');
  return out.join('\n');
}

export function renderCheck(r: CheckResult, format: 'pretty' | 'json' | 'markdown', ui: Ui = makeUi()): string {
  if (format === 'json') {
    return (
      JSON.stringify(
        {
          ok: r.violations.length === 0,
          checked: r.checked,
          skipped: r.skipped,
          violations: r.violations.map((v) => ({
            kind: v.kind,
            name: v.name,
            version: v.version,
            capabilities: v.capabilities,
            installScripts: v.analysis.installScripts,
            risk: v.analysis.risk,
            findings: v.analysis.findings,
          })),
          errors: r.errors,
        },
        null,
        2,
      ) + '\n'
    );
  }
  if (format === 'markdown') {
    const lines = [`## Vouch: ${r.violations.length === 0 ? 'all dependencies match the approved manifest' : `${r.violations.length} unapproved change(s)`}`, ''];
    if (r.violations.length) {
      lines.push('| Package | Change | Capabilities | Top finding |', '| --- | --- | --- | --- |');
      for (const v of r.violations) {
        const top = v.analysis.findings[0];
        lines.push(
          `| \`${v.name}@${v.version}\` | ${v.kind === 'new-package' ? 'new package' : 'gained capabilities'} | ${v.capabilities.map((c) => `\`${c}\``).join(' ') || 'none'} | ${top ? `**${top.severity}** ${top.title}` : ''} |`,
        );
      }
      lines.push('', 'Approve with `npx vouch approve <package>` once reviewed.');
    }
    if (r.errors.length) lines.push('', `${r.errors.length} package(s) could not be analysed: ${r.errors.map((e) => `\`${e.name}@${e.version}\``).join(', ')}`);
    lines.push('', `<sub>${r.checked} packages checked, ${r.skipped} unchanged since approval.</sub>`);
    return lines.join('\n') + '\n';
  }
  const { s } = ui;
  const y = sym(ui);
  const out: string[] = [''];
  if (r.violations.length === 0) {
    out.push(`  ${s.green(y.ok)} ${s.bold('All dependencies match vouch.lock.json')}  ${s.gray(`${r.checked} checked ${y.sep} ${r.skipped} unchanged`)}`);
  } else {
    out.push(`  ${s.red(y.bad)} ${s.bold(`${r.violations.length} unapproved change(s)`)}  ${s.gray(`${r.checked} checked ${y.sep} ${r.skipped} unchanged`)}`);
    out.push('');
    for (const v of r.violations) {
      const label = v.kind === 'new-package' ? s.yellow('new package') : s.red('gained');
      out.push(`  ${s.bold(`${v.name}@${v.version}`)}  ${label}  ${v.capabilities.map((c) => s.cyan(c)).join(', ') || s.gray('no capabilities')}`);
      for (const f of v.analysis.findings.filter((f) => f.severity !== 'info').slice(0, 4)) {
        out.push(`    ${sevColor(ui, f.severity)(pad(f.severity, 9))}${f.title} ${s.gray(f.detail.slice(0, 80))}`);
      }
    }
    out.push('');
    out.push(`  ${s.gray(`Review, then: vouch approve <package>`)}`);
  }
  for (const e of r.errors) out.push(`  ${s.yellow(y.warn)} could not analyse ${e.name}@${e.version}: ${s.gray(e.message)}`);
  out.push('');
  return out.join('\n');
}
