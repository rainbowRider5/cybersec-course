import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { MODULES, allGlossary, findTerm } from '../course/registry';

interface GlossaryCtx {
  open: (termId?: string) => void;
}

const Ctx = createContext<GlossaryCtx>({ open: () => {} });

export const useGlossary = () => useContext(Ctx);

export function GlossaryProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; focus?: string }>({ open: false });
  const opener = useRef<HTMLElement | null>(null);

  const open = useCallback((termId?: string) => {
    opener.current = document.activeElement as HTMLElement | null;
    setState({ open: true, focus: termId });
  }, []);
  const close = useCallback(() => {
    setState({ open: false });
    opener.current?.focus();
  }, []);

  const value = useMemo(() => ({ open }), [open]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {state.open && <GlossaryDrawer focus={state.focus} onClose={close} />}
    </Ctx.Provider>
  );
}

function GlossaryDrawer({ focus, onClose }: { focus?: string; onClose: () => void }) {
  const focusTerm = focus ? findTerm(focus) : undefined;
  const [query, setQuery] = useState(focusTerm?.term ?? '');
  const inputRef = useRef<HTMLInputElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && drawerRef.current) {
        // keep focus inside the dialog
        const els = drawerRef.current.querySelectorAll<HTMLElement>('a, button, input');
        const first = els[0];
        const last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="drawer" role="dialog" aria-modal="true" aria-labelledby="glossary-title" ref={drawerRef}>
        <div className="drawer-head">
          <div className="drawer-head-row">
            <h2 id="glossary-title">Glossary</h2>
            <button className="btn btn-quiet btn-small" onClick={onClose}>
              Close <kbd className="mono">Esc</kbd>
            </button>
          </div>
          <input
            ref={inputRef}
            type="search"
            placeholder="Search terms and definitions"
            aria-label="Search the glossary"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="drawer-body">
          <GlossaryList query={query} highlight={focusTerm?.id} onNavigate={onClose} />
        </div>
      </div>
    </>
  );
}

export function GlossaryList({ query, highlight, onNavigate }: { query: string; highlight?: string; onNavigate?: () => void }) {
  const q = query.trim().toLowerCase();
  const terms = allGlossary()
    .filter((t) => !q || t.term.toLowerCase().includes(q) || t.definition.toLowerCase().includes(q) || t.aliases?.some((a) => a.toLowerCase().includes(q)))
    .sort((a, b) => {
      // exact/prefix matches on the term name first
      if (q) {
        const ra = a.term.toLowerCase().startsWith(q) ? 0 : 1;
        const rb = b.term.toLowerCase().startsWith(q) ? 0 : 1;
        if (ra !== rb) return ra - rb;
      }
      return a.term.localeCompare(b.term, undefined, { sensitivity: 'base' });
    });

  if (!terms.length) return <p className="glossary-meta">No terms match “{query}”.</p>;
  return (
    <>
      <p className="glossary-meta" aria-live="polite">
        {terms.length} term{terms.length === 1 ? '' : 's'}
      </p>
      <ul className="glossary-list">
        {terms.map((t) => {
          const mod = MODULES.find((m) => m.slug === t.moduleSlug);
          const lesson = mod?.content?.lessons.find((l) => l.slug === t.lesson);
          return (
            <li key={`${t.moduleSlug}-${t.id}`} className={`glossary-item${t.id === highlight ? ' highlight' : ''}`}>
              <div className="glossary-term">{t.term}</div>
              <p>{t.definition}</p>
              {lesson && (
                <div className="glossary-meta">
                  Introduced in{' '}
                  <Link to={`/m/${t.moduleSlug}/l/${lesson.slug}`} onClick={onNavigate}>
                    {lesson.title}
                  </Link>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
