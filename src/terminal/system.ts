/**
 * A generic, realistic-looking Ubuntu server ("web01") that terminal scenarios start from.
 * Modules extend it with `withNodes()` and `withProcesses()` rather than building systems from scratch.
 */
import { bin, device, dir, file, link } from './fs';
import type { FsNode, ProcessDef, TerminalScenario } from './types';

const T = 'Oct 26 08:01';

const PASSWD = `root:x:0:0:root:/root:/bin/bash
daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin
bin:x:2:2:bin:/bin:/usr/sbin/nologin
sys:x:3:3:sys:/dev:/usr/sbin/nologin
www-data:x:33:33:www-data:/var/www:/usr/sbin/nologin
nobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin
syslog:x:104:110::/home/syslog:/usr/sbin/nologin
sshd:x:105:65534::/run/sshd:/usr/sbin/nologin
analyst:x:1000:1000:Security Analyst,,,:/home/analyst:/bin/bash
alice:x:1001:1001:Alice Ng,,,:/home/alice:/bin/bash
bob:x:1002:1002:Bob Ortiz,,,:/home/bob:/bin/bash
`;

// Hashes are shortened fake examples in the yescrypt ($y$) format Ubuntu uses. Not real hashes.
const SHADOW = `root:*:20022:0:99999:7:::
daemon:*:20022:0:99999:7:::
bin:*:20022:0:99999:7:::
sys:*:20022:0:99999:7:::
www-data:*:20022:0:99999:7:::
nobody:*:20022:0:99999:7:::
syslog:*:20022:0:99999:7:::
sshd:*:20022:0:99999:7:::
analyst:$y$j9T$Qm1yXE0bExampleSalt$ExAmPlEhAsHnOtReAl0123456789abcdefGHIJKL:20380:0:99999:7:::
alice:$y$j9T$a8Fq2LExampleSalt$AnOtHeRfAkEhAsH0123456789abcdefGHIJKLmn:20381:0:99999:7:::
bob:!$y$j9T$Zp0oExampleSalt$LoCkEdAcCoUnTfAkEhAsH0123456789abcdefGH:20381:0:99999:7:::
`;

const GROUP = `root:x:0:
adm:x:4:syslog,analyst
tty:x:5:
disk:x:6:
sudo:x:27:analyst
www-data:x:33:
shadow:x:42:
utmp:x:43:
syslog:x:110:
crontab:x:111:
nogroup:x:65534:
analyst:x:1000:
alice:x:1001:
bob:x:1002:
developers:x:1003:alice,bob
`;

const SUDOERS = `#
# This file MUST be edited with the 'visudo' command as root.
#
Defaults	env_reset
Defaults	mail_badpass
Defaults	secure_path="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
Defaults	use_pty

# User privilege specification
root	ALL=(ALL:ALL) ALL

# Members of the admin group may gain root privileges
%admin ALL=(ALL) ALL

# Allow members of group sudo to execute any command
%sudo	ALL=(ALL:ALL) ALL

@includedir /etc/sudoers.d
`;

const SSHD_CONFIG = `# This is the sshd server system-wide configuration file.  See sshd_config(5).
Include /etc/ssh/sshd_config.d/*.conf

#Port 22
#PermitRootLogin prohibit-password
#PubkeyAuthentication yes
#PasswordAuthentication yes
KbdInteractiveAuthentication no
UsePAM yes
X11Forwarding yes
PrintMotd no
AcceptEnv LANG LC_*
Subsystem	sftp	/usr/lib/openssh/sftp-server
`;

const CRONTAB = `# /etc/crontab: system-wide crontab
# Unlike any other crontab you don't have to run the 'crontab'
# command to install the new version when you edit this file
# and files in /etc/cron.d. These files also have username fields,
# that none of the other crontabs do.

SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin

# m h dom mon dow user	command
17 *	* * *	root	cd / && run-parts --report /etc/cron.hourly
25 6	* * *	root	test -x /usr/sbin/anacron || run-parts --report /etc/cron.daily
47 6	* * 7	root	test -x /usr/sbin/anacron || run-parts --report /etc/cron.weekly
52 6	1 * *	root	test -x /usr/sbin/anacron || run-parts --report /etc/cron.monthly
`;

const FSTAB = `# <file system>                           <mount point>  <type>  <options>          <dump> <pass>
UUID=3f2a9c1e-5b7d-4e8a-9c21-6d0f4b2a7e11 /              ext4    defaults           0      1
UUID=7C1A-2B3D                            /boot/efi      vfat    umask=0077         0      1
/swap.img                                 none           swap    sw                 0      0
`;

const OS_RELEASE = `PRETTY_NAME="Ubuntu 24.04.1 LTS"
NAME="Ubuntu"
VERSION_ID="24.04"
VERSION="24.04.1 LTS (Noble Numbat)"
ID=ubuntu
ID_LIKE=debian
`;

/** Every command the simulator implements gets a binary in /usr/bin so PATH lookup looks real. */
const COMMAND_BINARIES = [
  'ls', 'cat', 'pwd', 'whoami', 'id', 'groups', 'chmod', 'chown', 'chgrp', 'ps', 'kill', 'find', 'grep', 'echo',
  'touch', 'mkdir', 'rm', 'cp', 'mv', 'ln', 'head', 'tail', 'wc', 'sort', 'uniq', 'cut', 'awk', 'stat', 'file',
  'uname', 'hostname', 'who', 'w', 'last', 'pstree', 'systemctl', 'env', 'printenv', 'which', 'bash', 'sh',
  'clear', 'python3', 'less', 'nano', 'vim', 'tar', 'ssh', 'curl', 'journalctl', 'top', 'strace',
];

function usrBin(): Record<string, FsNode> {
  const out: Record<string, FsNode> = {};
  COMMAND_BINARIES.forEach((name, i) => (out[name] = bin(30000 + ((i * 7907) % 120000), { mtime: 'Apr  8  2024' })));
  // Legitimate SUID/SGID programs that ship with Ubuntu
  out.passwd = bin(64152, { mode: 0o4755, mtime: 'Feb  6  2024' });
  out.sudo = bin(277936, { mode: 0o4755, mtime: 'Jun 25  2024' });
  out.su = bin(55680, { mode: 0o4755, mtime: 'Apr  9  2024' });
  out.mount = bin(51584, { mode: 0o4755, mtime: 'Apr  9  2024' });
  out.umount = bin(39296, { mode: 0o4755, mtime: 'Apr  9  2024' });
  out.chsh = bin(44808, { mode: 0o4755, mtime: 'Feb  6  2024' });
  out.gpasswd = bin(72072, { mode: 0o4755, mtime: 'Feb  6  2024' });
  out.newgrp = bin(40496, { mode: 0o4755, mtime: 'Feb  6  2024' });
  out.crontab = bin(39568, { mode: 0o2755, group: 'crontab', mtime: 'Mar 31  2024' });
  out.chage = bin(72184, { mode: 0o2755, group: 'shadow', mtime: 'Feb  6  2024' });
  out.expiry = bin(23136, { mode: 0o2755, group: 'shadow', mtime: 'Feb  6  2024' });
  return out;
}

const AUTH_LOG_BASE = `Oct 26 08:01:20 web01 systemd-logind[640]: New seat seat0.
Oct 26 09:02:11 web01 sshd[2201]: Accepted publickey for analyst from 198.51.100.23 port 50122 ssh2: ED25519 SHA256:4mF0x9cQ2pYexampleFingerprint0Kq1
Oct 26 09:02:11 web01 sshd[2201]: pam_unix(sshd:session): session opened for user analyst(uid=1000) by (uid=0)
`;

export function baseFs(): FsNode {
  return dir({
    bin: link('usr/bin', { mtime: 'Apr 22  2024' }),
    sbin: link('usr/sbin', { mtime: 'Apr 22  2024' }),
    lib: link('usr/lib', { mtime: 'Apr 22  2024' }),
    boot: dir({
      'vmlinuz-6.8.0-45-generic': file('', { mode: 0o600, size: 14928264, mtime: 'Sep 12 10:13' }),
      'initrd.img-6.8.0-45-generic': file('', { size: 70214533, mtime: 'Oct  2 06:41' }),
      'config-6.8.0-45-generic': file('CONFIG_SECURITY_SELINUX=y\nCONFIG_SECURITY_APPARMOR=y\nCONFIG_MODULE_SIG=y\n', { mtime: 'Sep 12 10:13' }),
      'System.map-6.8.0-45-generic': file('', { mode: 0o600, size: 9089512, mtime: 'Sep 12 10:13' }),
      vmlinuz: link('vmlinuz-6.8.0-45-generic', { mtime: 'Oct  2 06:41' }),
      'initrd.img': link('initrd.img-6.8.0-45-generic', { mtime: 'Oct  2 06:41' }),
      efi: dir({}, { mode: 0o700, mtime: 'Jan  1  1970' }),
      grub: dir({ 'grub.cfg': file('### BEGIN /etc/grub.d/10_linux ###\nmenuentry \'Ubuntu\' {\n\tlinux\t/boot/vmlinuz-6.8.0-45-generic root=UUID=3f2a9c1e-5b7d-4e8a-9c21-6d0f4b2a7e11 ro quiet splash\n\tinitrd\t/boot/initrd.img-6.8.0-45-generic\n}\n', { mode: 0o444, mtime: 'Oct  2 06:41' }) }),
    }),
    dev: dir({
      null: device('char', '1, 3', { mode: 0o666, mtime: T }),
      zero: device('char', '1, 5', { mode: 0o666, mtime: T }),
      random: device('char', '1, 8', { mode: 0o666, mtime: T }),
      urandom: device('char', '1, 9', { mode: 0o666, mtime: T }),
      tty: device('char', '5, 0', { mode: 0o666, group: 'tty', mtime: T }),
      sda: device('block', '8, 0', { mode: 0o660, group: 'disk', mtime: T }),
      sda1: device('block', '8, 1', { mode: 0o660, group: 'disk', mtime: T }),
      sda2: device('block', '8, 2', { mode: 0o660, group: 'disk', mtime: T }),
      pts: dir({ '0': device('char', '136, 0', { mode: 0o620, owner: 'analyst', group: 'tty', mtime: '09:02' }) }),
    }, { mtime: T }),
    etc: dir({
      passwd: file(PASSWD, { mtime: 'Oct 20 14:02' }),
      shadow: file(SHADOW, { mode: 0o640, group: 'shadow', mtime: 'Oct 20 14:02' }),
      group: file(GROUP, { mtime: 'Oct 20 14:02' }),
      gshadow: file('root:*::\nsudo:*::analyst\n', { mode: 0o640, group: 'shadow', mtime: 'Oct 20 14:02' }),
      sudoers: file(SUDOERS, { mode: 0o440, mtime: 'Jun 25  2024' }),
      'sudoers.d': dir({ README: file('# Files in this directory are included by /etc/sudoers.\n', { mode: 0o440 }) }, { mode: 0o750 }),
      hostname: file('web01\n'),
      hosts: file('127.0.0.1 localhost\n127.0.1.1 web01\n'),
      fstab: file(FSTAB),
      'os-release': file(OS_RELEASE),
      crontab: file(CRONTAB),
      'cron.d': dir({ e2scrub_all: file('30 3 * * 0 root test -e /run/systemd/system || SERVICE_MODE=1 /usr/lib/x86_64-linux-gnu/e2fsprogs/e2scrub_all_cron\n') }),
      'cron.daily': dir({ logrotate: file('#!/bin/sh\n/usr/sbin/logrotate /etc/logrotate.conf\n', { mode: 0o755 }), apt: file('#!/bin/sh\n# apt daily jobs\n', { mode: 0o755 }) }),
      ssh: dir({
        sshd_config: file(SSHD_CONFIG, { mtime: 'Aug  9 11:20' }),
        'sshd_config.d': dir({}),
        'ssh_host_ed25519_key': file('-----BEGIN OPENSSH PRIVATE KEY-----\n(redacted)\n-----END OPENSSH PRIVATE KEY-----\n', { mode: 0o600 }),
        'ssh_host_ed25519_key.pub': file('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleKeyOnly root@web01\n'),
      }),
      systemd: dir({ system: dir({ 'multi-user.target.wants': dir({ 'ssh.service': link('/usr/lib/systemd/system/ssh.service'), 'cron.service': link('/usr/lib/systemd/system/cron.service') }) }) }),
      profile: file('# /etc/profile: system-wide .profile file for the Bourne shell\n'),
      'bash.bashrc': file('# System-wide .bashrc file for interactive bash(1) shells.\n'),
      'resolv.conf': link('../run/systemd/resolve/stub-resolv.conf'),
    }, { mtime: 'Oct 20 14:02' }),
    home: dir({
      analyst: dir({
        '.bashrc': file('# ~/.bashrc: executed by bash(1) for non-login shells.\nHISTSIZE=1000\nHISTFILESIZE=2000\n', { owner: 'analyst', mtime: 'Oct 20 14:02' }),
        '.profile': file('# ~/.profile: executed by the command interpreter for login shells.\n', { owner: 'analyst', mtime: 'Oct 20 14:02' }),
        '.bash_history': file('ls -la\nsudo apt update\nsudo apt upgrade -y\nsystemctl status nginx\ntail -n 50 /var/log/auth.log\n', { mode: 0o600, owner: 'analyst', mtime: 'Oct 25 17:30' }),
        '.ssh': dir({ authorized_keys: file('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAnalystExampleKey analyst@laptop\n', { mode: 0o600, owner: 'analyst' }) }, { mode: 0o700, owner: 'analyst' }),
      }, { mode: 0o750, owner: 'analyst', mtime: 'Oct 26 09:02' }),
      alice: dir({ '.bashrc': file('', { owner: 'alice' }), 'project-notes.md': file('# Q4 deploy plan\n', { owner: 'alice', mode: 0o640 }) }, { mode: 0o750, owner: 'alice', mtime: 'Oct 25 17:45' }),
      bob: dir({ '.bashrc': file('', { owner: 'bob' }) }, { mode: 0o750, owner: 'bob', mtime: 'Oct 21 10:00' }),
    }),
    root: dir({
      '.bashrc': file('# root .bashrc\n'),
      '.bash_history': file('apt update\nufw status\n', { mode: 0o600 }),
    }, { mode: 0o700, mtime: 'Oct 20 14:02' }),
    tmp: dir({
      'build-cache.tmp': file('cache v2\n', { owner: 'alice', group: 'alice', mtime: 'Oct 25 16:58' }),
      'systemd-private-3c1f': dir({}, { mode: 0o700, mtime: T }),
    }, { mode: 0o1777, mtime: 'Oct 26 09:10' }),
    var: dir({
      log: dir({
        'auth.log': file(AUTH_LOG_BASE, { mode: 0o640, owner: 'syslog', group: 'adm', mtime: 'Oct 26 09:12' }),
        syslog: file('Oct 26 08:01:12 web01 kernel: Linux version 6.8.0-45-generic (buildd@lcy02-amd64-115)\nOct 26 08:01:19 web01 systemd[1]: Reached target multi-user.target - Multi-User System.\nOct 26 08:01:20 web01 systemd[1]: Started ssh.service - OpenBSD Secure Shell server.\n', { mode: 0o640, owner: 'syslog', group: 'adm', mtime: 'Oct 26 09:12' }),
        'kern.log': file('Oct 26 08:01:12 web01 kernel: Command line: BOOT_IMAGE=/boot/vmlinuz-6.8.0-45-generic root=UUID=3f2a9c1e ro quiet splash\n', { mode: 0o640, owner: 'syslog', group: 'adm', mtime: T }),
        wtmp: file('', { mode: 0o664, group: 'utmp', size: 38400, mtime: 'Oct 26 09:02' }),
        btmp: file('', { mode: 0o660, group: 'utmp', size: 11520, mtime: 'Oct 26 03:15' }),
        lastlog: file('', { mode: 0o664, group: 'utmp', size: 292292, mtime: 'Oct 26 09:02' }),
        apt: dir({ 'history.log': file('Start-Date: 2026-10-25  17:28:03\nCommandline: apt upgrade -y\nUpgrade: openssl:amd64 (3.0.13-0ubuntu3.3, 3.0.13-0ubuntu3.4)\nEnd-Date: 2026-10-25  17:28:40\n', { mtime: 'Oct 25 17:28' }) }),
        journal: dir({}, { mode: 0o2755, group: 'systemd-journal', mtime: T }),
      }, { mode: 0o775, group: 'syslog', mtime: 'Oct 26 09:12' }),
      tmp: dir({}, { mode: 0o1777, mtime: T }),
      www: dir({ html: dir({ 'index.html': file('<h1>web01</h1>\n', { owner: 'www-data', group: 'www-data' }) }) }),
      spool: dir({ cron: dir({ crontabs: dir({}, { mode: 0o1730, group: 'crontab' }) }) }),
    }),
    usr: dir({
      bin: dir(usrBin(), { mtime: 'Oct 25 17:28' }),
      sbin: dir({
        sshd: bin(921912, { mtime: 'Aug  9 11:20' }),
        useradd: bin(141480, { mtime: 'Feb  6  2024' }),
        visudo: bin(240000, { mtime: 'Jun 25  2024' }),
        ufw: file('#!/usr/bin/python3\n# ufw front end\n', { mode: 0o755, mtime: 'Mar  1  2024' }),
        cron: bin(47480, { mtime: 'Mar 31  2024' }),
        nginx: bin(1306000, { mtime: 'May  1  2024' }),
        rsyslogd: bin(792000, { mtime: 'Apr  1  2024' }),
      }),
      lib: dir({ systemd: dir({ system: dir({
        'ssh.service': file('[Unit]\nDescription=OpenBSD Secure Shell server\nAfter=network.target auditd.service\n\n[Service]\nExecStart=/usr/sbin/sshd -D $SSHD_OPTS\nRestart=on-failure\n\n[Install]\nWantedBy=multi-user.target\n'),
        'cron.service': file('[Unit]\nDescription=Regular background program processing daemon\n\n[Service]\nExecStart=/usr/sbin/cron -f -P\n\n[Install]\nWantedBy=multi-user.target\n'),
        'nginx.service': file('[Unit]\nDescription=A high performance web server and a reverse proxy server\n\n[Service]\nType=forking\nExecStart=/usr/sbin/nginx -g \'daemon on; master_process on;\'\n\n[Install]\nWantedBy=multi-user.target\n'),
      }) }) }),
      local: dir({ bin: dir({}), sbin: dir({}) }),
      share: dir({}),
    }),
    opt: dir({}),
    srv: dir({}),
    mnt: dir({}),
    media: dir({}),
    run: dir({ 'sshd.pid': file('812\n'), utmp: file('', { mode: 0o664, group: 'utmp', size: 1536 }) }, { mtime: T }),
    proc: dir({
      '1': dir({ comm: file('systemd\n'), cmdline: file('/sbin/init\n'), environ: file('HOME=/\nTERM=linux\n', { mode: 0o400 }), status: file('Name:\tsystemd\nState:\tS (sleeping)\nPid:\t1\nPPid:\t0\nUid:\t0\t0\t0\t0\n') }, { mode: 0o555, mtime: T }),
      cmdline: file('BOOT_IMAGE=/boot/vmlinuz-6.8.0-45-generic root=UUID=3f2a9c1e-5b7d-4e8a-9c21-6d0f4b2a7e11 ro quiet splash\n', { mode: 0o444 }),
      cpuinfo: file('processor\t: 0\nvendor_id\t: GenuineIntel\nmodel name\t: Intel(R) Xeon(R) CPU\n', { mode: 0o444 }),
      meminfo: file('MemTotal:        2014088 kB\nMemFree:          612340 kB\n', { mode: 0o444 }),
      version: file('Linux version 6.8.0-45-generic (buildd@lcy02-amd64-115) #45-Ubuntu SMP PREEMPT_DYNAMIC\n', { mode: 0o444 }),
      uptime: file('4472.31 8790.12\n', { mode: 0o444 }),
    }, { mode: 0o555, mtime: T }),
    sys: dir({ kernel: dir({}), class: dir({}) }, { mode: 0o555, mtime: T }),
  }, { mtime: 'Oct 20 14:02' });
}

export function baseProcesses(): ProcessDef[] {
  return [
    { pid: 1, ppid: 0, user: 'root', cmd: '/sbin/init', comm: 'systemd', state: 'S', tty: '?', start: '08:01' },
    { pid: 2, ppid: 0, user: 'root', cmd: '[kthreadd]', state: 'S', tty: '?', start: '08:01' },
    { pid: 15, ppid: 2, user: 'root', cmd: '[rcu_preempt]', state: 'I', tty: '?', start: '08:01' },
    { pid: 380, ppid: 1, user: 'root', cmd: '/usr/lib/systemd/systemd-journald', comm: 'systemd-journal', state: 'S', tty: '?', mem: 0.8, start: '08:01' },
    { pid: 412, ppid: 1, user: 'root', cmd: '/usr/lib/systemd/systemd-udevd', state: 'S', tty: '?', start: '08:01' },
    { pid: 598, ppid: 1, user: 'syslog', cmd: '/usr/sbin/rsyslogd -n -iNONE', state: 'S', tty: '?', start: '08:01' },
    { pid: 640, ppid: 1, user: 'root', cmd: '/usr/sbin/cron -f -P', state: 'S', tty: '?', start: '08:01' },
    { pid: 702, ppid: 1, user: 'root', cmd: 'nginx: master process /usr/sbin/nginx -g daemon on; master_process on;', comm: 'nginx', state: 'S', tty: '?', start: '08:01' },
    { pid: 703, ppid: 702, user: 'www-data', cmd: 'nginx: worker process', comm: 'nginx', state: 'S', tty: '?', start: '08:01' },
    { pid: 812, ppid: 1, user: 'root', cmd: 'sshd: /usr/sbin/sshd -D [listener] 0 of 10-100 startups', comm: 'sshd', state: 'S', tty: '?', start: '08:01' },
    { pid: 2201, ppid: 812, user: 'root', cmd: 'sshd: analyst [priv]', comm: 'sshd', state: 'S', tty: '?', start: '09:02' },
    { pid: 2209, ppid: 2201, user: 'analyst', cmd: 'sshd: analyst@pts/0', comm: 'sshd', state: 'S', tty: '?', start: '09:02' },
    { pid: 2210, ppid: 2209, user: 'analyst', cmd: '-bash', comm: 'bash', state: 'S', tty: 'pts/0', start: '09:02' },
  ];
}

export function baseScenario(): TerminalScenario {
  return {
    hostname: 'web01',
    user: 'analyst',
    cwd: '/home/analyst',
    users: [
      { name: 'root', uid: 0, groups: ['root'], home: '/root' },
      { name: 'www-data', uid: 33, groups: ['www-data'], home: '/var/www' },
      { name: 'syslog', uid: 104, groups: ['syslog', 'adm'], home: '/home/syslog' },
      { name: 'sshd', uid: 105, groups: ['nogroup'], home: '/run/sshd' },
      { name: 'analyst', uid: 1000, groups: ['analyst', 'adm', 'sudo'], home: '/home/analyst' },
      { name: 'alice', uid: 1001, groups: ['alice', 'developers'], home: '/home/alice' },
      { name: 'bob', uid: 1002, groups: ['bob', 'developers'], home: '/home/bob' },
    ],
    groups: [
      { name: 'root', gid: 0 }, { name: 'adm', gid: 4 }, { name: 'tty', gid: 5 }, { name: 'disk', gid: 6 },
      { name: 'sudo', gid: 27 }, { name: 'www-data', gid: 33 }, { name: 'shadow', gid: 42 }, { name: 'utmp', gid: 43 },
      { name: 'syslog', gid: 110 }, { name: 'crontab', gid: 111 }, { name: 'systemd-journal', gid: 999 },
      { name: 'nogroup', gid: 65534 }, { name: 'analyst', gid: 1000 }, { name: 'alice', gid: 1001 },
      { name: 'bob', gid: 1002 }, { name: 'developers', gid: 1003 },
    ],
    fs: baseFs(),
    processes: baseProcesses(),
    services: [
      { name: 'ssh', description: 'OpenBSD Secure Shell server', active: true, enabled: true, pid: 812 },
      { name: 'cron', description: 'Regular background program processing daemon', active: true, enabled: true, pid: 640 },
      { name: 'nginx', description: 'A high performance web server and a reverse proxy server', active: true, enabled: true, pid: 702 },
      { name: 'rsyslog', description: 'System Logging Service', active: true, enabled: true, pid: 598 },
    ],
    whoOutput: 'analyst  pts/0        2026-10-26 09:02 (198.51.100.23)\n',
    lastOutput: `analyst  pts/0        198.51.100.23    Mon Oct 26 09:02   still logged in
reboot   system boot  6.8.0-45-generic Mon Oct 26 08:01   still running
alice    pts/1        198.51.100.40    Sun Oct 25 16:20 - 17:45  (01:25)
analyst  pts/0        198.51.100.23    Sun Oct 25 17:20 - 17:31  (00:11)
reboot   system boot  6.8.0-45-generic Sun Oct 25 07:58 - 08:00 (1+00:02)

wtmp begins Thu Oct  1 07:55:02 2026
`,
  };
}

/* ------------------------------------------------------------------ */
/* Helpers for building scenarios                                      */
/* ------------------------------------------------------------------ */

/** Places nodes at absolute paths, creating missing parent directories (root-owned, 0755). */
export function withNodes(scenario: TerminalScenario, nodes: Record<string, FsNode>): TerminalScenario {
  for (const [path, node] of Object.entries(nodes)) {
    const parts = path.split('/').filter(Boolean);
    const name = parts.pop()!;
    let cur = scenario.fs;
    for (const p of parts) {
      cur.children![p] ??= dir({});
      cur = cur.children![p];
    }
    cur.children![name] = node;
  }
  return scenario;
}

/** Appends text to an existing file in the scenario. */
export function appendTo(scenario: TerminalScenario, path: string, text: string): TerminalScenario {
  let cur: FsNode | undefined = scenario.fs;
  for (const p of path.split('/').filter(Boolean)) cur = cur?.children?.[p];
  if (cur && cur.type === 'file') cur.content = (cur.content ?? '') + text;
  return scenario;
}
