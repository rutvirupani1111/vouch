// Generate shields-style SVG badges from public/data/index.json. No network.
// Output: public/badge/<name>.svg (scoped "/" -> "__") and public/badge/vouch.svg.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(SITE, 'public', 'badge');

const COLORS: Record<string, string> = { A: '#2ea043', B: '#0d9488', C: '#d4a017', D: '#f0883e', F: '#e5534b' };

// Approximate Verdana 11px advance widths (shields uses the same font).
function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    if ('il.:|!\''.includes(ch)) w += 3.5;
    else if ('fjrt '.includes(ch)) w += 4.5;
    else if ('mwMW'.includes(ch)) w += 10;
    else if (/[A-Z0-9]/.test(ch)) w += 7.5;
    else w += 6.5;
  }
  return Math.round(w);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function badgeSvg(label: string, message: string, color: string): string {
  const lw = textWidth(label) + 12;
  const mw = textWidth(message) + 12;
  const w = lw + mw;
  const title = esc(`${label}: ${message}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${title}"><title>${title}</title><linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient><clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath><g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#555"/><rect x="${lw}" width="${mw}" height="20" fill="${color}"/><rect width="${w}" height="20" fill="url(#s)"/></g><g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="11"><text x="${lw / 2}" y="15" fill="#010101" fill-opacity=".3">${esc(label)}</text><text x="${lw / 2}" y="14">${esc(label)}</text><text x="${lw + mw / 2}" y="15" fill="#010101" fill-opacity=".3">${esc(message)}</text><text x="${lw + mw / 2}" y="14">${esc(message)}</text></g></svg>\n`;
}

export const badgeFile = (name: string) => `${name.replace(/\//g, '__')}.svg`;

const index = JSON.parse(readFileSync(join(SITE, 'public', 'data', 'index.json'), 'utf8')) as {
  packages: { name: string; score: number; grade: string }[];
};
mkdirSync(OUT, { recursive: true });
for (const p of index.packages) {
  writeFileSync(join(OUT, badgeFile(p.name)), badgeSvg('vouch', `${p.grade} ${p.score}`, COLORS[p.grade] ?? '#9f9f9f'));
}
writeFileSync(join(OUT, 'vouch.svg'), badgeSvg('vouch', 'trust index', '#0d9488'));
console.log(`badges: wrote ${index.packages.length + 1} files to public/badge/`);
