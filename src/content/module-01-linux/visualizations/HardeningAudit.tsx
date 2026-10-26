import { useState } from 'react';
import { Markdown } from '../../../components/Markdown';

interface OutLine {
  text: string;
  /** undefined = header/noise line that cannot be selected */
  risky?: boolean;
  why?: string;
}

interface Check {
  id: string;
  title: string;
  command: string;
  lines: OutLine[];
  risk: string;
  fix: string;
}

const CHECKS: Check[] = [
  {
    id: 'ww',
    title: 'World-writable files',
    command: 'sudo find / -xdev -type f -perm -0002 2>/dev/null',
    risk: 'A world-writable file can be changed by **every** account on the system, including a compromised web server. If anything privileged reads or runs it, the attacker’s changes run with those privileges.',
    fix: 'Remove the write bit for others (`chmod o-w FILE`) and give the file a proper owner and group. Find out who needs to write and grant exactly that.',
    lines: [
      { text: '/opt/backup/backup.sh', risky: true, why: 'Run every 5 minutes by root’s cron (see the cron check). Anyone can edit it, so anyone can run commands as root.' },
      { text: '/etc/profile.d/proxy.sh', risky: true, why: 'Scripts in /etc/profile.d run for every user at login, including administrators. Writable by all = code execution as whoever logs in next.' },
      { text: '/srv/reports/q3-summary.csv', risky: true, why: 'Lower impact, but anyone can silently alter business data. Integrity matters too, not just confidentiality.' },
    ],
  },
  {
    id: 'suid',
    title: 'Unexpected SUID binaries',
    command: 'sudo find / -xdev -type f -perm -4000 2>/dev/null',
    risk: 'A SUID-root program runs as root no matter who starts it. Every such binary must be on a short, known list. A general-purpose tool with SUID (anything that can run commands or write files) is a direct path to root.',
    fix: 'Compare against a baseline or the package database (`dpkg -S FILE`, `rpm -qf FILE`). Remove the bit from anything unexpected (`chmod u-s FILE`) and investigate how it got there.',
    lines: [
      { text: '/usr/bin/passwd', risky: false, why: 'Expected: it must write /etc/shadow on behalf of normal users.' },
      { text: '/usr/bin/sudo', risky: false, why: 'Expected: sudo needs root to check the rules and switch users.' },
      { text: '/usr/bin/su', risky: false, why: 'Expected.' },
      { text: '/usr/bin/mount', risky: false, why: 'Expected: lets users mount filesystems marked “user” in /etc/fstab.' },
      { text: '/usr/bin/chsh', risky: false, why: 'Expected: changes your login shell in /etc/passwd.' },
      { text: '/usr/bin/find', risky: true, why: '**Not** SUID on any normal system. find can execute commands, so SUID find gives anyone a root shell. A classic misconfiguration or a planted backdoor.' },
      { text: '/usr/lib/openssh/ssh-keysign', risky: false, why: 'Expected on Debian/Ubuntu: part of OpenSSH host-based authentication.' },
      { text: '/usr/local/bin/backup-helper', risky: true, why: 'In /usr/local, so not installed by the package manager. Unknown SUID-root binary: treat as suspicious until proven otherwise.' },
    ],
  },
  {
    id: 'sudo',
    title: 'Weak sudo rules',
    command: 'sudo cat /etc/sudoers /etc/sudoers.d/*  |  grep -v "^#"',
    risk: 'sudo rules decide who can become root. `NOPASSWD: ALL` turns any compromise of that account into root with no further barrier. Allowing editors, interpreters, pagers or archivers (vim, python, less, tar, find…) is equivalent to full root, because those programs can start a shell.',
    fix: 'Grant specific commands with fixed arguments. Require passwords. For editing files as root use `sudoedit`, which edits a copy as your own user. Always change rules with `visudo`. GTFOBins is a public catalogue defenders use to check which binaries can break out.',
    lines: [
      { text: 'Defaults  env_reset', risky: false, why: 'Good: clears the caller’s environment variables so they cannot influence the root command.' },
      { text: 'Defaults  secure_path="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"', risky: false, why: 'Good: root commands use a fixed, trusted PATH.' },
      { text: 'root      ALL=(ALL:ALL) ALL', risky: false, why: 'Standard.' },
      { text: '%sudo     ALL=(ALL:ALL) ALL', risky: false, why: 'Standard admin group rule; still requires each admin’s password.' },
      { text: 'deploy    ALL=(ALL) NOPASSWD: ALL', risky: true, why: 'Anyone who gets into the deploy account (a leaked CI key, say) is instantly root without a password.' },
      { text: 'backup    ALL=(root) NOPASSWD: /usr/bin/tar', risky: true, why: 'tar has options that run arbitrary programs, so “only tar” really means “anything as root”.' },
      { text: 'alice     ALL=(root) /usr/bin/vim /etc/nginx/nginx.conf', risky: true, why: 'vim can run shell commands from inside the editor, as root. Use `sudoedit /etc/nginx/nginx.conf` instead.' },
      { text: 'monitor   ALL=(root) NOPASSWD: /usr/bin/systemctl restart nginx', risky: false, why: 'Narrow and specific: one command with fixed arguments. This is what good looks like.' },
    ],
  },
  {
    id: 'cron',
    title: 'Insecure cron jobs',
    command: 'cat /etc/crontab /etc/cron.d/*   then   ls -l each script it runs',
    risk: 'Cron runs jobs unattended, often as root. If the script a root job runs (or the directory it lives in) is writable by someone else, that someone can run code as root on the next tick. Cron is also a favourite persistence spot.',
    fix: 'Scripts run by root must be owned by root and writable only by root, in root-owned directories. Remove jobs nobody can explain, and investigate anything running from /tmp, /dev/shm or hidden directories.',
    lines: [
      { text: '17 *  * * *  root  cd / && run-parts --report /etc/cron.hourly', risky: false, why: 'Standard Debian/Ubuntu entry.' },
      { text: '*/5 * * * *  root  /opt/backup/backup.sh     # -rwxrwxrwx root root', risky: true, why: 'Root runs a world-writable script every 5 minutes. Fix with `chmod 755` (or 700) and check nobody already modified it.' },
      { text: '0 3  * * *   root  /usr/local/sbin/rotate-reports.sh   # -rwxr-xr-x root root', risky: false, why: 'Root-owned, only root can write. Fine.' },
      { text: '*/10 * * * * www-data  /usr/bin/php /var/www/html/cron.php', risky: false, why: 'Runs as the unprivileged web user, not root. Acceptable.' },
      { text: '@reboot  root  /tmp/.x/upd', risky: true, why: 'Runs a program from a hidden directory in /tmp at every boot, as root. Legitimate software never does this: treat as a likely backdoor and start incident response.' },
    ],
  },
  {
    id: 'ssh',
    title: 'SSH server configuration',
    command: "sudo sshd -T | grep -Ei 'permitrootlogin|passwordauthentication|pubkeyauthentication|permitemptypasswords|maxauthtries|x11forwarding'",
    risk: 'SSH is usually the front door of a Linux server. Root login gives attackers a known username to guess, and passwords can be brute-forced (as the log lesson showed); keys cannot realistically be guessed.',
    fix: 'In `/etc/ssh/sshd_config` (or a file in `sshd_config.d/`) set `PermitRootLogin no`, `PasswordAuthentication no`, keep `PubkeyAuthentication yes`. Test with `sudo sshd -t`, reload with `sudo systemctl reload ssh`, and keep your current session open until a new login works.',
    lines: [
      { text: 'permitrootlogin yes', risky: true, why: 'Lets attackers target the one account that exists everywhere. Log in as yourself and use sudo instead.' },
      { text: 'pubkeyauthentication yes', risky: false, why: 'Good: key-based logins enabled.' },
      { text: 'passwordauthentication yes', risky: true, why: 'Allows password guessing. Disable once everyone has keys set up.' },
      { text: 'permitemptypasswords no', risky: false, why: 'Good, and the default.' },
      { text: 'maxauthtries 6', risky: false, why: 'The default. Lowering it to 3 slows guessing slightly, but disabling passwords matters far more.' },
      { text: 'x11forwarding yes', risky: true, why: 'Lets clients forward graphical applications. Servers do not need it, and every unused feature is attack surface.' },
    ],
  },
  {
    id: 'updates',
    title: 'Missing updates',
    command: 'apt list --upgradable 2>/dev/null',
    risk: 'Most real-world compromises use known vulnerabilities that already have patches. Unpatched internet-facing services are the easiest way in.',
    fix: '`sudo apt update && sudo apt upgrade` (Debian/Ubuntu) or `sudo dnf upgrade` (RHEL/Fedora). Enable automatic security updates (`unattended-upgrades` / `dnf-automatic`). Kernel updates need a reboot to take effect.',
    lines: [
      { text: 'Listing...' },
      { text: 'openssh-server/noble-security 1:9.6p1-3ubuntu13.5 amd64 [upgradable from: 1:9.6p1-3ubuntu13.4]', risky: true, why: 'A security update (note the `-security` pocket) for the internet-facing SSH server. Patch first.' },
      { text: 'linux-image-6.8.0-48-generic/noble-security 6.8.0-48.48 amd64 [upgradable from: 6.8.0-45.45]', risky: true, why: 'Kernel security fix. Install it, then schedule a reboot: the old kernel keeps running until you do.' },
      { text: 'vim-tiny/noble-updates 2:9.1.0016-1ubuntu7.4 amd64 [upgradable from: 2:9.1.0016-1ubuntu7.3]', risky: false, why: 'A regular (non-security) update for a local tool. Install it with the rest, but it is not urgent.' },
    ],
  },
  {
    id: 'fw',
    title: 'Firewall (ufw)',
    command: 'sudo ufw status verbose',
    risk: 'A host firewall limits which services are reachable at all. “Default allow” means every service that starts listening, even by accident, is exposed.',
    fix: 'Allow SSH **first**, then set default deny: `sudo ufw allow OpenSSH`, `sudo ufw default deny incoming`, `sudo ufw default allow outgoing`, `sudo ufw enable`. Expose only what must be public, and restrict admin ports to known addresses.',
    lines: [
      { text: 'Status: active' },
      { text: 'Logging: on (low)' },
      { text: 'Default: allow (incoming), allow (outgoing), disabled (routed)', risky: true, why: 'Incoming traffic is allowed by default. It should be deny, with explicit allow rules.' },
      { text: 'To                         Action      From' },
      { text: '22/tcp                     ALLOW IN    Anywhere', risky: false, why: 'Needed for administration. Better still: restrict to your admin network or VPN.' },
      { text: '80,443/tcp                 ALLOW IN    Anywhere', risky: false, why: 'This is a web server; HTTP and HTTPS are meant to be public.' },
      { text: '3306/tcp                   ALLOW IN    Anywhere', risky: true, why: 'MySQL open to the whole internet. Databases should only be reachable from the application servers that use them.' },
    ],
  },
];

export default function HardeningAudit() {
  const [active, setActive] = useState(0);
  const [picked, setPicked] = useState<Record<string, Set<number>>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const c = CHECKS[active];
  const sel = picked[c.id] ?? new Set<number>();
  const shown = revealed[c.id];

  const toggle = (i: number) => {
    if (shown) return;
    const n = new Set(sel);
    if (n.has(i)) n.delete(i);
    else n.add(i);
    setPicked({ ...picked, [c.id]: n });
  };

  const riskyIdx = c.lines.map((l, i) => (l.risky ? i : -1)).filter((i) => i >= 0);
  const hits = riskyIdx.filter((i) => sel.has(i)).length;
  const falseAlarms = [...sel].filter((i) => !c.lines[i].risky).length;
  const doneCount = Object.values(revealed).filter(Boolean).length;

  return (
    <div className="audit">
      <div className="audit-tabs" role="tablist" aria-label="Audit checks">
        {CHECKS.map((ch, i) => (
          <button
            key={ch.id}
            role="tab"
            type="button"
            aria-selected={i === active}
            className={`audit-tab${i === active ? ' current' : ''}${revealed[ch.id] ? ' done' : ''}`}
            onClick={() => setActive(i)}
          >
            <span className="mono audit-num">{i + 1}</span> {ch.title}
            {revealed[ch.id] && <span className="visually-hidden"> (checked)</span>}
          </button>
        ))}
      </div>
      <p className="perm-hint" style={{ margin: '0.4rem 0 0.8rem' }}>
        {doneCount}/{CHECKS.length} checks reviewed. Click the output lines you think are risky, then reveal the answers.
      </p>

      <div role="tabpanel" aria-label={c.title}>
        <pre className="strace-line">
          <code>$ {c.command}</code>
        </pre>
        <ul className="audit-lines" aria-label="Command output. Select the lines you consider risky.">
          {c.lines.map((l, i) => {
            if (l.risky === undefined)
              return (
                <li key={i} className="audit-line plain mono">
                  {l.text}
                </li>
              );
            const isSel = sel.has(i);
            const verdict = shown ? (l.risky ? (isSel ? 'hit' : 'missed') : isSel ? 'false' : 'ok') : '';
            return (
              <li key={i}>
                <button type="button" className={`audit-line mono${isSel ? ' selected' : ''} ${verdict}`} aria-pressed={isSel} onClick={() => toggle(i)} disabled={shown}>
                  <span className="audit-flag" aria-hidden="true">
                    {isSel ? '⚑' : ''}
                  </span>
                  <span className="audit-text">{l.text}</span>
                  {shown && (
                    <span className="audit-verdict">
                      {verdict === 'hit' && 'risk, you caught it'}
                      {verdict === 'missed' && 'risk, missed'}
                      {verdict === 'false' && 'actually fine'}
                      {verdict === 'ok' && 'fine'}
                    </span>
                  )}
                </button>
                {shown && l.why && (
                  <div className="audit-why">
                    <Markdown text={l.why} inline />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <div className="controls" style={{ margin: '0.8rem 0' }}>
          {!shown ? (
            <button type="button" className="btn btn-primary btn-small" onClick={() => setRevealed({ ...revealed, [c.id]: true })}>
              Reveal answers
            </button>
          ) : (
            <>
              <span className={`pill ${hits === riskyIdx.length && falseAlarms === 0 ? 'pill-ok' : 'pill-warn'}`}>
                {hits}/{riskyIdx.length} risks found{falseAlarms ? ` · ${falseAlarms} false alarm${falseAlarms > 1 ? 's' : ''}` : ''}
              </span>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => {
                  setRevealed({ ...revealed, [c.id]: false });
                  setPicked({ ...picked, [c.id]: new Set() });
                }}
              >
                Try again
              </button>
              {active < CHECKS.length - 1 && (
                <button type="button" className="btn btn-small btn-primary" onClick={() => setActive(active + 1)}>
                  Next check →
                </button>
              )}
            </>
          )}
        </div>
        {shown && (
          <div className="audit-explain">
            <div>
              <h5>Why it is risky</h5>
              <Markdown text={c.risk} />
            </div>
            <div>
              <h5>How to fix it</h5>
              <Markdown text={c.fix} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
