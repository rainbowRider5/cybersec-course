import type { ModuleContent } from '../../course/types';
import { hardeningScenario, lastOut, modeOf, permissionsScenario, processScenario, ran, shellScenario } from './scenarios';

/** Questions that only appear in the Module 1 final test, each tagged with the lesson it covers. */
export const finalTest: ModuleContent['finalTest'] = {
  questionCount: 25,
  passMark: 0.8,
  extraQuestions: [
    {
      lesson: 'architecture',
      question: {
        id: 'm1-final-arch-syscall-match',
        type: 'single',
        section: 'syscalls',
        prompt: 'An EDR alert says: “process `bash` called `execve(\"/tmp/.x/upd\")`”. In plain words, what happened?',
        options: ['bash opened a file for reading', 'bash started a new program, `/tmp/.x/upd`', 'bash deleted `/tmp/.x/upd`', 'bash connected to a remote server'],
        answer: 1,
        explanation: '`execve` replaces a process’s program with another, which is how every program is started. A program launched from a hidden directory in /tmp is worth investigating.',
      },
    },
    {
      lesson: 'boot',
      question: {
        id: 'm1-final-boot-chain',
        type: 'single',
        section: 'firmware',
        prompt: 'With Secure Boot enabled, which component verifies GRUB’s signature on a typical Ubuntu system?',
        options: ['The kernel', 'systemd', 'shim', 'The initramfs'],
        answer: 2,
        explanation: 'The firmware verifies shim (signed by Microsoft’s UEFI key), shim verifies GRUB (signed by the distribution), and GRUB verifies the kernel.',
      },
    },
    {
      lesson: 'filesystem',
      question: {
        id: 'm1-final-fs-deleted',
        type: 'output',
        section: 'security',
        prompt: 'What does this tell an investigator?',
        exhibit: { label: '$ sudo ls -l /proc/5120/exe', text: 'lrwxrwxrwx 1 www-data www-data 0 Oct 26 03:44 /proc/5120/exe -> /tmp/.cache/kworker (deleted)' },
        options: [
          'Nothing unusual; kernel workers live in /tmp',
          'Process 5120 runs a binary that was deleted from disk after starting, from a hidden directory in /tmp, with a name imitating a kernel thread: strong indicators of malware',
          'The process has crashed',
          '/proc is corrupted',
        ],
        answer: 1,
        explanation: 'Real kernel threads have no executable file at all. A user process named like one, running from /tmp and deleted after launch, is a classic malware pattern. The binary can still be recovered by copying /proc/5120/exe.',
      },
    },
    {
      lesson: 'permissions',
      question: {
        id: 'm1-final-perm-symbolic-to-octal',
        type: 'text',
        section: 'special',
        prompt: 'What is the full four-digit octal mode of `-rwsr-xr-x`?',
        accepted: ['4755'],
        placeholder: 'four digits',
        explanation: '`s` in the owner position = SUID (4) with x set. Then rwx = 7, r-x = 5, r-x = 5. So **4755**, the mode of /usr/bin/passwd.',
      },
    },
    {
      lesson: 'permissions',
      question: {
        id: 'm1-final-perm-delete',
        type: 'single',
        section: 'rwx',
        prompt: 'A file is `-r--r--r-- root root` but sits in your own directory (`drwx------ you you`). Can you delete it?',
        options: ['No, it is read-only and owned by root', 'Yes: deleting removes a directory entry, which needs write (and execute) permission on the directory, not on the file', 'Only with chmod first', 'Only if the sticky bit is set'],
        answer: 1,
        explanation: 'Deleting is a change to the directory. You own the directory with rwx, so `rm` works (it will ask for confirmation because the file is write-protected).',
      },
    },
    {
      lesson: 'permissions',
      question: {
        id: 'm1-final-perm-term',
        type: 'terminal',
        section: 'chmod',
        prompt: 'In the terminal, make `/home/analyst/notes.txt` readable and writable by its owner, readable by its group, and inaccessible to everyone else.',
        scenario: permissionsScenario(),
        task: {
          id: 'notes-640',
          solution: ['chmod 640 notes.txt'],
          instruction: 'Set `notes.txt` to `rw-r-----`.',
          check: (s) => modeOf(s, '/home/analyst/notes.txt') === 0o640,
        },
        explanation: '`chmod 640 notes.txt` (or `chmod u=rw,g=r,o= notes.txt`).',
      },
    },
    {
      lesson: 'processes',
      question: {
        id: 'm1-final-proc-term',
        type: 'terminal',
        section: 'signals',
        prompt: 'A worker process has stopped responding and ignores polite requests. Stop PID 4310, trying SIGTERM first.',
        scenario: processScenario(),
        task: {
          id: 'kill-4310',
          solution: ['kill 4310', 'ps -p 4310', 'kill -9 4310'],
          instruction: 'Send SIGTERM to 4310, check it is still there, then force it to stop.',
          hint: '`kill 4310`, `ps -p 4310`, `kill -9 4310`',
          check: (s) =>
            s.signals.some((x) => x.pid === 4310 && x.signal === 'SIGTERM') &&
            s.signals.some((x) => x.pid === 4310 && x.signal === 'SIGKILL') &&
            !s.processes.some((p) => p.pid === 4310),
        },
        explanation: 'SIGTERM first (`kill 4310`) gives a program the chance to clean up; when it is ignored, `kill -9 4310` (SIGKILL) cannot be resisted.',
      },
    },
    {
      lesson: 'processes',
      question: {
        id: 'm1-final-proc-cron-field',
        type: 'single',
        section: 'cron',
        prompt: 'How does a line in `/etc/crontab` differ from a line in a user’s crontab (`crontab -e`)?',
        options: ['It has no time fields', 'It has an extra field naming the user to run the command as', 'It can only run scripts in /etc', 'It runs once per boot'],
        answer: 1,
        explanation: 'System crontabs (/etc/crontab and /etc/cron.d/*) have a user field between the five time fields and the command. Per-user crontabs always run as their owner.',
      },
    },
    {
      lesson: 'logs',
      question: {
        id: 'm1-final-logs-key',
        type: 'output',
        section: 'ssh',
        prompt: 'What does this line tell you about how the user authenticated?',
        exhibit: { label: '/var/log/auth.log', text: 'Oct 26 09:02:11 web01 sshd[2201]: Accepted publickey for analyst from 198.51.100.23 port 50122 ssh2: ED25519 SHA256:4mF0x9cQ2pYexampleFingerprint0Kq1' },
        options: ['With a password', 'With an SSH key (Ed25519), identified by the logged fingerprint', 'With a one-time code', 'It failed'],
        answer: 1,
        explanation: '“Accepted publickey” means key authentication succeeded, and the fingerprint identifies which key, which you can match against `~/.ssh/authorized_keys`.',
      },
    },
    {
      lesson: 'shell',
      question: {
        id: 'm1-final-shell-term-rank',
        type: 'terminal',
        section: 'text-tools',
        prompt: 'In the terminal, list the source IPs of “Failed password” lines in `/var/log/auth.log` with a count for each, most frequent first.',
        scenario: shellScenario(),
        task: {
          id: 'rank-ips',
          solution: ["grep \"Failed password\" /var/log/auth.log | awk '{print $(NF-3)}' | sort | uniq -c | sort -rn"],
          instruction: 'Produce a ranked count of failed-password source IPs.',
          hint: "`grep \"Failed password\" /var/log/auth.log | awk '{print $(NF-3)}' | sort | uniq -c | sort -rn`",
          check: (s) => /^\s*6 203\.0\.113\.45\s*$/.test(lastOut(s).split('\n')[0] ?? '') && /uniq\s+-c/.test(s.lastCommand),
        },
        explanation: 'grep the lines, extract the IP (the 4th field from the end), sort so duplicates are adjacent, count with `uniq -c`, then sort numerically in reverse.',
      },
    },
    {
      lesson: 'hardening',
      question: {
        id: 'm1-final-hard-find-ww',
        type: 'terminal',
        section: 'world-writable',
        prompt: 'In the terminal, find every world-writable regular file on the system (hide permission errors).',
        scenario: hardeningScenario(),
        task: {
          id: 'find-ww-final',
          solution: ['find / -type f -perm -0002 2>/dev/null'],
          instruction: 'List world-writable regular files.',
          hint: '`find / -type f -perm -0002 2>/dev/null`',
          check: (s) => ran(s, /find\b.*-type\s+f.*-perm|find\b.*-perm.*-type\s+f/) && lastOut(s).includes('/opt/backup/backup.sh') && lastOut(s).includes('/etc/profile.d/proxy.sh'),
        },
        explanation: '`find / -type f -perm -0002 2>/dev/null`. `-perm -0002` matches files with the others-write bit set; `-o+w` is the symbolic equivalent.',
      },
    },
    {
      lesson: 'hardening',
      question: {
        id: 'm1-final-hard-sshd-first',
        type: 'single',
        section: 'ssh',
        prompt: 'You set `PasswordAuthentication no` at the bottom of `/etc/ssh/sshd_config`, but `sudo sshd -T` still reports `passwordauthentication yes`. What is the most likely reason?',
        options: [
          'sshd ignores the main config file',
          'A drop-in file included earlier (from `/etc/ssh/sshd_config.d/`) already set it, and sshd uses the first value it finds',
          'You need to reboot the server',
          'The setting only applies to root',
        ],
        answer: 1,
        explanation: 'For most keywords, sshd keeps the first value it reads. The Include line at the top of Ubuntu’s sshd_config pulls in drop-in files first, so set hardening options in a drop-in (e.g. 10-hardening.conf) or check for conflicting files.',
      },
    },
  ],
};
