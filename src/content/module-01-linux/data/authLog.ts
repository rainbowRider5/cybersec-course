/**
 * A realistic sample of /var/log/auth.log (Ubuntu, traditional syslog format) for the web01 server.
 * Story: a brute-force attack at night succeeds against bob's weak password; the attacker tries sudo
 * and fails; in the morning the analyst logs in with a key and locks bob's account.
 * All IPs are from documentation ranges (RFC 5737), so none of them are real hosts.
 */

export type LogCategory = 'failed' | 'invalid' | 'success' | 'sudo' | 'session' | 'account' | 'other';

export interface LogEntry {
  line: string;
  category: LogCategory;
  note: string;
  /** Flag lines a defender should notice. */
  important?: boolean;
}

export const AUTH_LOG: LogEntry[] = [
  {
    line: 'Oct 26 03:12:01 web01 CRON[1712]: pam_unix(cron:session): session opened for user root(uid=0) by (uid=0)',
    category: 'session',
    note: 'cron started a scheduled job as root. PAM logs a “session” for it. Routine noise, and it shows that not every “session opened for user root” is a person logging in.',
  },
  {
    line: 'Oct 26 03:12:01 web01 CRON[1712]: pam_unix(cron:session): session closed for user root',
    category: 'session',
    note: 'The same cron job finished within a second.',
  },
  {
    line: 'Oct 26 03:14:07 web01 sshd[1840]: Invalid user admin from 203.0.113.45 port 52344',
    category: 'invalid',
    note: 'Someone tried to log in over SSH as `admin`, a username that does not exist on this server. Guessing common usernames is typical of automated scanners.',
    important: true,
  },
  {
    line: 'Oct 26 03:14:09 web01 sshd[1840]: pam_unix(sshd:auth): check pass; user unknown',
    category: 'invalid',
    note: 'PAM’s Unix module confirms there is no such user. sshd still asks for a password so the attacker cannot easily tell valid usernames from invalid ones.',
  },
  {
    line: 'Oct 26 03:14:09 web01 sshd[1840]: pam_unix(sshd:auth): authentication failure; logname= uid=0 euid=0 tty=ssh ruser= rhost=203.0.113.45',
    category: 'failed',
    note: 'PAM’s view of the same failure. `rhost` is the remote host. `uid=0` refers to sshd itself running as root, not to the attacker.',
  },
  {
    line: 'Oct 26 03:14:11 web01 sshd[1840]: Failed password for invalid user admin from 203.0.113.45 port 52344 ssh2',
    category: 'failed',
    note: 'The classic failed SSH login line. Fields: the username tried (`invalid user admin`), source IP, source port (random high port on the attacker’s side), and protocol `ssh2`.',
    important: true,
  },
  {
    line: 'Oct 26 03:14:15 web01 sshd[1843]: Failed password for root from 203.0.113.45 port 52360 ssh2',
    category: 'failed',
    note: 'A password guess for `root`. Note “invalid user” is missing: root exists. The new PID (1843) means a new SSH connection.',
    important: true,
  },
  {
    line: 'Oct 26 03:14:19 web01 sshd[1843]: Failed password for root from 203.0.113.45 port 52360 ssh2',
    category: 'failed',
    note: 'Second guess on the same connection (same PID and port).',
  },
  {
    line: 'Oct 26 03:14:22 web01 sshd[1843]: error: maximum authentication attempts exceeded for root from 203.0.113.45 port 52360 ssh2 [preauth]',
    category: 'failed',
    note: 'sshd’s `MaxAuthTries` limit was reached, so it ends the connection. `[preauth]` means this happened before authentication succeeded.',
  },
  {
    line: 'Oct 26 03:14:22 web01 sshd[1843]: Disconnecting authenticating user root 203.0.113.45 port 52360: Too many authentication failures [preauth]',
    category: 'failed',
    note: 'The disconnect that follows. The attacker’s tool simply opens a new connection and carries on.',
  },
  {
    line: 'Oct 26 03:15:02 web01 sshd[1851]: Failed password for invalid user test from 203.0.113.45 port 52398 ssh2',
    category: 'failed',
    note: 'Yet another common username guess from the same IP.',
  },
  {
    line: 'Oct 26 03:15:40 web01 sshd[1858]: Failed password for bob from 203.0.113.45 port 52417 ssh2',
    category: 'failed',
    note: 'Now the attacker targets `bob`, a real account. Maybe the username leaked, or it was guessed from the company’s email format.',
    important: true,
  },
  {
    line: 'Oct 26 03:15:44 web01 sshd[1858]: Failed password for bob from 203.0.113.45 port 52417 ssh2',
    category: 'failed',
    note: 'Another guess for bob.',
  },
  {
    line: 'Oct 26 03:15:49 web01 sshd[1858]: Accepted password for bob from 203.0.113.45 port 52417 ssh2',
    category: 'success',
    note: '**The most important line in this log.** A successful login from the same IP that has been guessing passwords for two minutes, at 03:15 at night. Failures followed by a success from one source is the textbook sign of a successful brute-force attack.',
    important: true,
  },
  {
    line: 'Oct 26 03:15:49 web01 sshd[1858]: pam_unix(sshd:session): session opened for user bob(uid=1002) by (uid=0)',
    category: 'session',
    note: 'A login session for bob (UID 1002) is now open.',
    important: true,
  },
  {
    line: 'Oct 26 03:15:49 web01 systemd-logind[588]: New session 14 of user bob.',
    category: 'session',
    note: 'systemd-logind registers the session. Session numbers help you match up events.',
  },
  {
    line: 'Oct 26 03:16:30 web01 sudo:      bob : user NOT in sudoers ; TTY=pts/1 ; PWD=/home/bob ; USER=root ; COMMAND=/usr/bin/cat /etc/shadow',
    category: 'sudo',
    note: 'Within a minute of logging in, “bob” tries to read the password hashes as root. bob is not allowed to use sudo, so it fails, and sudo logs exactly what was attempted. Real bob has no reason to do this at 3 a.m.: this is the attacker trying to escalate privileges.',
    important: true,
  },
  {
    line: 'Oct 26 03:21:12 web01 sshd[1858]: pam_unix(sshd:session): session closed for user bob',
    category: 'session',
    note: 'The attacker’s session ended after about 5½ minutes. What did they do in between? Check `/home/bob/.bash_history`, files in `/tmp`, cron jobs and `authorized_keys` for persistence.',
  },
  {
    line: 'Oct 26 04:02:55 web01 sshd[1920]: Failed password for invalid user oracle from 198.51.100.77 port 40112 ssh2',
    category: 'failed',
    note: 'A different source IP trying service-account names (oracle, postgres, ubuntu). Internet-facing SSH servers see this background noise all day.',
  },
  {
    line: 'Oct 26 04:02:58 web01 sshd[1922]: Failed password for invalid user postgres from 198.51.100.77 port 40130 ssh2',
    category: 'failed',
    note: 'Same scanner, next username.',
  },
  {
    line: 'Oct 26 04:03:01 web01 sshd[1925]: Connection closed by invalid user ubuntu 198.51.100.77 port 40144 [preauth]',
    category: 'invalid',
    note: 'The client disconnected before finishing authentication.',
  },
  {
    line: 'Oct 26 09:02:11 web01 sshd[2201]: Accepted publickey for analyst from 198.51.100.23 port 50122 ssh2: ED25519 SHA256:4mF0x9cQ2pYexampleFingerprint0Kq1',
    category: 'success',
    note: 'A normal morning login: the analyst authenticates with an SSH **key** (not a password), and sshd logs the key type and its fingerprint, which tells you exactly which key was used.',
  },
  {
    line: 'Oct 26 09:02:11 web01 sshd[2201]: pam_unix(sshd:session): session opened for user analyst(uid=1000) by (uid=0)',
    category: 'session',
    note: 'Session opened for the analyst (UID 1000).',
  },
  {
    line: 'Oct 26 09:05:43 web01 sudo:  analyst : TTY=pts/0 ; PWD=/home/analyst ; USER=root ; COMMAND=/usr/bin/systemctl restart nginx',
    category: 'sudo',
    note: 'A successful sudo. Fields: who ran it (`analyst`), from which terminal (`TTY`), in which directory (`PWD`), as which user (`USER=root`) and the full `COMMAND`. Every sudo use leaves this audit trail.',
  },
  {
    line: 'Oct 26 09:05:43 web01 sudo: pam_unix(sudo:session): session opened for user root(uid=0) by analyst(uid=1000)',
    category: 'session',
    note: 'PAM records the short root session that sudo opened for the command.',
  },
  {
    line: 'Oct 26 09:05:44 web01 sudo: pam_unix(sudo:session): session closed for user root',
    category: 'session',
    note: 'The command finished one second later.',
  },
  {
    line: 'Oct 26 09:10:20 web01 sudo:  analyst : TTY=pts/0 ; PWD=/home/analyst ; USER=root ; COMMAND=/usr/sbin/usermod -L bob',
    category: 'sudo',
    note: 'Incident response: the analyst locks bob’s password (`usermod -L` puts a `!` in front of the hash in /etc/shadow). Next steps would be resetting the password, reviewing bob’s files and SSH keys, and blocking 203.0.113.45.',
    important: true,
  },
  {
    line: "Oct 26 09:10:20 web01 usermod[2291]: lock user 'bob' password",
    category: 'account',
    note: 'usermod confirms the account change. Account creation and modification (useradd, usermod, passwd) are always worth watching: attackers create accounts for persistence.',
  },
];

export const AUTH_LOG_TEXT = AUTH_LOG.map((e) => e.line).join('\n') + '\n';
