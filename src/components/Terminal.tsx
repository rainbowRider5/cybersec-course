import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { complete, createState, prompt, run, type OutputLine } from '../terminal/shell';
import type { TerminalScenario, TerminalState, TerminalTask } from '../terminal/types';
import { Markdown } from './Markdown';

interface Line extends OutputLine {
  prompt?: string;
}

interface Props {
  title: string;
  scenario: TerminalScenario;
  tasks?: TerminalTask[];
  intro?: string;
  /** Called whenever a task becomes complete. */
  onTaskComplete?: (taskId: string) => void;
  /** Task ids already completed earlier (from saved progress). */
  completed?: Record<string, boolean>;
  tall?: boolean;
}

const WELCOME: Line[] = [
  { kind: 'info', text: 'Simulated terminal: commands run against a pretend Linux system in your browser.' },
  { kind: 'info', text: 'Type "help" to see what works. Up/Down for history, Tab to complete.' },
];

export function Terminal({ title, scenario, tasks = [], intro, onTaskComplete, completed = {}, tall }: Props) {
  const [state, setState] = useState<TerminalState>(() => createState(scenario));
  const [lines, setLines] = useState<Line[]>(WELCOME);
  const [input, setInput] = useState('');
  const [histIdx, setHistIdx] = useState<number | null>(null);
  const [done, setDone] = useState<Record<string, boolean>>(completed);
  const [, force] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const checkTasks = useCallback(
    (s: TerminalState) => {
      const newly: string[] = [];
      for (const t of tasks) {
        if (done[t.id]) continue;
        let passed = false;
        try {
          passed = t.check(s);
        } catch {
          passed = false;
        }
        if (passed) newly.push(t.id);
      }
      if (newly.length) {
        setDone((d) => ({ ...d, ...Object.fromEntries(newly.map((n) => [n, true])) }));
        newly.forEach((n) => onTaskComplete?.(n));
      }
    },
    [tasks, done, onTaskComplete],
  );

  const submit = () => {
    const p = prompt(state);
    const cmd = input;
    const result = run(state, cmd);
    setInput('');
    setHistIdx(null);
    if (result.clear) setLines([]);
    else setLines((ls) => [...ls, { kind: 'out' as const, text: cmd, prompt: p }, ...result.lines].slice(-600));
    force((n) => n + 1);
    checkTasks(state);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!state.history.length) return;
      const idx = histIdx === null ? state.history.length - 1 : Math.max(0, histIdx - 1);
      setHistIdx(idx);
      setInput(state.history[idx]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (histIdx === null) return;
      const idx = histIdx + 1;
      if (idx >= state.history.length) {
        setHistIdx(null);
        setInput('');
      } else {
        setHistIdx(idx);
        setInput(state.history[idx]);
      }
    } else if (e.key === 'Tab') {
      // Only trap Tab when there is something to complete, so keyboard users can still tab out.
      if (!input.trim()) return;
      e.preventDefault();
      setInput(complete(state, input));
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      setLines([]);
    } else if (e.key === 'c' && e.ctrlKey && !window.getSelection()?.toString()) {
      e.preventDefault();
      setLines((ls): Line[] => [...ls, { kind: 'out', text: input + '^C', prompt: prompt(state) }]);
      setInput('');
    }
  };

  const reset = () => {
    const fresh = createState(scenario);
    setState(fresh);
    setLines([...WELCOME, { kind: 'info', text: '(system reset to its starting state)' }]);
    setInput('');
    inputRef.current?.focus();
  };

  const doneCount = useMemo(() => tasks.filter((t) => done[t.id]).length, [tasks, done]);

  return (
    <section className="terminal-wrap" aria-labelledby={`${id}-title`}>
      <div className="terminal-bar">
        <strong id={`${id}-title`}>{title}</strong>
        {tasks.length > 0 && (
          <span className={`pill ${doneCount === tasks.length ? 'pill-ok' : ''}`}>
            {doneCount}/{tasks.length} tasks
          </span>
        )}
        <button type="button" className="btn btn-small" onClick={reset}>
          Reset
        </button>
      </div>
      <div
        className={`terminal${tall ? ' tall' : ''}`}
        ref={scrollRef}
        onClick={() => {
          if (!window.getSelection()?.toString()) inputRef.current?.focus();
        }}
      >
        <div role="log" aria-live="polite" aria-label="Terminal output">
          {lines.map((l, i) => (
            <div key={i} className={`line ${l.kind === 'err' ? 'err' : l.kind === 'info' ? 'info' : ''}`}>
              {l.prompt && <span className="prompt">{l.prompt}</span>}
              {l.text}
            </div>
          ))}
        </div>
        <div className="terminal-input-row">
          <label htmlFor={`${id}-input`} className="prompt">
            {prompt(state)}
          </label>
          <input
            id={`${id}-input`}
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Command"
          />
        </div>
      </div>
      {intro && (
        <div className="tasks-intro">
          <Markdown text={intro} inline />
        </div>
      )}
      {tasks.length > 0 && (
        <ol className="tasks" aria-label="Tasks">
          {tasks.map((t) => (
            <li key={t.id} className={`task${done[t.id] ? ' done' : ''}`}>
              <span className="task-check" aria-hidden="true">
                {done[t.id] ? '✓' : ''}
              </span>
              <div>
                <p>
                  <span className="visually-hidden">{done[t.id] ? 'Done: ' : 'To do: '}</span>
                  <Markdown text={t.instruction} inline />
                </p>
                {done[t.id] && t.success && (
                  <p className="task-success">
                    <Markdown text={t.success} inline />
                  </p>
                )}
                {!done[t.id] && (t.hint || t.solution) && (
                  <details className="hint">
                    <summary>{t.hint ? 'Hint' : 'Show solution'}</summary>
                    {t.hint && <Markdown text={t.hint} inline />}
                    {t.hint && t.solution && (
                      <details className="hint">
                        <summary>Show solution</summary>
                        <pre className="task-solution">
                          <code>{t.solution.join('\n')}</code>
                        </pre>
                      </details>
                    )}
                    {!t.hint && t.solution && (
                      <pre className="task-solution">
                        <code>{t.solution.join('\n')}</code>
                      </pre>
                    )}
                  </details>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
