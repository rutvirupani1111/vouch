import { useEffect, useState } from 'react';
import type { PackageReport } from './types';
import { MOCK_REPORTS } from './mock';
import { slug, summarize, type IndexFile } from './summary';

const BASE = import.meta.env.BASE_URL;

export const dataUrl = (path: string) => `${BASE}data/${path}`;
export const pkgJsonUrl = (name: string) => dataUrl(`pkg/${slug(name)}.json`);

function mockIndex(): IndexFile {
  return {
    generatedAt: new Date(0).toISOString(),
    source: 'mock',
    count: MOCK_REPORTS.length,
    packages: MOCK_REPORTS.map(summarize),
  };
}

let indexPromise: Promise<IndexFile> | null = null;

export function loadIndex(): Promise<IndexFile> {
  if (!indexPromise) {
    indexPromise = fetch(dataUrl('index.json'))
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<IndexFile>;
      })
      .then((d) => (d.packages?.length ? d : mockIndex()))
      .catch(() => mockIndex());
  }
  return indexPromise;
}

export async function loadPackage(name: string): Promise<{ report: PackageReport; mock: boolean } | null> {
  const idx = await loadIndex();
  if (idx.source === 'mock') {
    const r = MOCK_REPORTS.find((m) => m.name === name);
    return r ? { report: r, mock: true } : null;
  }
  try {
    const r = await fetch(pkgJsonUrl(name));
    if (!r.ok) return null;
    return { report: (await r.json()) as PackageReport, mock: false };
  } catch {
    return null;
  }
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | undefined; loading: boolean } {
  const [state, setState] = useState<{ data: T | undefined; loading: boolean }>({ data: undefined, loading: true });
  useEffect(() => {
    let live = true;
    setState({ data: undefined, loading: true });
    fn().then((data) => live && setState({ data, loading: false }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}
