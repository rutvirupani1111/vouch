import { useEffect, useState } from 'react';
import { IndexPage } from './pages/IndexPage';
import { PackagePage } from './pages/PackagePage';
import { MethodologyPage } from './pages/MethodologyPage';
import { UsePage } from './pages/UsePage';
import { Link } from './ui';

const REPO = 'https://github.com/rutvirupani1111/vouch';

function useRoute(): string {
  const read = () => decodeURIComponent(window.location.hash.replace(/^#/, '') || '/');
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => {
      setRoute(read());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

function ThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'));
  useEffect(() => {
    if (theme === 'light') document.documentElement.dataset.theme = 'light';
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem('vouch-theme', theme);
    } catch {
      /* storage unavailable */
    }
  }, [theme]);
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} theme`}
      className="mono grid h-8 w-8 cursor-pointer place-items-center border border-line-2 text-ink-2 hover:border-accent hover:text-accent"
    >
      {theme === 'dark' ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  );
}

const NAV = [
  { to: '/', label: 'Index' },
  { to: '/methodology', label: 'Methodology' },
  { to: '/use', label: 'Use Vouch' },
];

export function App() {
  const route = useRoute();
  let page;
  if (route.startsWith('/pkg/')) page = <PackagePage name={route.slice(5)} />;
  else if (route === '/methodology') page = <MethodologyPage />;
  else if (route === '/use') page = <UsePage />;
  else page = <IndexPage />;

  useEffect(() => {
    const t = route.startsWith('/pkg/') ? `${route.slice(5)} | Vouch Trust Index` : route === '/methodology' ? 'Methodology | Vouch Trust Index' : route === '/use' ? 'Use Vouch | Vouch Trust Index' : 'Vouch Trust Index';
    document.title = t;
  }, [route]);

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-ink" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 no-underline">
            <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
              <rect width="32" height="32" fill="var(--panel-2)" stroke="var(--line-2)" />
              <path d="M8 9l8 15 8-15" fill="none" stroke="var(--accent)" strokeWidth="3.2" strokeLinecap="square" />
            </svg>
            <span className="font-display text-lg font-bold tracking-tight">Vouch</span>
            <span className="label hidden sm:inline">Trust Index</span>
          </Link>
          <nav aria-label="Main" className="ml-auto flex items-center gap-1 sm:gap-2">
            {NAV.map((n) => {
              const active = n.to === '/' ? route === '/' || route.startsWith('/pkg/') : route === n.to;
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  ariaCurrent={active}
                  className={`mono px-2 py-1 text-[12px] uppercase tracking-wider no-underline sm:text-[13px] ${active ? 'text-accent' : 'text-ink-2 hover:text-ink'}`}
                >
                  {n.label}
                </Link>
              );
            })}
            <a href={REPO} className="mono hidden px-2 py-1 text-[13px] uppercase tracking-wider text-ink-2 no-underline hover:text-ink md:inline">
              GitHub
            </a>
            <ThemeToggle />
          </nav>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 pb-20 outline-none">
        {page}
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-sm text-ink-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="mono text-[12px]">Vouch is open source (MIT) by Rutvi Rupani.</span>
          <span className="mono flex gap-4 text-[12px]">
            <a href={REPO} className="hover:text-ink">Source</a>
            <a href={`${REPO}/issues`} className="hover:text-ink">Report an error</a>
            <a href={`${import.meta.env.BASE_URL}data/index.json`} className="hover:text-ink">index.json</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
