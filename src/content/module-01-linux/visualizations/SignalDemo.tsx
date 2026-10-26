import { useState } from 'react';

type ProcState = 'S' | 'T' | 'gone';

interface Sig {
  name: string;
  num: number;
  how: string;
  catchable: boolean;
}

const SIGNALS: Sig[] = [
  { name: 'SIGTERM', num: 15, how: 'kill 4300', catchable: true },
  { name: 'SIGINT', num: 2, how: 'Ctrl+C', catchable: true },
  { name: 'SIGHUP', num: 1, how: 'kill -HUP 4300', catchable: true },
  { name: 'SIGKILL', num: 9, how: 'kill -9 4300', catchable: false },
  { name: 'SIGSTOP', num: 19, how: 'kill -STOP 4300', catchable: false },
  { name: 'SIGCONT', num: 18, how: 'kill -CONT 4300', catchable: true },
];

export default function SignalDemo() {
  const [state, setState] = useState<ProcState>('S');
  const [trap, setTrap] = useState(true);
  const [lockFile, setLockFile] = useState(true);
  const [partial, setPartial] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [pending, setPending] = useState<Sig | null>(null);

  const deliver = (sig: Sig, entries: string[]) => {
    if (trap) {
      entries.push(`trap handler runs: "caught ${sig.name}, cleaning up…"`);
      entries.push('Finishes the current file, deletes /tmp/backup.lock, closes the archive, exits.');
      setLockFile(false);
    } else {
      entries.push(`No handler, so the default action for ${sig.name} applies: terminate. No cleanup code runs.`);
      entries.push(`Left behind: /tmp/backup.lock and a half-written archive. Exit status ${128 + sig.num} (128 + ${sig.num}).`);
      setPartial(true);
    }
    setState('gone');
  };

  const send = (sig: Sig) => {
    const entries: string[] = [`$ ${sig.how.startsWith('Ctrl') ? '(you press Ctrl+C in its terminal)' : sig.how}`];
    if (state === 'gone') {
      entries.push('bash: kill: (4300) - No such process');
    } else if (sig.name === 'SIGKILL') {
      entries.push('Kernel destroys the process at once. No handler runs, nothing is cleaned up.');
      entries.push('Left behind: /tmp/backup.lock and a half-written backup-2026-10-26.tar. The shell reports exit status 137 (128 + 9).');
      setPartial(true);
      setState('gone');
    } else if (sig.name === 'SIGSTOP') {
      entries.push('Process frozen (state T). It cannot catch or ignore SIGSTOP. It keeps its memory and open files.');
      setState('T');
    } else if (sig.name === 'SIGCONT') {
      if (state === 'T') {
        entries.push('Process resumes where it stopped (state S again).');
        if (pending) {
          entries.push(`The pending ${pending.name} is delivered now.`);
          deliver(pending, entries);
          setPending(null);
        } else setState('S');
      } else entries.push('Process was not stopped; SIGCONT has no visible effect.');
    } else if (state === 'T') {
      entries.push(`Process is stopped, so ${sig.name} stays pending until it is continued with SIGCONT. (Only SIGKILL acts on a stopped process immediately.)`);
      setPending(sig);
    } else {
      deliver(sig, entries);
    }
    setLog((l) => [...entries, ...l].slice(0, 16));
  };

  const reset = () => {
    setState('S');
    setLockFile(true);
    setPartial(false);
    setPending(null);
    setLog([]);
  };

  const stateLabel = state === 'S' ? 'S · sleeping/running normally' : state === 'T' ? 'T · stopped' : 'terminated';

  return (
    <div className="signal-demo">
      <div className="sig-top">
        <div className={`sig-proc state-${state}`} aria-live="polite">
          <div className="mono" style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
            PID 4300 · user analyst
          </div>
          <div className="mono" style={{ fontWeight: 600 }}>
            /bin/bash ./backup.sh
          </div>
          <div className="sig-state">STAT: {stateLabel}</div>
        </div>
        <div className="sig-files">
          <div className="mono" style={{ fontSize: '0.8rem', color: 'var(--muted)', marginBottom: '0.25rem' }}>
            files the script manages
          </div>
          <div className={`mono sig-file ${lockFile ? '' : 'removed'}`}>/tmp/backup.lock {lockFile ? (state === 'gone' ? '(stale!)' : '(held)') : '(removed)'}</div>
          <div className={`mono sig-file ${partial ? 'bad' : ''}`}>backup-2026-10-26.tar {partial ? '(corrupt, half-written)' : state === 'gone' ? '(complete)' : '(writing…)'}</div>
        </div>
      </div>

      <label className="sig-trap">
        <input type="checkbox" checked={trap} onChange={(e) => setTrap(e.target.checked)} disabled={state === 'gone'} />
        <span>
          Script has a cleanup handler: <code>trap cleanup TERM INT HUP</code>
        </span>
      </label>

      <div className="sig-buttons" role="group" aria-label="Send a signal">
        {SIGNALS.map((s) => (
          <button key={s.name} type="button" className={`btn btn-small ${s.name === 'SIGKILL' ? 'sig-kill' : ''}`} onClick={() => send(s)}>
            <span className="mono">{s.name}</span>
            <span className="sig-num">{s.num}</span>
          </button>
        ))}
        <button type="button" className="btn btn-small btn-quiet" onClick={reset}>
          Restart process
        </button>
      </div>
      <p className="perm-hint" style={{ margin: '0.3rem 0 0.6rem' }}>
        SIGKILL and SIGSTOP can never be caught, blocked or ignored. Everything else can be handled by the program.
      </p>
      <pre className="strace-line sig-log" aria-label="Signal log">
        <code>{log.length ? log.join('\n') : 'Send a signal to see what happens. Newest events appear at the top.'}</code>
      </pre>
    </div>
  );
}
