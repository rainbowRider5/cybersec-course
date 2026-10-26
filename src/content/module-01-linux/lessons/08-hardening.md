<!-- #mindset -->
[[Hardening]] means reducing a system’s [[attack surface]]: removing what is not needed and tightening what remains, so that there are fewer ways in and fewer ways to escalate once inside. **Auditing** is the other half: systematically checking a system for risky configuration, ideally against a written [[baseline]].

This lesson takes the defender’s view of everything in the module. Each check follows the same pattern: *why it is risky*, *how to detect it*, *how to fix it*. It does not teach how to exploit these weaknesses; it teaches you to find and remove them before someone else does.

You do not have to invent the checklist yourself. Industry standards exist:

- **[[CIS Benchmarks|cis-benchmark]]**: detailed, free hardening guides for each distribution, with a command to audit and a command to fix every item.
- **DISA STIGs**: similar guides used by the US government.
- Audit tools such as **[[Lynis]]** (`sudo lynis audit system`) and OpenSCAP that run hundreds of checks and report findings.

A sensible process is: inventory the system, run the checks, fix the findings in order of risk, verify, and then monitor for drift, because systems tend to get less secure over time as people make “temporary” changes.

<!-- #world-writable -->
**Why it is risky.** A [[world-writable]] file (the `w` bit set for *others*, `o+w`) can be modified by every account on the system, including service accounts like `www-data` that an attacker may already control. If root ever reads or runs that file, through cron, a systemd unit, a login script or a sudo rule, the attacker’s content runs as root. World-writable *directories* without the sticky bit are just as bad: anyone can delete or replace any file inside.

**How to detect it.**

```
# world-writable regular files, on the root filesystem only (-xdev skips /proc etc.)
sudo find / -xdev -type f -perm -0002 2>/dev/null

# world-writable directories WITHOUT the sticky bit
sudo find / -xdev -type d -perm -0002 ! -perm -1000 2>/dev/null
```

On a healthy system the first command returns little or nothing. `/tmp` and `/var/tmp` will not appear in the second list because they have the sticky bit.

**How to fix it.** Remove the bit (`sudo chmod o-w FILE`), set a proper owner and group, and find out *why* it was writable: usually someone ran `chmod 777` to make an error go away. Give exactly the access needed, typically via a group.

<!-- #suid -->
**Why it is risky.** A SUID-root binary runs as root no matter who starts it. The legitimate ones (`passwd`, `sudo`, `su`, `mount`…) are carefully written to do one narrow thing. A general-purpose program with the SUID bit, especially one that can run commands, read or write arbitrary files, or start a shell, is a direct path to root for any local user. Unknown SUID binaries in odd places can also be backdoors left by an attacker.

**How to detect it.**

```
sudo find / -xdev -type f \( -perm -4000 -o -perm -2000 \) -exec ls -l {} \; 2>/dev/null
```

Compare the list with a known-good baseline from a clean install, and check that each file belongs to a package and is unmodified:

```
dpkg -S /usr/bin/passwd          # Debian/Ubuntu: which package owns it?
dpkg --verify passwd             # any files changed since install?
rpm -qf /usr/bin/passwd          # RHEL family
rpm -Va                          # verify all packages
```

Anything in `/usr/local`, `/opt`, `/tmp` or a home directory with SUID deserves investigation. **[[GTFOBins]]** is a public list of standard Unix binaries that can be abused when they are SUID or allowed through sudo; defenders use it to judge which entries in their list are dangerous.

**How to fix it.** Remove the bit from anything unexpected (`sudo chmod u-s FILE`, `g-s` for SGID), reinstall modified packages, and mount filesystems that should never contain SUID programs (`/tmp`, `/home`, removable media) with `nosuid`.

<!-- #sudo -->
**Why it is risky.** Every sudo rule is a statement of who may become root, and rules are often broader than they look.

| Rule pattern | Why it is a problem |
| --- | --- |
| `user ALL=(ALL) NOPASSWD: ALL` | Compromising the account (a stolen key, a hijacked session) is instantly full root, with no password barrier |
| Allowing an editor: `vim`, `nano`, `less`, `more`, `man` | Editors and pagers can run shell commands or open other files, as root |
| Allowing an interpreter or swiss-army tool: `python3`, `perl`, `bash`, `find`, `tar`, `awk`, `env` | They can all execute arbitrary commands, so the rule is effectively `ALL` |
| Wildcards: `/usr/bin/cat /var/log/*` | `*` also matches `../../etc/shadow` and extra arguments |
| A script the user can write to | They change the script, then run it with sudo |
| `env_keep` of variables like `LD_PRELOAD` or `PYTHONPATH` | Lets the caller inject code into the root process |

**How to detect it.** Read `/etc/sudoers` and every file in `/etc/sudoers.d/` (`sudo cat`, or `sudo visudo -c` to also check the syntax), and ask sudo what a given user may do: `sudo -l -U bob`. Check membership of the admin groups: `getent group sudo wheel`.

**How to fix it.** Grant specific commands with fixed arguments (`/usr/bin/systemctl restart nginx`), require passwords, never allow editors or interpreters, and use `sudoedit FILE` (also written `sudo -e FILE`) when someone needs to edit a root-owned file: it edits a temporary copy as the user and only writes it back as root. Make the commands that rules allow, and the directories they live in, writable by root only.

<!-- #cron -->
**Why it is risky.** Cron runs jobs unattended, often as root, often forgotten. If a root job runs a script that someone else can modify, or that lives in a directory someone else can write to, or that calls commands without full paths while the crontab’s `PATH` contains a writable directory, the job becomes a privilege-escalation path. Cron is also one of the most common places attackers add [[persistence]].

**How to detect it.** List every place jobs can be defined, then check the permissions of each script they run, and of its directory:

```
sudo cat /etc/crontab
sudo ls -l /etc/cron.d /etc/cron.hourly /etc/cron.daily /etc/cron.weekly /etc/cron.monthly
sudo ls -l /var/spool/cron/crontabs          # per-user crontabs (Debian/Ubuntu)
for u in $(cut -d: -f1 /etc/passwd); do sudo crontab -l -u "$u" 2>/dev/null | sed "s/^/$u: /"; done
systemctl list-timers --all
```

Red flags: scripts not owned by root or writable by group/others, jobs running from `/tmp`, `/dev/shm` or hidden directories, `@reboot` entries nobody can explain, and commands that download something (`curl`, `wget`) and pipe it to a shell.

**How to fix it.** Root-run scripts must be owned by root, mode `700` or `755`, in root-owned directories. Use absolute paths inside them. Remove jobs nobody can justify, and treat unknown ones as a possible incident.

<!-- #ssh -->
**Why it is risky.** SSH is usually the one service every Linux server exposes. As the logs lesson showed, it is attacked continuously by password-guessing bots.

The settings that matter most, in `/etc/ssh/sshd_config` or a drop-in file in `/etc/ssh/sshd_config.d/`:

| Setting | Hardened value | Why |
| --- | --- | --- |
| `PermitRootLogin` | `no` | Attackers know the root account exists everywhere. Log in as yourself and use sudo, so actions are attributable |
| `PasswordAuthentication` | `no` | Passwords can be guessed and phished; [[keys|key-auth]] practically cannot be guessed |
| `PubkeyAuthentication` | `yes` | Use key-based login instead |
| `KbdInteractiveAuthentication` | `no` | Another password prompt path (unless you deliberately use it for MFA) |
| `PermitEmptyPasswords` | `no` | Never allow accounts without passwords |
| `MaxAuthTries` | `3` or `4` | Fewer guesses per connection |
| `X11Forwarding` | `no` | Not needed on servers |
| `AllowUsers` / `AllowGroups` | e.g. `AllowGroups sshusers` | Only named accounts may log in at all |

Two details that trip people up. First, **for most options sshd uses the first value it finds**, and on Ubuntu the `Include /etc/ssh/sshd_config.d/*.conf` line sits at the top of the main file, so a drop-in file can silently override what you set further down. Always check the *effective* configuration with `sudo sshd -T`. Second, never lock yourself out:

1. Set up and test key login first: `ssh-keygen -t ed25519` on your machine, `ssh-copy-id user@server`, then log in with the key.
2. Edit the config, then test the syntax: `sudo sshd -t` (no output means OK).
3. Reload: `sudo systemctl reload ssh` (the unit is `sshd` on RHEL).
4. **Keep your current session open** and log in from a second terminal before you close it.

Tools like **fail2ban** add another layer by temporarily banning IPs that fail repeatedly, but disabling password authentication is what really removes the risk.

<!-- #updates -->
**Why it is risky.** Most successful attacks use known vulnerabilities for which a patch already exists. An internet-facing service that is months behind on updates is the easiest way in.

**How to detect and fix.**

| Task | Debian / Ubuntu | RHEL / Fedora |
| --- | --- | --- |
| Refresh the package list | `sudo apt update` | (automatic) |
| List pending updates | `apt list --upgradable` | `dnf check-update` |
| Install updates | `sudo apt upgrade` | `sudo dnf upgrade` |
| Security updates automatically | `unattended-upgrades` package | `dnf-automatic` |
| Is a reboot needed? | `/var/run/reboot-required` exists | `sudo dnf needs-restarting -r` |

Kernel updates only take effect after a **reboot**, and updated libraries only after the services using them restart (the `needrestart` tool reports which). Patching without restarting leaves the old, vulnerable code running.

<!-- #firewall -->
**Why it is risky.** Without a host firewall, every service that listens on a network port is reachable, including ones started by accident or left over from testing. First find out what is listening:

```
sudo ss -tulpn          # TCP and UDP, listening, numeric, with process names
```

Anything listening on `0.0.0.0` or `[::]` accepts connections on every interface. Disable services you do not need (`sudo systemctl disable --now NAME`) and bind internal ones (databases, caches) to `127.0.0.1`.

**How to fix it with [[ufw]].** ufw (“uncomplicated firewall”) is Ubuntu’s front end for the kernel’s netfilter firewall. A [[default-deny]] setup for a web server:

```
sudo ufw allow OpenSSH            # FIRST, or you lock yourself out of a remote server
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 80,443/tcp         # only what must be public
sudo ufw enable
sudo ufw status verbose
```

Restrict admin access further where you can: `sudo ufw allow from 198.51.100.0/24 to any port 22 proto tcp`. RHEL-family systems use `firewalld` (`firewall-cmd`) for the same job.

<!-- #audit-intro -->
Here is the output of each check from a real-looking audit of a server. Your job as the auditor: mark the lines that are findings, then reveal the answers to see why each one is (or is not) a risk and how to fix it.

<!-- #practice -->
web01 has several of the problems above. You are `analyst` with sudo rights. Find them and fix the ones you can fix with permissions.

<!-- #security -->
**Misconfiguration, not exotic exploits, is how most Linux servers fall.** The weaknesses in this lesson (writable root scripts, unnecessary SUID bits, overbroad sudo rules, password SSH, missing patches, everything exposed) are the ones real attackers look for first after landing on a system, because they are common and reliable. Removing them makes an attacker’s job dramatically harder.

**Hardening is part of the SOC job, too.** Auditors, vulnerability-management teams and SOC analysts all use these checks: to assess a server, to verify a finding from a scanner, to scope an incident (“could the attacker have escalated from www-data?”), and to recommend fixes. Compliance frameworks such as PCI DSS, ISO 27001 and SOC 2 require documented secure configurations, often based on CIS Benchmarks.

**Defense in depth.** No single control is enough. Patching reduces vulnerabilities, the firewall reduces exposure, SSH hardening protects the front door, least-privilege sudo limits escalation, `nosuid`/`noexec` mounts block simple tricks, and logging plus [[file integrity monitoring|fim]] (AIDE, auditd watches, a SIEM) detects what gets through anyway.

**Monitor for drift.** A server that passed its audit last quarter may not pass today. Schedule the audits (Lynis, OpenSCAP or your own scripts), alert on changes to the files that matter (`/etc/passwd`, `/etc/sudoers*`, `/etc/ssh/sshd_config`, cron and systemd directories), and investigate every change you did not expect.

<!-- #try-intro -->
On your **own** VM only. Take a snapshot first so you can roll back. A few steps change SSH and the firewall, so do them from the VM’s console or keep a second session open.
