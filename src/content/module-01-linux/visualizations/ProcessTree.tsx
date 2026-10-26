import { useEffect, useState } from 'react';
import { Markdown } from '../../../components/Markdown';
import { useReducedMotion } from '../../../hooks/useReducedMotion';

interface Proc {
  pid: number;
  ppid: number;
  user: string;
  cmd: string;
  stat: string;
}

const BASE: Proc[] = [
  { pid: 1, ppid: 0, user: 'root', cmd: 'systemd', stat: 'Ss' },
  { pid: 640, ppid: 1, user: 'root', cmd: 'cron -f', stat: 'Ss' },
  { pid: 812, ppid: 1, user: 'root', cmd: 'sshd: [listener]', stat: 'Ss' },
  { pid: 2201, ppid: 812, user: 'root', cmd: 'sshd: analyst [priv]', stat: 'Ss' },
  { pid: 2209, ppid: 2201, user: 'analyst', cmd: 'sshd: analyst@pts/0', stat: 'S' },
  { pid: 2210, ppid: 2209, user: 'analyst', cmd: '-bash', stat: 'Ss' },
];

type Mode = 'fg' | 'bg';
interface Phase {
  label: string;
  text: string;
  child?: { cmd: string; stat: string; dashed?: boolean };
  bashStat: string;
}

const FG: Phase[] = [
  { label: 'Prompt', text: 'bash is idle at the prompt, sleeping until you type something (state **S**, interruptible sleep).', bashStat: 'Ss' },
  {
    label: 'fork()',
    text: '**fork**: bash asks the kernel to duplicate it. The child gets a new PID (2311) and its PPID is bash’s PID (2210). For a moment it is still running bash’s code.',
    child: { cmd: '-bash', stat: 'R+', dashed: true },
    bashStat: 'Ss',
  },
  {
    label: 'exec()',
    text: '**exec**: the child calls `execve("/usr/bin/ls", …)`. The kernel throws away the copied bash program and loads `ls` into the same process. Same PID, new program.',
    child: { cmd: 'ls -l', stat: 'R+' },
    bashStat: 'Ss',
  },
  {
    label: 'wait()',
    text: 'Because this is a **foreground** job, bash calls `wait` and sleeps until the child finishes. The `+` in STAT means “in the foreground process group of its terminal”.',
    child: { cmd: 'ls -l', stat: 'R+' },
    bashStat: 'Ss',
  },
  {
    label: 'exit()',
    text: '`ls` finishes and exits with status 0. Until its parent collects that status, the dead process stays in the table as a **zombie** (state **Z**, shown as `<defunct>`). It uses no CPU or memory, just a slot in the table.',
    child: { cmd: '[ls] <defunct>', stat: 'Z+' },
    bashStat: 'Ss',
  },
  {
    label: 'reaped',
    text: 'bash’s `wait` returns the exit status (available as `$?`), the kernel removes the zombie, and bash prints a new prompt. A parent that never waits for its children leaves zombies piling up.',
    bashStat: 'Ss',
  },
];

const BG: Phase[] = [
  { label: 'Prompt', text: 'bash is idle at the prompt.', bashStat: 'Ss' },
  {
    label: 'fork()',
    text: 'You typed `sleep 300 &`. The trailing `&` means **background**. bash forks exactly as before: new PID 2311, PPID 2210.',
    child: { cmd: '-bash', stat: 'R', dashed: true },
    bashStat: 'Ss',
  },
  { label: 'exec()', text: 'The child execs `sleep`. It now sleeps for 300 seconds (state **S**).', child: { cmd: 'sleep 300', stat: 'S' }, bashStat: 'Ss' },
  {
    label: 'no wait',
    text: 'bash does **not** wait. It prints `[1] 2311` (job number and PID) and gives you the prompt back immediately. `jobs` lists background jobs; `fg %1` brings this one to the foreground; Ctrl+Z then `bg` sends a foreground job to the background.',
    child: { cmd: 'sleep 300', stat: 'S' },
    bashStat: 'Ss',
  },
  {
    label: 'logout?',
    text: 'If you log out, the terminal hangs up and the job is normally sent **SIGHUP** and ends. `nohup` or `setsid` detach it. Attackers use the same tricks to keep tools running after they disconnect, often reparented to PID 1.',
    child: { cmd: 'sleep 300', stat: 'S' },
    bashStat: 'Ss',
  },
];

// layout: x per depth, y per row
const POS: Record<number, [number, number]> = {
  1: [10, 20],
  640: [94, 76],
  812: [94, 132],
  2201: [178, 188],
  2209: [262, 244],
  2210: [346, 300],
};
const CHILD_POS: [number, number] = [430, 356];
const W = 160;
const H = 38;

export default function ProcessTree() {
  const [mode, setMode] = useState<Mode>('fg');
  const [phase, setPhase] = useState(0);
  const [playing, setPlaying] = useState(false);
  const reduced = useReducedMotion();
  const phases = mode === 'fg' ? FG : BG;
  const p = phases[phase];

  useEffect(() => {
    if (!playing) return;
    if (phase >= phases.length - 1) {
      setPlaying(false);
      return;
    }
    const t = window.setTimeout(() => setPhase((n) => n + 1), reduced ? 2600 : 1900);
    return () => window.clearTimeout(t);
  }, [playing, phase, phases.length, reduced]);

  const procs: Proc[] = BASE.map((b) => (b.pid === 2210 ? { ...b, stat: p.bashStat } : b));
  if (p.child) procs.push({ pid: 2311, ppid: 2210, user: 'analyst', cmd: p.child.cmd, stat: p.child.stat });

  const start = (m: Mode) => {
    setMode(m);
    setPhase(1);
    setPlaying(true);
  };

  return (
    <div className="ptree">
      <div className="controls" style={{ marginBottom: '0.8rem' }}>
        <button type="button" className="btn btn-primary btn-small" onClick={() => start('fg')}>
          Run <code>ls -l</code> (foreground)
        </button>
        <button type="button" className="btn btn-small" onClick={() => start('bg')}>
          Run <code>sleep 300 &amp;</code> (background)
        </button>
        <span className="spacer" style={{ flex: 1 }} />
        <button type="button" className="btn btn-small" onClick={() => { setPlaying(false); setPhase((n) => Math.max(0, n - 1)); }} disabled={phase === 0}>
          ← Step
        </button>
        <button type="button" className="btn btn-small" onClick={() => { setPlaying(false); setPhase((n) => Math.min(phases.length - 1, n + 1)); }} disabled={phase === phases.length - 1}>
          Step →
        </button>
      </div>

      <ol className="phase-track" aria-label={`${mode === 'fg' ? 'Foreground' : 'Background'} command phases`}>
        {phases.map((ph, i) => (
          <li key={ph.label} className={i === phase ? 'current' : i < phase ? 'past' : ''} aria-current={i === phase ? 'step' : undefined}>
            {ph.label}
          </li>
        ))}
      </ol>

      <div className="ptree-body">
        <div className="viz-scroll">
          <svg viewBox="0 0 600 410" role="img" aria-labelledby="pt-t pt-d">
            <title id="pt-t">Process tree</title>
            <desc id="pt-d">{procs.map((x) => `${x.cmd} PID ${x.pid}, parent ${x.ppid}, state ${x.stat}`).join('; ')}</desc>
            {procs
              .filter((x) => x.ppid !== 0)
              .map((x) => {
                const [px, py] = POS[x.ppid];
                const [cx, cy] = x.pid === 2311 ? CHILD_POS : POS[x.pid];
                const sx = px + 18;
                const sy = py + H;
                return (
                  <path
                    key={`e${x.pid}`}
                    d={`M${sx} ${sy} V${cy + H / 2} H${cx}`}
                    fill="none"
                    stroke={x.pid === 2311 ? 'var(--d-highlight)' : 'var(--d-stroke)'}
                    strokeWidth={x.pid === 2311 ? 2 : 1.2}
                    strokeDasharray={x.pid === 2311 && p.child?.dashed ? '5 4' : undefined}
                  />
                );
              })}
            {procs.map((x) => {
              const [nx, ny] = x.pid === 2311 ? CHILD_POS : POS[x.pid];
              const isChild = x.pid === 2311;
              const zombie = x.stat.startsWith('Z');
              return (
                <g key={x.pid} className={`pnode${isChild ? ' child' : ''}`}>
                  <rect
                    x={nx}
                    y={ny}
                    width={W}
                    height={H}
                    rx="6"
                    fill={zombie ? 'var(--surface-2)' : isChild ? 'var(--accent-soft)' : 'var(--surface)'}
                    stroke={isChild ? 'var(--d-highlight)' : x.pid === 2210 ? 'var(--accent)' : 'var(--d-stroke)'}
                    strokeWidth={isChild || x.pid === 2210 ? 2 : 1}
                    strokeDasharray={zombie ? '4 3' : undefined}
                  />
                  <text x={nx + 10} y={ny + 16} className="mono small-label">
                    PID {x.pid} · {x.stat}
                  </text>
                  <text x={nx + 10} y={ny + 31} className="mono box-label" style={{ fontSize: 12.5 }}>
                    {x.cmd.length > 19 ? x.cmd.slice(0, 18) + '…' : x.cmd}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        <div className="ptree-side">
          <div className="explain-panel" aria-live="polite" style={{ marginTop: 0 }}>
            <h4>{p.label}</h4>
            <Markdown text={p.text} />
          </div>
          <pre className="strace-line ps-out" aria-label="ps -ef style listing">
            <code>
              {'  PID  PPID USER     STAT CMD\n' +
                procs.map((x) => `${String(x.pid).padStart(5)} ${String(x.ppid).padStart(5)} ${x.user.padEnd(8)} ${x.stat.padEnd(4)} ${x.cmd}`).join('\n')}
            </code>
          </pre>
        </div>
      </div>
    </div>
  );
}
