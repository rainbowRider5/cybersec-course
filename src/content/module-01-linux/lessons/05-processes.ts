import type { Lesson } from '../../../course/types';
import { chunks } from '../../../course/chunks';
import raw from './05-processes.md?raw';
import ProcessTree from '../visualizations/ProcessTree';
import SignalDemo from '../visualizations/SignalDemo';
import { processScenario, ran } from '../scenarios';
import type { TerminalState } from '../../../terminal/types';

const t = chunks(raw);

const alive = (s: TerminalState, pid: number) => s.processes.some((p) => p.pid === pid);
const sent = (s: TerminalState, pid: number, sig: string) => s.signals.some((x) => x.pid === pid && x.signal === sig);

const lesson: Lesson = {
  slug: 'processes',
  title: 'Processes and services',
  summary: 'Programs versus processes, PIDs and the process tree, fork and exec, states, signals, foreground and background jobs, systemd units and cron.',
  estimatedMinutes: 50,
  objectives: [
    'Explain the difference between a program and a process, and what PID and PPID mean.',
    'Describe how fork and exec start a command, and what zombies and orphans are.',
    'Read `ps aux`, `ps -ef` and process state codes.',
    'Choose the right signal: SIGTERM first, SIGKILL as a last resort.',
    'Manage services with `systemctl` and explain what “enable” really does.',
    'Read and write crontab schedules.',
  ],
  sections: [
    { id: 'program-process', title: 'Programs and processes', blocks: [t('program-process')] },
    { id: 'tree', title: 'PIDs, PPIDs and the process tree', blocks: [t('tree')] },
    {
      id: 'fork-exec',
      title: 'fork and exec',
      blocks: [t('fork-exec'), { kind: 'viz', title: 'Process tree: watch a command start and finish', component: ProcessTree, caption: 'Use Step → to go at your own pace. The listing on the right updates like `ps -ef`.' }],
    },
    { id: 'states', title: 'Process states', blocks: [t('states')] },
    { id: 'ps-top', title: 'Looking at processes: ps and top', blocks: [t('ps-top')] },
    {
      id: 'signals',
      title: 'Signals',
      blocks: [t('signals'), { kind: 'viz', title: 'Signal demo: SIGTERM versus SIGKILL', component: SignalDemo, caption: 'Toggle the cleanup handler and compare what is left behind.' }],
    },
    { id: 'jobs', title: 'Foreground and background', blocks: [t('jobs')] },
    { id: 'systemd', title: 'Services with systemd', blocks: [t('systemd')] },
    { id: 'cron', title: 'Scheduled jobs: cron and timers', blocks: [t('cron')] },
    {
      id: 'practice',
      title: 'Practice: deal with misbehaving processes',
      blocks: [
        t('practice'),
        {
          kind: 'terminal',
          title: 'web01: analyst',
          scenario: processScenario(),
          tall: true,
          tasks: [
            {
              id: 'find-cpu',
              solution: ['ps aux'],
              instruction: 'List all processes with their CPU usage and find the one using almost 100% CPU.',
              hint: '`ps aux` shows a %CPU column.',
              check: (s) => ran(s, /^ps\s+(aux|-aux|axu|-ef|-e)/),
              success: 'PID 4242, `python3 /home/analyst/stress.py`, owned by you. Its PPID is 1 because the shell that started it is gone.',
            },
            {
              id: 'term-4242',
              solution: ['kill 4242'],
              instruction: 'Stop PID 4242 politely, with SIGTERM.',
              hint: '`kill 4242` sends SIGTERM by default.',
              check: (s) => sent(s, 4242, 'SIGTERM') && !alive(s, 4242),
              success: 'It exited on SIGTERM. Check with `ps aux` that it is gone.',
            },
            {
              id: 'stuck',
              solution: ['kill 4310', 'ps -p 4310', 'kill -9 4310'],
              instruction: '`stuck-worker` (PID 4310) is hung. Send it SIGTERM, confirm with `ps` that it ignored it, then force it to stop.',
              hint: '`kill 4310`, then `ps -p 4310`, then `kill -9 4310` (or `kill -KILL 4310`).',
              check: (s) => sent(s, 4310, 'SIGTERM') && sent(s, 4310, 'SIGKILL') && !alive(s, 4310),
              success: 'SIGKILL cannot be caught, so the kernel removed it. Escalating from TERM to KILL is the standard approach.',
            },
            {
              id: 'tree',
              solution: ['pstree -p'],
              instruction: 'Show the process tree with PIDs and find the parent of your shell.',
              hint: '`pstree -p`, or `ps -o pid,ppid,cmd -p 2210`',
              check: (s) => ran(s, /^pstree\b.*-p|^ps\b.*-o\s+\S*ppid/),
              success: 'Your `bash` (2210) is a child of `sshd: analyst@pts/0` (2209), which is a child of the privileged sshd (2201) under the listener (812).',
            },
            {
              id: 'nginx',
              solution: ['sudo systemctl disable --now nginx'],
              instruction: 'This is a test box: nginx should not run or start at boot. Stop and disable it with **one** command.',
              hint: '`sudo systemctl disable --now nginx`',
              check: (s) => {
                const n = s.services.find((x) => x.name === 'nginx');
                return !!n && !n.enabled && !n.active;
              },
              success: '`disable --now` removed the boot-time symlink and stopped the running service. Check with `systemctl status nginx`.',
            },
          ],
        },
      ],
    },
  ],
  security: [t('security')],
  tryIt: {
    intro: t('try-intro'),
    steps: [
      { instruction: 'Look at the tree and find your own shell.', command: 'pstree -p | head -30\necho $$          # PID of the current shell\nps -o pid,ppid,user,stat,cmd -p $$' },
      { instruction: 'Watch a zombie-free life cycle with job control.', command: 'sleep 300 &\njobs\nps -o pid,ppid,stat,cmd --ppid $$\nfg %1            # then press Ctrl+Z\nbg\nkill %1' },
      { instruction: 'Compare SIGTERM with a handler and SIGKILL.', command: "bash -c 'trap \"echo cleaning up; exit\" TERM; while true; do sleep 1; done' &\nkill $!          # SIGTERM: prints 'cleaning up'\nbash -c 'trap \"echo cleaning up; exit\" TERM; while true; do sleep 1; done' &\nkill -9 $!       # SIGKILL: no message", note: '`$!` is the PID of the most recent background job.' },
      { instruction: 'Explore systemd.', command: 'systemctl list-units --type=service --state=running\nsystemctl status ssh        # sshd on RHEL\nsystemctl cat ssh\nls -l /etc/systemd/system/multi-user.target.wants/' },
      { instruction: 'Check scheduled jobs everywhere they can hide.', command: 'crontab -l\nsudo cat /etc/crontab\nls -l /etc/cron.d /etc/cron.daily\nsystemctl list-timers' },
      { instruction: 'Check a process’s binary and open network connections.', command: 'sudo ls -l /proc/1/exe\nsudo ss -tnp' },
    ],
  },
  quiz: [
    {
      id: 'm1-proc-program-vs-process',
      type: 'single',
      section: 'program-process',
      prompt: 'Which statement best describes the difference between a program and a process?',
      options: [
        'They are the same thing',
        'A program is a file on disk; a process is a running instance of it, with its own PID, memory and owner',
        'A process is a program that has been compiled',
        'Programs run in kernel space, processes in user space',
      ],
      answer: 1,
      explanation: 'The program is the file; each time it runs, the kernel creates a process for it. One program can be running as many processes at once.',
    },
    {
      id: 'm1-proc-order',
      type: 'order',
      section: 'fork-exec',
      prompt: 'Put the life of a foreground command started from bash in order.',
      items: ['bash calls fork(): a child copy of bash gets a new PID', 'The child calls execve() and becomes the new program', 'bash waits for the child', 'The program exits and becomes a zombie', 'bash collects the exit status and the zombie is removed'],
      explanation: 'fork → exec → wait → exit (zombie) → reaped. The exit status ends up in `$?`.',
    },
    {
      id: 'm1-proc-catchable',
      type: 'single',
      section: 'signals',
      prompt: 'Which signal can a program catch to clean up before exiting?',
      options: ['SIGKILL', 'SIGSTOP', 'SIGTERM', 'None of them'],
      answer: 2,
      explanation: 'SIGTERM can be caught and handled. SIGKILL and SIGSTOP can never be caught, blocked or ignored.',
    },
    {
      id: 'm1-proc-sigkill-num',
      type: 'text',
      section: 'signals',
      prompt: 'What is the signal number of SIGKILL (as in `kill -<number> PID`)?',
      accepted: ['9', '-9'],
      placeholder: 'number',
      explanation: '`kill -9` is SIGKILL. SIGTERM, the default for `kill`, is 15.',
    },
    {
      id: 'm1-proc-webshell',
      type: 'output',
      section: 'tree',
      prompt: 'Part of `ps -ef` on a web server. Which line is the strongest sign of compromise?',
      exhibit: {
        label: '$ ps -ef',
        text: 'UID        PID  PPID  C STIME TTY          TIME CMD\nroot       702     1  0 08:01 ?        00:00:00 nginx: master process /usr/sbin/nginx\nwww-data   703   702  0 08:01 ?        00:00:03 nginx: worker process\nwww-data  5120   703  0 03:44 ?        00:00:00 sh -c bash -i\nwww-data  5121  5120  0 03:44 ?        00:00:00 bash -i\nanalyst   2210  2209  0 09:02 pts/0    00:00:00 -bash',
      },
      options: ['PID 702: nginx runs as root', 'PID 703: the worker runs as www-data', 'PIDs 5120/5121: an interactive shell whose parent is the nginx worker', 'PID 2210: a login shell'],
      answer: 2,
      explanation: 'nginx never needs to start an interactive shell. A shell parented by a web server is the classic sign of a web shell or exploited application. The master running as root and workers as www-data is normal.',
    },
    {
      id: 'm1-proc-zombie',
      type: 'single',
      section: 'fork-exec',
      prompt: 'What is a zombie process?',
      options: [
        'A process using 100% CPU',
        'A process that has exited but whose parent has not yet collected its exit status',
        'Malware that restarts itself',
        'A process with no controlling terminal',
      ],
      answer: 1,
      explanation: 'A zombie (state `Z`, `<defunct>`) has finished; only its process-table entry remains until the parent calls wait(). It cannot be killed, because it is already dead.',
    },
    {
      id: 'm1-proc-cron',
      type: 'output',
      section: 'cron',
      prompt: 'When does this job run?',
      exhibit: { label: 'crontab -l', text: '*/15 2 * * 1  /usr/local/bin/sync.sh' },
      options: ['Every 15 minutes, every day', 'At 02:15 every day', 'Every 15 minutes between 02:00 and 02:59, on Mondays', 'At 15:02 on the 1st of every month'],
      answer: 2,
      explanation: 'minute `*/15` (0, 15, 30, 45), hour `2`, any day of month, any month, day of week `1` (Monday). So 02:00, 02:15, 02:30 and 02:45 every Monday.',
    },
    {
      id: 'm1-proc-enable',
      type: 'single',
      section: 'systemd',
      prompt: 'What does `sudo systemctl enable nginx` do?',
      options: [
        'Starts nginx right now',
        'Configures nginx to start automatically at boot, by creating a symlink in the target’s .wants directory; it does not start it now',
        'Installs nginx',
        'Restarts nginx and enables logging',
      ],
      answer: 1,
      explanation: '`enable` is about boot time only. To start it now as well, use `enable --now` or a separate `start`.',
    },
    {
      id: 'm1-proc-state-d',
      type: 'single',
      section: 'states',
      prompt: 'A process shows state `D` in `ps` and will not die even with SIGKILL. What is going on?',
      options: [
        'It is a zombie',
        'It is in uninterruptible sleep, usually waiting for disk or network storage I/O; it will handle the signal once the I/O completes',
        'It is a daemon',
        'It has been deleted from disk',
      ],
      answer: 1,
      explanation: '`D` is uninterruptible sleep. The kill is pending until the kernel finishes the I/O. Many `D` processes often point to a storage problem such as a hung NFS mount.',
    },
    {
      id: 'm1-proc-term-kill',
      type: 'terminal',
      section: 'signals',
      prompt: 'A runaway script is hogging the CPU. Find it and stop it **gracefully** (SIGTERM, not SIGKILL).',
      scenario: processScenario(),
      task: {
        id: 'stop-4242',
        solution: ['kill 4242'],
        instruction: 'Find the process using nearly 100% CPU and send it SIGTERM.',
        hint: '`ps aux`, then `kill <PID>`.',
        check: (s) => sent(s, 4242, 'SIGTERM') && !alive(s, 4242) && !sent(s, 4242, 'SIGKILL'),
      },
      explanation: '`ps aux` shows `python3 /home/analyst/stress.py` with PID 4242 at ~99% CPU. `kill 4242` sends SIGTERM, giving it a chance to clean up.',
    },
  ],
};

export default lesson;
