import { useState } from 'react';
import { Markdown } from '../../../components/Markdown';
import { toPoints, usePathAnimation, type Pt } from '../../../components/viz/usePathAnimation';

type BoxId = 'bash' | 'proc' | 'glibc' | 'sched' | 'mem' | 'vfs' | 'drv' | 'net' | 'cpu' | 'ram' | 'io' | 'disk' | 'nic';

interface Step {
  title: string;
  call?: string;
  text: string;
  mode: 'user' | 'kernel' | 'both';
  highlight: BoxId[];
  path: Pt[];
  procLabel: string;
}

const STEPS: Step[] = [
  {
    title: 'Ready',
    text: 'You are logged in and bash, the shell, is waiting for input. Press **Run** to type `cat file.txt` and follow it through the system.',
    mode: 'user',
    highlight: ['bash'],
    path: [[105, 75]],
    procLabel: '',
  },
  {
    title: '1. The shell reads your command',
    text: 'bash is an ordinary user-space program. It splits the line into words, finds the program `cat` by searching the directories in `PATH`, and decides it must start a new process. Nothing has touched the kernel yet.',
    mode: 'user',
    highlight: ['bash'],
    path: [[105, 75]],
    procLabel: '',
  },
  {
    title: '2. fork(): make a copy of the shell',
    call: 'clone(child_stack=NULL, flags=CLONE_CHILD_SETTID|SIGCHLD) = 2311',
    text: 'User programs cannot create processes themselves. bash asks the kernel with a system call (glibc’s `fork()` uses the `clone` syscall). The CPU switches to kernel mode, the scheduler creates a child process with a new PID that is a copy of bash, and both return to user space.',
    mode: 'both',
    highlight: ['bash', 'glibc', 'sched', 'proc'],
    path: [[105, 100], [105, 190], [90, 262], [90, 300], [90, 262], [295, 190], [295, 100]],
    procLabel: 'bash (child)',
  },
  {
    title: '3. execve(): replace the copy with cat',
    call: 'execve("/usr/bin/cat", ["cat", "file.txt"], 0x7ffc... /* 22 vars */) = 0',
    text: 'The child calls `execve`. The kernel checks that you have execute permission on `/usr/bin/cat`, reads the program from disk through the filesystem, maps it into the process’s memory, and starts it. Same PID, new program.',
    mode: 'both',
    highlight: ['proc', 'vfs', 'drv', 'disk', 'mem', 'ram'],
    path: [[295, 100], [295, 190], [360, 262], [495, 300], [495, 400], [495, 300], [225, 300], [225, 400], [225, 300], [295, 190], [295, 100]],
    procLabel: 'cat',
  },
  {
    title: '4. openat(): ask for the file',
    call: 'openat(AT_FDCWD, "file.txt", O_RDONLY) = 3',
    text: 'cat calls `open` (on modern systems the `openat` syscall). The kernel’s VFS layer walks the path, finds the file’s inode, and checks the permission bits against your user and groups. If allowed it returns a small integer, a **file descriptor** (here 3). If not, you get `EACCES`: “Permission denied”.',
    mode: 'both',
    highlight: ['proc', 'vfs'],
    path: [[295, 100], [295, 190], [360, 262], [360, 300], [360, 262], [295, 190], [295, 100]],
    procLabel: 'cat',
  },
  {
    title: '5. read(): get the bytes',
    call: 'read(3, "quarterly numbers\\n...", 131072) = 412',
    text: 'cat calls `read` on descriptor 3. The ext4 filesystem works out which disk blocks hold the data, and the block device driver fetches them from the disk (or straight from the page cache in RAM if the file was read recently). The kernel copies the bytes into cat’s buffer.',
    mode: 'both',
    highlight: ['proc', 'vfs', 'drv', 'disk', 'mem'],
    path: [[295, 100], [295, 190], [360, 262], [495, 300], [495, 400], [495, 300], [295, 190], [295, 100]],
    procLabel: 'cat',
  },
  {
    title: '6. write(): send the bytes to your screen',
    call: 'write(1, "quarterly numbers\\n...", 412) = 412',
    text: 'Descriptor 1 is standard output, which here is your terminal. The kernel’s terminal (tty) driver passes the text on. Over SSH it then goes through the network stack and the network card back to your laptop.',
    mode: 'both',
    highlight: ['proc', 'drv', 'net', 'nic', 'io'],
    path: [[295, 100], [295, 190], [495, 262], [630, 300], [630, 400]],
    procLabel: 'cat',
  },
  {
    title: '7. Clean up and exit',
    call: 'read(3, "", 131072) = 0\nclose(3) = 0\nexit_group(0) = ?',
    text: 'The next `read` returns 0 bytes: end of file. cat closes the descriptor and exits with status 0. The kernel frees its memory and tells the parent. bash was waiting for its child (`wait4`), wakes up, and prints a new prompt.',
    mode: 'both',
    highlight: ['proc', 'sched', 'bash'],
    path: [[295, 100], [295, 190], [90, 262], [90, 300], [90, 262], [105, 190], [105, 100]],
    procLabel: '(exited)',
  },
];

interface BoxDef {
  id: BoxId;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  sub?: string;
}

const BOXES: BoxDef[] = [
  { id: 'bash', x: 40, y: 48, w: 130, h: 52, label: 'bash', sub: 'your shell, PID 2210' },
  { id: 'proc', x: 230, y: 48, w: 130, h: 52, label: 'cat', sub: 'new process' },
  { id: 'glibc', x: 40, y: 114, w: 640, h: 34, label: 'C library (glibc): open(), read(), fork()… wrap the raw system calls' },
  { id: 'sched', x: 30, y: 258, w: 120, h: 58, label: 'Process', sub: 'scheduler' },
  { id: 'mem', x: 165, y: 258, w: 120, h: 58, label: 'Memory', sub: 'manager' },
  { id: 'vfs', x: 300, y: 258, w: 120, h: 58, label: 'VFS +', sub: 'filesystems' },
  { id: 'drv', x: 435, y: 258, w: 120, h: 58, label: 'Device', sub: 'drivers' },
  { id: 'net', x: 570, y: 258, w: 120, h: 58, label: 'Network', sub: 'stack' },
  { id: 'cpu', x: 30, y: 398, w: 120, h: 46, label: 'CPU' },
  { id: 'ram', x: 165, y: 398, w: 120, h: 46, label: 'RAM' },
  { id: 'io', x: 300, y: 398, w: 120, h: 46, label: 'Keyboard, screen' },
  { id: 'disk', x: 435, y: 398, w: 120, h: 46, label: 'Disk (SSD)' },
  { id: 'nic', x: 570, y: 398, w: 120, h: 46, label: 'Network card' },
];

export default function ArchitectureViz() {
  const [step, setStep] = useState(0);
  const s = STEPS[step];
  const { pos, progress } = usePathAnimation(s.path, step, 2200);
  const isOn = (id: BoxId) => s.highlight.includes(id);
  const procVisible = step >= 2;

  const layerFill = (layer: 'user' | 'kernel') => (s.mode === layer || s.mode === 'both' ? 1 : 0.55);

  return (
    <div className="arch-viz">
      <div className="controls" style={{ marginBottom: '0.8rem' }}>
        {step === 0 ? (
          <button type="button" className="btn btn-primary" onClick={() => setStep(1)}>
            Run <code>cat file.txt</code>
          </button>
        ) : (
          <>
            <button type="button" className="btn" onClick={() => setStep((n) => Math.max(1, n - 1))} disabled={step <= 1}>
              ← Back
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setStep((n) => Math.min(STEPS.length - 1, n + 1))} disabled={step === STEPS.length - 1}>
              Next step →
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setStep(0)}>
              Reset
            </button>
            <span className="mono" style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
              step {step}/{STEPS.length - 1}
            </span>
          </>
        )}
      </div>

      <div className="viz-scroll">
        <svg viewBox="0 0 720 470" role="img" aria-labelledby="arch-title arch-desc">
          <title id="arch-title">Linux architecture layers</title>
          <desc id="arch-desc">
            Four layers from top to bottom: user space with programs and the C library, the system call interface, kernel space with the scheduler,
            memory manager, filesystems, device drivers and network stack, and hardware. Current step: {s.title}.
          </desc>

          {/* User space */}
          <rect x="10" y="10" width="700" height="150" rx="10" fill="var(--d-user)" opacity={layerFill('user')} stroke="var(--d-stroke)" strokeWidth="1" />
          <text x="24" y="32" className="layer-label">USER SPACE · ring 3 · unprivileged</text>
          {/* Syscall band */}
          <rect x="10" y="170" width="700" height="40" rx="8" fill="var(--d-syscall)" stroke="var(--d-stroke)" strokeWidth="1" />
          <text x="24" y="195" className="layer-label">SYSTEM CALL INTERFACE</text>
          <text x="696" y="195" textAnchor="end" className="mono small-label">
            openat · read · write · close · clone · execve · exit_group · …
          </text>
          {/* Kernel space */}
          <rect x="10" y="220" width="700" height="140" rx="10" fill="var(--d-kernel)" opacity={layerFill('kernel')} stroke="var(--d-stroke)" strokeWidth="1" />
          <text x="24" y="242" className="layer-label">KERNEL SPACE · ring 0 · full access to hardware</text>
          {/* Hardware */}
          <rect x="10" y="370" width="700" height="90" rx="10" fill="var(--d-hw)" stroke="var(--d-stroke)" strokeWidth="1" />
          <text x="24" y="390" className="layer-label">HARDWARE</text>

          {BOXES.map((b) => {
            if (b.id === 'proc' && !procVisible) {
              return (
                <g key={b.id} opacity="0.5">
                  <rect x={b.x} y={b.y} width={b.w} height={b.h} rx="6" fill="none" stroke="var(--d-stroke)" strokeDasharray="4 4" />
                  <text x={b.x + b.w / 2} y={b.y + 31} textAnchor="middle" className="small-label">
                    (no process yet)
                  </text>
                </g>
              );
            }
            const on = isOn(b.id);
            const label = b.id === 'proc' ? s.procLabel : b.label;
            return (
              <g key={b.id} className={`arch-box${on ? ' on' : ''}`}>
                <rect x={b.x} y={b.y} width={b.w} height={b.h} rx="6" fill="var(--surface)" stroke={on ? 'var(--d-highlight)' : 'var(--d-stroke)'} strokeWidth={on ? 2.5 : 1} />
                <text x={b.x + b.w / 2} y={b.y + (b.sub ? b.h / 2 - 2 : b.h / 2 + 5)} textAnchor="middle" className={b.id === 'bash' || b.id === 'proc' ? 'mono box-label' : 'box-label'}>
                  {label}
                </text>
                {b.sub && (
                  <text x={b.x + b.w / 2} y={b.y + b.h / 2 + 15} textAnchor="middle" className="small-label">
                    {b.id === 'proc' && step >= 2 ? 'PID 2311' : b.sub}
                  </text>
                )}
              </g>
            );
          })}
          {/* other user programs for context */}
          <g opacity="0.6">
            <rect x="420" y="48" width="120" height="52" rx="6" fill="var(--surface)" stroke="var(--d-stroke)" />
            <text x="480" y="79" textAnchor="middle" className="mono box-label">sshd</text>
            <rect x="560" y="48" width="120" height="52" rx="6" fill="var(--surface)" stroke="var(--d-stroke)" />
            <text x="620" y="79" textAnchor="middle" className="mono box-label">nginx</text>
          </g>

          {s.path.length > 1 && (
            <polyline points={toPoints(s.path)} fill="none" stroke="var(--d-flow)" strokeWidth="2.5" strokeDasharray="6 5" strokeLinejoin="round" opacity="0.75" />
          )}
          {step > 0 && <circle cx={pos[0]} cy={pos[1]} r="8" fill="var(--d-highlight)" stroke="var(--surface)" strokeWidth="2" opacity={progress < 1 || s.path.length === 1 ? 1 : 0.9} />}
        </svg>
      </div>

      <div className="explain-panel" aria-live="polite">
        <h4>{s.title}</h4>
        <p style={{ fontSize: '0.82rem', color: 'var(--muted)', margin: '0 0 0.4rem' }}>
          CPU mode:{' '}
          <strong>{s.mode === 'user' ? 'user mode only' : 'user mode → kernel mode (inside the system call) → back to user mode'}</strong>
        </p>
        {s.call && (
          <pre className="strace-line">
            <code>{s.call}</code>
          </pre>
        )}
        <Markdown text={s.text} />
      </div>
    </div>
  );
}
