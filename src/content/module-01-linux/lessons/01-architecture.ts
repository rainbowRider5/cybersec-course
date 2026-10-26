import type { Lesson } from '../../../course/types';
import { chunks } from '../../../course/chunks';
import raw from './01-architecture.md?raw';
import ArchitectureViz from '../visualizations/ArchitectureViz';
import { architectureScenario, lastOut, ran } from '../scenarios';

const t = chunks(raw);

const lesson: Lesson = {
  slug: 'architecture',
  title: 'Linux architecture',
  summary: 'Hardware, kernel, system calls and user space: how a command really gets from your keyboard to the disk and back.',
  estimatedMinutes: 35,
  objectives: [
    'Describe the four layers of a Linux system and what lives in each.',
    'Explain the difference between kernel space and user space, and why root is still user space.',
    'List the main jobs of the kernel.',
    'Explain what a system call is and trace the syscalls behind `cat file.txt`.',
    'Say why syscalls, kernel versions and kernel modules matter to defenders.',
  ],
  sections: [
    { id: 'what-is-linux', title: 'Linux, the kernel and distributions', blocks: [t('linux-intro')] },
    { id: 'layers', title: 'Four layers', blocks: [t('layers')] },
    { id: 'kernel-vs-user', title: 'Kernel space and user space', blocks: [t('modes')] },
    { id: 'kernel-jobs', title: 'What the kernel does', blocks: [t('jobs')] },
    {
      id: 'syscalls',
      title: 'System calls',
      blocks: [
        t('syscalls'),
        t('viz-intro'),
        {
          kind: 'viz',
          title: 'Follow `cat file.txt` through the system',
          component: ArchitectureViz,
          caption: 'The `strace`-style lines show the real syscalls. Exact arguments vary between systems.',
        },
        t('after-viz'),
      ],
    },
    {
      id: 'practice',
      title: 'Practice: look at the layers from the shell',
      blocks: [
        t('practice'),
        {
          kind: 'terminal',
          title: 'web01: analyst',
          scenario: architectureScenario(),
          intro: 'Type `help` to see the available commands.',
          tasks: [
            {
              id: 'kernel-version',
              solution: ['uname -r'],
              instruction: 'Find out which kernel version this server is running.',
              hint: '`uname -r` prints just the kernel release; `uname -a` prints everything.',
              check: (s) => ran(s, /^uname\b.*-[a-z]*[ra]/) || (ran(s, /cat \/proc\/version/) && lastOut(s).includes('6.8.0')),
              success: 'Kernel `6.8.0-45-generic`. Security advisories name the kernel versions they affect, so this is often the first thing you check.',
            },
            {
              id: 'proc-1',
              solution: ['cat /proc/1/cmdline'],
              instruction: 'The kernel exposes live information as files under `/proc`. Read the command line of PID 1 from `/proc/1/cmdline`.',
              hint: '`cat /proc/1/cmdline`',
              check: (s) => ran(s, /cat\s+\/proc\/1\/cmdline/) && lastOut(s).includes('/sbin/init'),
              success: 'PID 1 was started as `/sbin/init`, which on this system is systemd. You will meet it again in the boot lesson.',
            },
            {
              id: 'denied',
              solution: ['cat /etc/shadow'],
              instruction: 'As `analyst`, try to read `/etc/shadow` with `cat`. Watch the kernel refuse the `openat` call.',
              hint: '`cat /etc/shadow`, without sudo.',
              check: (s) => ran(s, /^cat\s+\/etc\/shadow/) && s.user === 'analyst',
              success: '“Permission denied” is the kernel returning `EACCES` from `openat`. `cat` only printed the error.',
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
      { instruction: 'Check which distribution and kernel you are running.', command: 'cat /etc/os-release\nuname -r' },
      {
        instruction: 'Watch the system calls `cat` makes. `-e trace=` limits the output to the calls from the diagram.',
        command: 'strace -e trace=openat,read,write,close cat /etc/hostname',
        note: 'Most `openat` lines are the program loading shared libraries such as `libc.so.6`. Your file is near the end.',
      },
      {
        instruction: 'Now ask for a file you are not allowed to read and find the failing syscall.',
        command: 'strace -e trace=openat cat /etc/shadow',
        note: 'Look for `= -1 EACCES (Permission denied)`.',
      },
      { instruction: 'Count how many syscalls of each type a command makes.', command: 'strace -c ls / > /dev/null' },
      { instruction: 'List loaded kernel modules and count them.', command: 'lsmod | head\nlsmod | wc -l' },
      { instruction: 'Peek at the virtual files the kernel generates.', command: 'head /proc/cpuinfo\nhead -3 /proc/meminfo\nls /proc | head' },
    ],
  },
  quiz: [
    {
      id: 'm1-arch-kernel-space',
      type: 'single',
      section: 'kernel-vs-user',
      prompt: 'Which of these runs in **kernel space**?',
      options: ['`bash`, the shell', 'The ext4 filesystem driver', 'The C library `glibc`', '`sshd`, the SSH server'],
      answer: 1,
      explanation: 'Filesystem code such as ext4 is part of the kernel. bash, sshd and glibc are all user-space code; even sshd running as root is a user-space process.',
    },
    {
      id: 'm1-arch-kernel-jobs',
      type: 'multi',
      section: 'kernel-jobs',
      prompt: 'Which of these are jobs of the Linux kernel? Select all that apply.',
      options: ['Deciding which process runs on which CPU core', 'Drawing the shell prompt', 'Keeping each process’s memory separate', 'Talking to the network card through a driver', 'Splitting a command line into words'],
      answers: [0, 2, 3],
      explanation: 'Scheduling, memory isolation and device drivers are kernel jobs. Drawing the prompt and parsing the command line are done by the shell, a user-space program.',
    },
    {
      id: 'm1-arch-syscall-def',
      type: 'single',
      section: 'syscalls',
      prompt: 'What is a system call?',
      options: [
        'A command typed at the shell prompt',
        'A controlled entry point a user-space program uses to ask the kernel to do something on its behalf',
        'A message the kernel writes to `/var/log/syslog`',
        'A function inside the program that runs faster than normal code',
      ],
      answer: 1,
      explanation: 'A syscall switches the CPU into kernel mode at a fixed entry point; the kernel checks the request, does the work and returns. Opening files, starting programs and network I/O all go through syscalls.',
    },
    {
      id: 'm1-arch-order-cat',
      type: 'order',
      section: 'syscalls',
      prompt: 'Put the system calls involved in running `cat file.txt` from a shell in the order they happen.',
      items: ['`clone` (fork): the shell creates a child process', '`execve`: the child becomes `cat`', '`openat`: open file.txt', '`read`: get the file’s bytes', '`write`: send them to standard output', '`close` and `exit_group`: clean up and exit'],
      explanation: 'fork, then exec, then open, read, write, and finally close and exit. The shell waits for the child, then prints a new prompt.',
    },
    {
      id: 'm1-arch-strace-eacces',
      type: 'output',
      section: 'syscalls',
      prompt: 'A user runs a program under strace. What does this line tell you?',
      exhibit: { label: 'strace output', text: 'openat(AT_FDCWD, "/etc/shadow", O_RDONLY) = -1 EACCES (Permission denied)' },
      options: [
        'The file does not exist',
        'The kernel refused to open the file because the user lacks read permission',
        'The disk is faulty',
        'The program opened the file successfully as descriptor 1',
      ],
      answer: 1,
      explanation: 'A return value of -1 means the call failed, and `EACCES` is the permission-denied error. A missing file would show `ENOENT (No such file or directory)`.',
    },
    {
      id: 'm1-arch-fd',
      type: 'text',
      section: 'syscalls',
      prompt: 'When `open`/`openat` succeeds, the kernel returns a small integer the program uses in later `read` and `write` calls. What is it called?',
      accepted: ['file descriptor', 'a file descriptor', 'fd', 'file descriptors', 'descriptor'],
      placeholder: 'two words',
      explanation: 'A **file descriptor**. 0, 1 and 2 are standard input, output and error; the first file a program opens usually gets 3.',
    },
    {
      id: 'm1-arch-root-user-space',
      type: 'single',
      section: 'kernel-vs-user',
      prompt: 'A process is running as root. Where does it run?',
      options: [
        'In kernel space, because root has full privileges',
        'In user space. Root is an identity the kernel’s permission checks favour, not a CPU mode',
        'Half in user space, half in kernel space',
        'In ring 0 on x86',
      ],
      answer: 1,
      explanation: 'Root processes are normal user-space processes. They still make syscalls; the kernel just allows more of them.',
    },
    {
      id: 'm1-arch-crash',
      type: 'single',
      section: 'kernel-vs-user',
      prompt: 'A bug crashes an ordinary program such as a text editor. What normally happens?',
      options: ['The kernel panics and the machine stops', 'Only that process is terminated; everything else keeps running', 'All programs of that user crash', 'The filesystem is corrupted'],
      answer: 1,
      explanation: 'User-space isolation means a crashing process only takes itself down. A crash inside the kernel, by contrast, is a kernel panic and stops the whole system.',
    },
    {
      id: 'm1-arch-rootkit',
      type: 'single',
      section: 'security',
      prompt: 'Why is a kernel-mode rootkit so much harder to detect than malware in user space?',
      options: [
        'It is always encrypted',
        'It runs with kernel privileges and can change what system calls return, so tools like `ps` and `ls` are shown a false picture',
        'It only runs at night',
        'Linux has no tools that list processes',
      ],
      answer: 1,
      explanation: 'Every tool learns about files and processes by asking the kernel. If the kernel itself is compromised it can hide anything, which is why defenders rely on Secure Boot, module signing and offline or memory analysis.',
    },
    {
      id: 'm1-arch-uname',
      type: 'text',
      section: 'practice',
      prompt: 'Type a command that shows the version of the running kernel.',
      accepted: ['uname -r', 'uname -a', 'uname -sr', 'uname -rs', 'cat /proc/version', 'uname --kernel-release', 'hostnamectl'],
      placeholder: 'command',
      explanation: '`uname -r` prints the kernel release (for example `6.8.0-45-generic`); `uname -a` prints it along with the hostname and architecture.',
    },
  ],
};

export default lesson;
