import { useEffect, type ReactNode } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import { useTheme } from '../hooks/useTheme';
import { isStorageAvailable, useProgress } from '../progress/store';
import { useGlossary } from './Glossary';

export function Layout({ children }: { children: ReactNode }) {
  const { choice, cycle } = useTheme();
  const { open } = useGlossary();
  const data = useProgress();
  const reviewCount = Object.keys(data.review).length;
  const location = useLocation();

  // New page: start at the top unless the URL asks for a section.
  useEffect(() => {
    if (!new URLSearchParams(location.search).get('s')) window.scrollTo({ top: 0 });
  }, [location.pathname, location.search]);

  const themeLabel = choice === 'system' ? 'Theme: system' : choice === 'light' ? 'Theme: light' : 'Theme: dark';

  return (
    <>
      <a href="#main" className="skip-link" onClick={(e) => {
        e.preventDefault();
        document.getElementById('main')?.focus();
      }}>
        Skip to content
      </a>
      <header className="app-header">
        <div className="app-header-inner">
          <Link to="/" className="brand" aria-label="Groundwork, course home">
            <span className="brand-mark" aria-hidden="true">
              gw
            </span>
            <span className="brand-name">Groundwork</span>
          </Link>
          <nav className="header-nav" aria-label="Main">
            <NavLink to="/" end>
              Course
            </NavLink>
            <NavLink to="/review">
              Review
              {reviewCount > 0 && (
                <span className="count-badge" aria-label={`${reviewCount} questions`}>
                  {reviewCount}
                </span>
              )}
            </NavLink>
            <button type="button" onClick={() => open()}>
              Glossary
            </button>
            <button type="button" onClick={cycle} aria-label={`${themeLabel}. Click to change.`} title={themeLabel}>
              <ThemeIcon choice={choice} />
              <span className="label-long">{choice === 'system' ? 'Auto' : choice === 'light' ? 'Light' : 'Dark'}</span>
            </button>
          </nav>
        </div>
      </header>
      <main id="main" tabIndex={-1} style={{ outline: 'none' }}>
        {children}
      </main>
      <footer className="app-footer">
        Groundwork · a self-study cybersecurity course. Progress is saved in this browser
        {isStorageAvailable() ? '.' : ' only for this visit (storage is unavailable).'}
      </footer>
    </>
  );
}

function ThemeIcon({ choice }: { choice: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="10" cy="10" r="6.5" />
      {choice === 'light' && <circle cx="10" cy="10" r="3" fill="currentColor" stroke="none" />}
      {choice === 'dark' && <path d="M10 3.5a6.5 6.5 0 0 0 0 13z" fill="currentColor" stroke="none" />}
      {choice === 'system' && <path d="M10 3.5v13" />}
    </svg>
  );
}
