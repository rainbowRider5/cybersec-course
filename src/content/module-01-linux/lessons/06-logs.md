<!-- #why -->
Logs are the memory of a system. When something goes wrong, or someone breaks in, logs are usually the first and sometimes the only evidence of what happened. A large part of a SOC analyst’s job is reading logs: spotting the few lines that matter among thousands of routine ones, and turning them into a timeline.

On Linux, almost every program writes log messages, and two systems collect them:

- **[[syslog]]**, the traditional Unix logging system. A daemon (on most distributions [[rsyslog]]) receives messages and writes them as plain text files in `/var/log`.
- **[[journald]]**, systemd’s logging service (`systemd-journald`). It stores messages in a structured, indexed binary journal that you read with `journalctl`.

Many distributions run both: journald collects everything and forwards it to rsyslog, which writes the classic text files. Some newer installs (for example Debian 12 by default) only have the journal, in which case files like `auth.log` do not exist and you use `journalctl` instead.

<!-- #where -->
The most important log files, and where they live on the two big distribution families:

| What | Debian / Ubuntu | RHEL / Fedora / Rocky |
| --- | --- | --- |
| Authentication: logins, sudo, SSH, account changes | `/var/log/auth.log` | `/var/log/secure` |
| General system messages | `/var/log/syslog` | `/var/log/messages` |
| Kernel messages | `/var/log/kern.log` | in `messages`; also `dmesg` |
| Package installs and updates | `/var/log/apt/history.log`, `/var/log/dpkg.log` | `/var/log/dnf.log` |
| Successful logins (binary, read with `last`) | `/var/log/wtmp` | `/var/log/wtmp` |
| Failed logins (binary, read with `lastb`) | `/var/log/btmp` | `/var/log/btmp` |
| The systemd journal | `/var/log/journal/` | `/var/log/journal/` (or `/run/log/journal/` if not persistent) |
| Web server | `/var/log/nginx/`, `/var/log/apache2/` | `/var/log/nginx/`, `/var/log/httpd/` |

Log files grow forever unless something trims them. **Log rotation** (`logrotate`, run daily) renames the current file to `auth.log.1`, compresses older ones to `auth.log.2.gz` and so on, and deletes the oldest. When you investigate an event from last week, remember to search the rotated files too: `zgrep` searches compressed files directly.

Reading most logs requires privileges. On Ubuntu, `auth.log` is `-rw-r----- syslog adm`, so members of the `adm` group can read it; otherwise use `sudo`.

<!-- #format -->
A classic syslog line has a fixed structure:

```
Oct 26 03:15:49 web01 sshd[1858]: Accepted password for bob from 203.0.113.45 port 52417 ssh2
└──────┬──────┘ └─┬─┘ └──┬─┘└─┬┘  └──────────────────────┬──────────────────────────────┘
   timestamp    host  program PID                      message
```

Notice what is missing: there is **no year and no time zone**. On a single server that is fine; when you combine logs from many servers in different time zones it is a trap, which is why newer rsyslog configurations write full ISO 8601 timestamps such as `2026-10-26T03:15:49.512033+00:00`, and why every server should keep accurate time with NTP.

Each message also has a **facility** (which part of the system sent it: `auth`, `authpriv`, `cron`, `kern`, `daemon`, `mail`, `local0`–`local7`…) and a **severity**:

| Level | Name | Meaning |
| --- | --- | --- |
| 0 | emerg | System is unusable |
| 1 | alert | Act immediately |
| 2 | crit | Critical condition |
| 3 | err | Error |
| 4 | warning | Warning |
| 5 | notice | Normal but significant |
| 6 | info | Informational |
| 7 | debug | Debug detail |

rsyslog uses facility and severity to decide which file a message goes to. Rules such as `auth,authpriv.* /var/log/auth.log` live in `/etc/rsyslog.conf` and `/etc/rsyslog.d/`.

<!-- #journalctl -->
[[journalctl]] reads the systemd journal. Because entries are structured, filtering is precise:

| Command | Shows |
| --- | --- |
| `journalctl` | Everything, oldest first (in a pager) |
| `journalctl -e` | Jump to the end |
| `journalctl -f` | Follow new entries live, like `tail -f` |
| `journalctl -u ssh` | One unit (`sshd` on RHEL) |
| `journalctl -b` / `-b -1` | This boot / the previous boot |
| `journalctl --since "2026-10-26 03:00" --until "04:00"` | A time window |
| `journalctl --since "1 hour ago"` | Relative times work too |
| `journalctl -p err` | Priority `err` and more severe |
| `journalctl _UID=1002` | Entries from processes of one user |
| `journalctl -o json-pretty` | All the structured fields of each entry |

Ordinary users can only read their own entries unless they are in the `adm` or `systemd-journal` group. The journal is only kept across reboots if `/var/log/journal/` exists (otherwise it lives in RAM under `/run/log/journal/`).

<!-- #ssh -->
Internet-facing SSH servers are attacked constantly by automated password-guessing bots. Recognising the patterns in the auth log is a core SOC skill:

| Log message | Meaning |
| --- | --- |
| `Invalid user admin from 203.0.113.45 port 52344` | Someone tried a username that does not exist here |
| `Failed password for invalid user admin from …` | Wrong password for a non-existent user |
| `Failed password for root from …` | Wrong password for a real account |
| `error: maximum authentication attempts exceeded for …` | One connection hit `MaxAuthTries` |
| `Disconnected from authenticating user … [preauth]` | Connection ended before successful login |
| `Accepted password for bob from …` | **Successful** password login |
| `Accepted publickey for analyst from … ED25519 SHA256:…` | Successful key login, with the key’s fingerprint |
| `pam_unix(sshd:session): session opened for user bob(uid=1002)` | A login session started |

The pattern that matters most: **many failures followed by a success from the same source**. That is a [[brute-force|brute-force]] attack that worked. Other signs worth an alert: a success from a country or network the user never logs in from, logins at unusual hours, a password login for an account that normally uses keys, and any successful root login over SSH.

The sudo lines are just as valuable, because sudo records who did what as root:

```
sudo:  analyst : TTY=pts/0 ; PWD=/home/analyst ; USER=root ; COMMAND=/usr/bin/systemctl restart nginx
sudo:      bob : user NOT in sudoers ; TTY=pts/1 ; PWD=/home/bob ; USER=root ; COMMAND=/usr/bin/cat /etc/shadow
```

The log viewer below holds a night’s worth of `auth.log` from web01. Something happened. Filter it, click lines for an explanation of every field, and work out the story before you read the notes on the highlighted lines.

<!-- #logins -->
Besides text logs, Linux keeps binary login records, read with dedicated commands:

| Command | Reads | Shows |
| --- | --- | --- |
| `who` | `/run/utmp` | Who is logged in right now, on which terminal, from where |
| `w` | `/run/utmp` + `/proc` | The same, plus what each user is running and how long they have been idle |
| [[last]] | `/var/log/wtmp` | History of logins, logouts and reboots |
| `sudo lastb` | `/var/log/btmp` | Failed login attempts |
| `lastlog` | `/var/log/lastlog` | Each account’s most recent login |

```
$ last -n 3
analyst  pts/0        198.51.100.23    Mon Oct 26 09:02   still logged in
bob      pts/1        203.0.113.45     Mon Oct 26 03:15 - 03:21  (00:05)
reboot   system boot  6.8.0-45-generic Mon Oct 26 08:01   still running
```

<!-- #history -->
Bash saves the commands you type in [[~/.bash_history|bash-history]]. During an investigation, the history of a compromised account can show exactly what an attacker did, like the `curl … -o /tmp/.x.sh` in bob’s history on web01. But treat it as a **bonus, not a reliable log**:

- It is written when the shell **exits**, not as you type (unless configured with `PROMPT_COMMAND='history -a'`). A shell that is killed may never write it.
- The user controls it completely: `history -c` clears it, `unset HISTFILE` disables it, a leading space hides a command if `HISTCONTROL=ignorespace` is set, and the file can simply be deleted or edited.
- By default it has no timestamps. Setting `HISTTIMEFORMAT` adds them for new entries.
- Only commands typed in interactive bash are recorded. Commands run by scripts, by other shells, or via a web shell never appear.

A missing, empty or recently truncated history file on an account that is clearly in use is itself suspicious. For trustworthy command logging, defenders use the kernel’s audit system instead.

<!-- #auditd -->
[[auditd]] is the userspace side of the Linux kernel’s audit framework. Because rules are enforced in the kernel, a user cannot simply switch auditing off. You can watch files and record system calls:

```
sudo auditctl -w /etc/passwd -p wa -k identity       # log writes and attribute changes
sudo auditctl -a always,exit -F arch=b64 -S execve -k exec   # log every program started
sudo ausearch -k identity                            # search by key
```

Rules made permanent in `/etc/audit/rules.d/` are a common requirement in hardening standards. Many organisations collect auditd output in their [[SIEM]].

<!-- #practice -->
web01’s auth log is in the terminal too, along with traces of what happened. You are `analyst`, a member of `adm`, so you can read `/var/log/auth.log` without sudo.

<!-- #security -->
**Detection starts with the auth log.** Most Linux detection rules in a SIEM are built on exactly the lines you read in this lesson: bursts of failed SSH logins from one IP, a success after failures, logins from unusual locations, sudo failures, new accounts (`useradd`), group changes (`usermod -aG sudo`) and changes to SSH keys. Knowing the raw lines lets you write and tune those rules, and verify an alert on the host itself.

**Attackers attack the logs.** An intruder with root can delete or edit local log files, stop rsyslog, or clear the journal. Signs include gaps in timestamps, log files that are suddenly smaller, a stopped logging service, and history files that are empty or link to `/dev/null`. The real defence is **forwarding logs to a central server or SIEM as they are written**, so the copy the attacker can reach is not the only one.

**Time is evidence.** Correlating events across systems needs accurate clocks. Check that NTP (for example `systemd-timesyncd` or `chrony`) is running, and prefer logs with full timestamps and time zones.

**Know what normal looks like.** The same commands give you a baseline: which accounts usually log in, from where, and when. Anomalies only stand out against a known normal.

<!-- #try-intro -->
On your VM. On Ubuntu use `/var/log/auth.log`; on RHEL-family systems use `/var/log/secure`. To produce some interesting lines, run `ssh wronguser@localhost` a couple of times and type a wrong password.
