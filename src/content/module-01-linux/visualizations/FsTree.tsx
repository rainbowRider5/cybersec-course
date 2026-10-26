import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Markdown } from '../../../components/Markdown';

interface Entry {
  name: string;
  kind: 'dir' | 'file' | 'link' | 'virtual';
  purpose: string;
  examples?: string[];
  security?: string;
  /** ls -l style permission summary */
  perms?: string;
  children?: Entry[];
}

const TREE: Entry = {
  name: '/',
  kind: 'dir',
  purpose: 'The **root directory**: the top of the single tree that holds everything. Other disks and partitions do not get drive letters; they are **mounted** somewhere inside this tree.',
  examples: ['/etc', '/home', '/var', '/usr'],
  security: 'Only root can create entries directly under `/`. An unexpected new top-level directory (or a writable `/`) is a red flag.',
  perms: 'drwxr-xr-x root root',
  children: [
    {
      name: 'bin',
      kind: 'link',
      purpose: 'Essential user commands. On modern distributions (Ubuntu 20.04+, Debian 12, Fedora) `/bin` is just a **symbolic link** to `/usr/bin`; this is called “merged /usr”. Likewise `/sbin` → `/usr/sbin` and `/lib` → `/usr/lib`.',
      examples: ['/bin -> usr/bin'],
      security: 'Attackers sometimes drop look-alike binaries into directories that appear early in `PATH`. Know where real binaries live.',
      perms: 'lrwxrwxrwx root root',
    },
    {
      name: 'boot',
      kind: 'dir',
      purpose: 'Files needed to start the system: the compressed kernel (`vmlinuz-*`), the **initramfs** (`initrd.img-*`), and GRUB’s configuration. On UEFI systems the EFI System Partition is mounted at `/boot/efi`.',
      examples: ['vmlinuz-6.8.0-45-generic', 'initrd.img-6.8.0-45-generic', 'grub/grub.cfg', 'efi/'],
      security: 'Tampering here (or on the EFI partition) can give an attacker code that runs before the OS. Secure Boot and integrity monitoring defend it.',
      perms: 'drwxr-xr-x root root',
    },
    {
      name: 'dev',
      kind: 'virtual',
      purpose: '**Device files**: “everything is a file” in action. Programs talk to hardware and kernel features by opening these files. `ls -l` shows a `c` (character device, a stream of bytes) or `b` (block device, a disk) as the first character. Created at boot by the kernel and `udev`; nothing here is stored on disk.',
      examples: ['/dev/sda, /dev/nvme0n1 (disks)', '/dev/null (discards everything written to it)', '/dev/zero, /dev/urandom', '/dev/tty, /dev/pts/0 (terminals)'],
      security: 'Raw disk devices such as `/dev/sda` must not be readable by normal users: reading them bypasses all file permissions. They are owned by `root:disk` with mode 660.',
      perms: 'drwxr-xr-x root root',
    },
    {
      name: 'etc',
      kind: 'dir',
      purpose: 'System-wide **configuration**, almost all plain text. If you want to know how a Linux box is set up, read `/etc`.',
      examples: ['passwd, shadow, group', 'sudoers', 'ssh/sshd_config', 'crontab, cron.d/', 'fstab, hostname, hosts'],
      security: 'The single most interesting directory for both attackers and defenders. Changes here should be rare, deliberate and monitored.',
      perms: 'drwxr-xr-x root root',
      children: [
        {
          name: 'passwd',
          kind: 'file',
          purpose: 'The user account list: one line per account with username, UID, primary GID, home directory and login shell. Despite the name, it does **not** contain passwords any more (the `x` means “see /etc/shadow”).',
          examples: ['analyst:x:1000:1000:Security Analyst,,,:/home/analyst:/bin/bash'],
          security: 'World-readable on purpose: programs need it to map UIDs to names. If it is ever *writable* by non-root, anyone could add a UID 0 account.',
          perms: '-rw-r--r-- root root',
        },
        {
          name: 'shadow',
          kind: 'file',
          purpose: 'Password **hashes** and password-ageing rules. Only root (and the `shadow` group on Debian/Ubuntu) can read it.',
          examples: ['analyst:$y$j9T$…:20380:0:99999:7:::'],
          security: 'A readable `/etc/shadow` lets an attacker copy the hashes and crack them offline. Check: `ls -l /etc/shadow` should show `-rw-r-----` (Debian/Ubuntu) or `----------` (RHEL family).',
          perms: '-rw-r----- root shadow',
        },
        {
          name: 'sudoers',
          kind: 'file',
          purpose: 'Rules for who may run what as root through `sudo`. Edit it only with `visudo`, which checks the syntax before saving. Extra rule files go in `/etc/sudoers.d/`.',
          examples: ['%sudo ALL=(ALL:ALL) ALL'],
          security: 'One careless line here (such as `NOPASSWD: ALL` for a service account) can hand out root. Review it during every audit.',
          perms: '-r--r----- root root',
        },
        {
          name: 'ssh',
          kind: 'dir',
          purpose: 'OpenSSH client and server configuration. `sshd_config` controls the SSH server; host keys identify this server to clients.',
          examples: ['sshd_config', 'sshd_config.d/', 'ssh_host_ed25519_key (private, 600)', 'ssh_host_ed25519_key.pub'],
          security: 'Key hardening settings live here (`PermitRootLogin no`, `PasswordAuthentication no`). Private host keys must be readable by root only.',
          perms: 'drwxr-xr-x root root',
        },
        {
          name: 'cron.d',
          kind: 'dir',
          purpose: 'Scheduled job definitions installed by packages or admins, alongside `/etc/crontab` and the `cron.daily`, `cron.hourly`, etc. directories.',
          examples: ['e2scrub_all', 'certbot'],
          security: 'Jobs here often run as root. If a job runs a script that ordinary users can modify, that is a privilege-escalation path. Also a classic persistence spot.',
          perms: 'drwxr-xr-x root root',
        },
        {
          name: 'systemd',
          kind: 'dir',
          purpose: 'Administrator overrides and custom units for systemd. `/etc/systemd/system/` takes priority over the package-supplied units in `/usr/lib/systemd/system/`.',
          examples: ['system/multi-user.target.wants/ssh.service (symlink created by systemctl enable)'],
          security: 'New `.service` or `.timer` files here are a common persistence technique. Watch for unexpected additions.',
          perms: 'drwxr-xr-x root root',
        },
      ],
    },
    {
      name: 'home',
      kind: 'dir',
      purpose: 'Home directories of regular users: `/home/<username>`. Each user’s personal files, shell history and per-user configuration (“dotfiles” such as `.bashrc`, `.ssh/`).',
      examples: ['/home/analyst/.bashrc', '/home/analyst/.bash_history', '/home/analyst/.ssh/authorized_keys'],
      security: '`~/.ssh/authorized_keys` decides who can log in as that user with a key; attackers add their own key for persistence. Home directories should not be readable by other users (mode 750 or 700).',
      perms: 'drwxr-xr-x root root',
      children: [
        {
          name: 'analyst',
          kind: 'dir',
          purpose: 'The home directory of user `analyst`. `~` in the shell is a shortcut for it.',
          examples: ['.bashrc', '.profile', '.bash_history', '.ssh/'],
          security: 'Check `.ssh/authorized_keys` for keys nobody recognises, and `.bashrc` for commands that should not be there.',
          perms: 'drwxr-x--- analyst analyst',
        },
      ],
    },
    {
      name: 'root',
      kind: 'dir',
      purpose: 'The home directory of the **root** user. Not to be confused with `/`, the root *directory*.',
      examples: ['/root/.bash_history', '/root/.ssh/authorized_keys'],
      security: 'Mode 700: only root may enter. Root’s shell history and authorized keys are prime targets for an investigator.',
      perms: 'drwx------ root root',
    },
    {
      name: 'tmp',
      kind: 'dir',
      purpose: 'Temporary files for everyone. Usually emptied at boot (often it is a RAM-backed `tmpfs`). `/var/tmp` is similar but survives reboots.',
      examples: ['drwxrwxrwt: note the t at the end'],
      security: '**World-writable**, so any user (or a compromised web server) can drop files here; it is a favourite place for malware to stage tools. The **sticky bit** (`t`) stops users deleting each other’s files. Hardened systems mount it with `noexec,nosuid,nodev`.',
      perms: 'drwxrwxrwt root root',
    },
    {
      name: 'var',
      kind: 'dir',
      purpose: '**Variable** data that changes while the system runs: logs, caches, spool queues, databases, website content.',
      examples: ['/var/log', '/var/spool/cron', '/var/www', '/var/lib (package and service state)'],
      perms: 'drwxr-xr-x root root',
      children: [
        {
          name: 'log',
          kind: 'dir',
          purpose: 'Log files. On Debian/Ubuntu: `auth.log` (logins, sudo), `syslog` (general). On RHEL/Fedora: `secure` and `messages`. systemd’s binary journal lives in `/var/log/journal/` and is read with `journalctl`.',
          examples: ['auth.log', 'syslog', 'kern.log', 'wtmp (logins, read with last)', 'btmp (failed logins, read with lastb)', 'journal/'],
          security: 'The defender’s evidence store. Attackers with root may delete or edit logs, which is why serious environments forward logs to a central server (SIEM) as they are written.',
          perms: 'drwxrwxr-x root syslog',
        },
        {
          name: 'www',
          kind: 'dir',
          purpose: 'Web content served by web servers like nginx or Apache (Debian/Ubuntu convention).',
          examples: ['/var/www/html/index.html'],
          security: 'If the web server user (`www-data`) can write to the web root, a web vulnerability can become a planted web shell.',
          perms: 'drwxr-xr-x root root',
        },
      ],
    },
    {
      name: 'usr',
      kind: 'dir',
      purpose: 'Installed software, read-only during normal operation: programs in `/usr/bin` and `/usr/sbin` (admin tools), libraries in `/usr/lib`, documentation in `/usr/share`. `/usr/local` is for software installed by hand, outside the package manager.',
      examples: ['/usr/bin/ls', '/usr/bin/passwd', '/usr/sbin/sshd', '/usr/local/bin'],
      security: 'Binaries here should match what the package manager installed. `dpkg --verify` or `rpm -Va` reveal modified files. SUID binaries live here too.',
      perms: 'drwxr-xr-x root root',
    },
    {
      name: 'proc',
      kind: 'virtual',
      purpose: 'A **virtual filesystem** (procfs) generated live by the kernel. Each running process has a directory `/proc/<PID>/`. Files like `/proc/cpuinfo` and `/proc/meminfo` describe the system. Nothing here exists on disk.',
      examples: ['/proc/1/cmdline', '/proc/<PID>/exe (link to the program)', '/proc/<PID>/environ', '/proc/self/'],
      security: 'Gold for investigators: `/proc/<PID>/exe` shows which binary a process runs, even if the file was deleted from disk (shown as “(deleted)”, a classic malware trick).',
      perms: 'dr-xr-xr-x root root',
    },
    {
      name: 'sys',
      kind: 'virtual',
      purpose: 'Another virtual filesystem (sysfs) exposing devices, drivers and kernel settings as files.',
      examples: ['/sys/class/net/', '/sys/firmware/efi/'],
      perms: 'dr-xr-xr-x root root',
    },
    {
      name: 'run',
      kind: 'virtual',
      purpose: 'Runtime data since the last boot, kept in RAM: PID files, sockets, the `utmp` record of who is logged in.',
      examples: ['/run/sshd.pid', '/run/utmp'],
      perms: 'drwxr-xr-x root root',
    },
    {
      name: 'opt',
      kind: 'dir',
      purpose: 'Optional, self-contained third-party software packages, each in its own folder.',
      examples: ['/opt/google/chrome', '/opt/backup-agent'],
      security: 'Third-party tools here are sometimes installed with sloppy permissions (world-writable scripts run by root). Worth checking in audits.',
      perms: 'drwxr-xr-x root root',
    },
    {
      name: 'mnt',
      kind: 'dir',
      purpose: 'A conventional **mount point** for temporarily attaching filesystems by hand. `/media` is where desktops auto-mount USB sticks.',
      examples: ['sudo mount /dev/sdb1 /mnt'],
      security: 'Removable media can carry SUID binaries or device files; mount untrusted media with `nosuid,nodev,noexec`.',
      perms: 'drwxr-xr-x root root',
    },
  ],
};

interface Flat {
  entry: Entry;
  path: string;
  depth: number;
  parent: string | null;
}

function flatten(e: Entry, path: string, depth: number, parent: string | null, open: Set<string>, out: Flat[]) {
  out.push({ entry: e, path, depth, parent });
  if (e.children && open.has(path)) {
    for (const c of e.children) flatten(c, path === '/' ? `/${c.name}` : `${path}/${c.name}`, depth + 1, path, open, out);
  }
}

function findEntry(path: string): Entry | undefined {
  if (path === '/') return TREE;
  let cur: Entry | undefined = TREE;
  for (const part of path.split('/').filter(Boolean)) cur = cur?.children?.find((c) => c.name === part);
  return cur;
}

const KIND_LABEL: Record<Entry['kind'], string> = { dir: 'directory', file: 'file', link: 'symbolic link', virtual: 'virtual (in memory)' };

export default function FsTree() {
  const [open, setOpen] = useState<Set<string>>(new Set(['/']));
  const [selected, setSelected] = useState('/');
  const refs = useRef<Record<string, HTMLLIElement | null>>({});
  const rows = useMemo(() => {
    const out: Flat[] = [];
    flatten(TREE, '/', 0, null, open, out);
    return out;
  }, [open]);
  const sel = findEntry(selected) ?? TREE;

  const toggle = (path: string, to?: boolean) =>
    setOpen((o) => {
      const n = new Set(o);
      const want = to ?? !n.has(path);
      if (want) n.add(path);
      else n.delete(path);
      return n;
    });

  const focus = (path: string) => {
    setSelected(path);
    // focus right away if the row exists; rows revealed by expanding appear after the next render
    const el = refs.current[path];
    if (el) el.focus();
    else requestAnimationFrame(() => refs.current[path]?.focus());
  };

  const onKey = (e: KeyboardEvent, r: Flat) => {
    const idx = rows.findIndex((x) => x.path === r.path);
    const hasKids = !!r.entry.children;
    switch (e.key) {
      case 'ArrowDown':
        if (rows[idx + 1]) focus(rows[idx + 1].path);
        break;
      case 'ArrowUp':
        if (rows[idx - 1]) focus(rows[idx - 1].path);
        break;
      case 'ArrowRight':
        if (hasKids && !open.has(r.path)) toggle(r.path, true);
        else if (hasKids && rows[idx + 1]) focus(rows[idx + 1].path);
        break;
      case 'ArrowLeft':
        if (hasKids && open.has(r.path)) toggle(r.path, false);
        else if (r.parent) focus(r.parent);
        break;
      case 'Enter':
      case ' ':
        setSelected(r.path);
        if (hasKids) toggle(r.path);
        break;
      case 'Home':
        focus(rows[0].path);
        break;
      case 'End':
        focus(rows[rows.length - 1].path);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  return (
    <div className="fs-viz">
      <ul className="fs-tree" role="tree" aria-label="Linux directory tree">
        {rows.map((r) => {
          const hasKids = !!r.entry.children;
          const isOpen = open.has(r.path);
          return (
            <li
              key={r.path}
              ref={(el) => {
                refs.current[r.path] = el;
              }}
              role="treeitem"
              aria-level={r.depth + 1}
              aria-expanded={hasKids ? isOpen : undefined}
              aria-selected={selected === r.path}
              tabIndex={selected === r.path ? 0 : -1}
              className={`fs-row${selected === r.path ? ' selected' : ''}`}
              style={{ paddingLeft: `${0.5 + r.depth * 1.1}rem` }}
              onClick={() => {
                setSelected(r.path);
                if (hasKids) toggle(r.path);
              }}
              onKeyDown={(e) => onKey(e, r)}
            >
              <span className="fs-caret" aria-hidden="true">
                {hasKids ? (isOpen ? '▾' : '▸') : ''}
              </span>
              <FsIcon kind={r.entry.kind} />
              <span className="mono">{r.depth === 0 ? '/' : r.entry.name + (r.entry.kind === 'dir' || r.entry.kind === 'virtual' ? '/' : '')}</span>
              {r.entry.kind === 'link' && <span className="fs-tag">→ usr/bin</span>}
              {r.entry.kind === 'virtual' && <span className="fs-tag">virtual</span>}
            </li>
          );
        })}
      </ul>
      <div className="fs-detail" aria-live="polite">
        <p className="mono fs-path">{selected}</p>
        <p className="fs-kind">
          {KIND_LABEL[sel.kind]}
          {sel.perms && (
            <>
              {' · '}
              <code>{sel.perms}</code>
            </>
          )}
        </p>
        <h5>Purpose</h5>
        <Markdown text={sel.purpose} />
        {sel.examples && (
          <>
            <h5>Example contents</h5>
            <ul className="fs-examples">
              {sel.examples.map((x) => (
                <li key={x} className="mono">
                  {x}
                </li>
              ))}
            </ul>
          </>
        )}
        {sel.security && (
          <div className="fs-security">
            <h5>Security relevance</h5>
            <Markdown text={sel.security} />
          </div>
        )}
      </div>
    </div>
  );
}

function FsIcon({ kind }: { kind: Entry['kind'] }) {
  if (kind === 'file')
    return (
      <svg className="fs-icon" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3.5 1.5h6l3 3v10h-9z" fill="none" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    );
  if (kind === 'link')
    return (
      <svg className="fs-icon" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M6 10l4-4M5 7.5L3.5 9a2.1 2.1 0 003 3L8 10.5M8 5.5L9.5 4a2.1 2.1 0 013 3L11 8.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    );
  return (
    <svg className="fs-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M1.5 3.5h5l1.5 1.5h6.5v8h-13z" fill={kind === 'virtual' ? 'none' : 'currentColor'} fillOpacity="0.15" stroke="currentColor" strokeWidth="1.2" strokeDasharray={kind === 'virtual' ? '2 1.5' : undefined} />
    </svg>
  );
}
