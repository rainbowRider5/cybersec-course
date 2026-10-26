<!-- #users -->
Every process on Linux runs as some user, and every file belongs to some user and some group. When a process tries to open a file, the kernel compares the two. That simple comparison is the core of Linux security.

The kernel does not actually care about names. It works with numbers:

- A [[UID]] (user ID) identifies a user. The name “analyst” is just a label mapped to UID 1000 in `/etc/passwd`.
- A [[GID]] (group ID) identifies a group. Groups let you give several users the same access.

Some UID ranges are conventions you should know by heart:

| UID | Who | Notes |
| --- | --- | --- |
| **0** | [[root|root-user]] | The superuser. Most permission checks are skipped for UID 0. Any account with UID 0 *is* root, whatever its name. |
| 1–999 | System and [[service accounts|service-account]] | `daemon`, `www-data`, `sshd`, `syslog`… Used to run services with limited rights. Usually have the shell `/usr/sbin/nologin` so nobody can log in as them. |
| 1000+ | Regular human users | The first account created at install is usually 1000. |
| 65534 | `nobody` | An account with no privileges at all. |

(The exact boundary between system and human accounts is set in `/etc/login.defs`; 1000 is the default on Debian, Ubuntu and RHEL.)

Three commands tell you who you are:

```
$ whoami
analyst
$ id
uid=1000(analyst) gid=1000(analyst) groups=1000(analyst),4(adm),27(sudo)
$ groups
analyst adm sudo
```

Every user has one **[[primary group]]** (the `gid=` shown by `id`, used as the group of new files they create) and any number of supplementary groups. On Ubuntu, being in `sudo` lets you use sudo, and being in `adm` lets you read most logs.

<!-- #account-files -->
Three text files in `/etc` define the accounts.

### /etc/passwd: the account list

[[/etc/passwd|etc-passwd]] has one line per account with seven colon-separated fields:

```
analyst:x:1000:1000:Security Analyst,,,:/home/analyst:/bin/bash
```

| # | Field | Value here |
| --- | --- | --- |
| 1 | Username | `analyst` |
| 2 | Password placeholder | `x` means “the hash is in /etc/shadow” |
| 3 | UID | `1000` |
| 4 | Primary GID | `1000` |
| 5 | Comment (GECOS): full name etc. | `Security Analyst,,,` |
| 6 | Home directory | `/home/analyst` |
| 7 | Login shell | `/bin/bash` |

Despite its name it holds no passwords any more. It is readable by everyone because many programs need to turn UIDs into names (that is how `ls -l` shows owners).

### /etc/shadow: the password hashes

[[/etc/shadow|etc-shadow]] holds the [[password hashes|password-hash]], readable only by root (and the `shadow` group on Debian/Ubuntu):

```
analyst:$y$j9T$Qm1yXE0b…$ExAmPlE…:20380:0:99999:7:::
```

The fields are: username, password hash, date of last change (in days since 1 January 1970), minimum and maximum days between changes, warning days, and then inactivity, expiry and a reserved field. The hash itself has the form `$id$salt$hash`, where the id names the algorithm:

| Prefix | Algorithm | Where you see it |
| --- | --- | --- |
| `$1$` | MD5-crypt | Ancient. Weak, should not exist any more |
| `$5$` | SHA-256-crypt | Rare |
| `$6$` | SHA-512-crypt | RHEL and older Debian/Ubuntu |
| `$y$` | yescrypt | Default on Debian 11+, Ubuntu 22.04+, Fedora 35+ |

The random **salt** means two users with the same password get different hashes. A hash starting with `!` means the password is **locked**; a plain `*` or `!` means the account has no usable password at all (normal for service accounts).

### /etc/group: groups and their members

[[/etc/group|etc-group]] has four fields: group name, password placeholder, GID, and a comma-separated list of supplementary members.

```
sudo:x:27:analyst
developers:x:1003:alice,bob
```

<!-- #rwx -->
Every file and directory has an owner (a UID), a group (a GID) and nine permission bits, shown by `ls -l`:

```
$ ls -l report.sh
-rwxr-xr-- 1 analyst developers 120 Oct 26 09:12 report.sh
│└┬┘└┬┘└┬┘   └──┬──┘ └───┬────┘
│ │  │  │      owner    group
│ │  │  └── others: r--   (everyone else)
│ │  └───── group:  r-x   (members of "developers")
│ └──────── owner:  rwx   (analyst)
└────────── type: - regular file, d directory, l link
```

The three permissions mean different things on files and on directories:

| | On a **file** | On a **directory** |
| --- | --- | --- |
| `r` read | Read the contents | List the names inside (`ls`) |
| `w` write | Change the contents | Create, delete and rename entries inside (needs `x` too) |
| `x` execute | Run it as a program | Enter it and reach things inside (`cd`, open files by path) |

Two consequences surprise people. First, **deleting a file needs write permission on the directory, not on the file**: you can delete a read-only file in your own directory. Second, `x` on a directory is what lets you get *through* it: to read `/home/alice/notes.txt` you need `x` on `/`, `/home` and `/home/alice`, plus `r` on the file.

**How the kernel decides.** When a process opens a file, the kernel picks exactly **one** class and uses only those three bits:

1. If the process’s UID is the file’s owner → use the **owner** bits.
2. Otherwise, if the process is in the file’s group → use the **group** bits.
3. Otherwise → use the **others** bits.

There is no fall-through. If a file is `----r--r--` the owner cannot read it, even though everyone else can. Root is the exception: UID 0 skips read and write checks entirely, and may execute a file if *any* of its three `x` bits is set.

<!-- #octal -->
Typing `rwxr-xr--` is slow, so permissions are usually written in [[octal notation]], one digit per class. Each permission has a value, and you **add** the values you want:

| Permission | Value |
| --- | --- |
| `r` read | **4** |
| `w` write | **2** |
| `x` execute | **1** |

So a digit can be anything from 0 to 7:

| Digit | Sum | Meaning |
| --- | --- | --- |
| 7 | 4+2+1 | `rwx` read, write, execute |
| 6 | 4+2 | `rw-` read and write |
| 5 | 4+1 | `r-x` read and execute |
| 4 | 4 | `r--` read **only** |
| 3 | 2+1 | `-wx` (rare) |
| 2 | 2 | `-w-` (rare) |
| 1 | 1 | `--x` (rare) |
| 0 | 0 | `---` nothing |

> [!note] The digit 4 means read only
> Read plus write is 6 (4+2). An easy way to remember: the values are powers of two, so every sum is unique and you can always decode it. 7 is the only digit that includes everything.

Worked example, **754**:

- owner 7 = 4+2+1 = `rwx`
- group 5 = 4+1 = `r-x`
- others 4 = 4 = `r--`

giving `-rwxr-xr--`. Values you will see constantly:

| Octal | Symbolic | Typical use |
| --- | --- | --- |
| 644 | `rw-r--r--` | Ordinary files, readable by all |
| 600 | `rw-------` | Private files: SSH private keys, secrets |
| 640 | `rw-r-----` | Readable by a group, e.g. logs (`syslog:adm`) |
| 755 | `rwxr-xr-x` | Programs and normal directories |
| 750 | `rwxr-x---` | Directories or scripts for one team |
| 700 | `rwx------` | Private directories like `~/.ssh` |
| 777 | `rwxrwxrwx` | Almost always a mistake |

<!-- #chmod -->
[[chmod]] changes the mode. It accepts octal or **symbolic** changes made of *who* (`u` owner/user, `g` group, `o` others, `a` all), an *operator* (`+` add, `-` remove, `=` set exactly) and *permissions*:

```
chmod 640 notes.txt        # exact mode, octal
chmod u+x report.sh        # add execute for the owner
chmod go-w shared.txt      # remove write from group and others
chmod u=rwx,g=rx,o= app    # same as chmod 750 app
chmod -R g+rX project/     # recursive; capital X = execute only on dirs (and already-executable files)
```

Only the file’s owner (or root) can change its mode.

[[chown]] changes the owner and/or group: `chown alice file`, `chown alice:developers file`, `chown :developers file` (group only, same as `chgrp developers file`). Only root can change a file’s owner, because otherwise users could “give away” files, for example to dodge disk quotas or frame someone. A file’s owner may change its group to another group they belong to.

Try everything in the calculator. Toggle bits and watch the octal and symbolic forms update, or type either form directly. Then pick an owner and group and check who can do what.

<!-- #umask -->
New files do not get random permissions. A program asks for a mode when it creates a file (normally `666` for files and `777` for directories), and the kernel removes whatever bits are set in the process’s [[umask]].

| umask | New files (666 minus mask bits) | New directories (777 minus mask bits) |
| --- | --- | --- |
| `022` (common default) | 644 `rw-r--r--` | 755 `rwxr-xr-x` |
| `002` (common for regular users on Ubuntu and Fedora) | 664 `rw-rw-r--` | 775 `rwxrwxr-x` |
| `027` | 640 `rw-r-----` | 750 `rwxr-x---` |
| `077` | 600 `rw-------` | 700 `rwx------` |

It is a **mask, not a subtraction**: bits set in the umask are switched off. With umask `033`, a new file is `666` with the `033` bits cleared, which is `644`, not 633. Run `umask` to see yours; set it with `umask 027`. Execute bits are never added by the umask, which is why new files are not executable until you `chmod +x` them.

<!-- #special -->
There are three more bits, written as an optional **fourth, leading octal digit**:

| Bit | Value | On a file | On a directory | Shown in `ls -l` |
| --- | --- | --- | --- | --- |
| [[SUID]] (set-user-ID) | 4 | Runs with the privileges of the file’s **owner**, not the user who started it | (no effect on Linux) | `s` in the owner’s x position |
| [[SGID]] (set-group-ID) | 2 | Runs with the privileges of the file’s **group** | New files created inside inherit the directory’s group | `s` in the group’s x position |
| [[Sticky bit]] | 1 | (ignored on Linux) | Only a file’s owner, the directory’s owner or root may delete or rename files inside | `t` in the others’ x position |

A capital `S` or `T` means the special bit is set but the matching execute bit is not, usually a mistake.

The classic SUID example is `passwd`. Ordinary users must be able to change their own password, which means writing to `/etc/shadow`, a file only root can write. The solution: the `passwd` program is owned by root and has the SUID bit, so whoever runs it temporarily gets root’s effective UID, and the program itself makes sure you can only change your own password.

```
$ ls -l /usr/bin/passwd
-rwsr-xr-x 1 root root 64152 Feb  6  2024 /usr/bin/passwd      # 4755
$ ls -ld /tmp
drwxrwxrwt 14 root root 4096 Oct 26 09:10 /tmp                 # 1777
$ ls -ld /srv/team
drwxrwsr-x 2 root developers 4096 Oct 24 10:00 /srv/team      # 2775
```

The Linux kernel ignores SUID and SGID on interpreted scripts (files starting with `#!`), because scripts could be abused through environment tricks. SUID only works on compiled binaries.

<!-- #sudo -->
Logging in as root for everyday work is dangerous: every typo has full power and there is no record of who did what. Instead, administrators use [[sudo]] to run individual commands as root:

```
$ sudo systemctl restart nginx
[sudo] password for analyst:
```

sudo asks for **your own** password (not root’s), checks the rules in [[/etc/sudoers|sudoers]], runs the command as root if allowed, and logs it to the auth log. `sudo -l` lists what you are allowed to run. `su` (“switch user”), by contrast, starts a whole shell as another user and needs *that* user’s password.

A sudoers rule reads *who where = (as whom) what*:

```
root      ALL=(ALL:ALL) ALL
%sudo     ALL=(ALL:ALL) ALL                               # % means a group
monitor   ALL=(root) NOPASSWD: /usr/bin/systemctl restart nginx
```

The last rule lets user `monitor`, on any host, run exactly one command as root without a password. `NOPASSWD:` skips the password prompt. Always edit sudoers with [[visudo]], which refuses to save a file with syntax errors; a broken sudoers file can lock every administrator out. Additional rule files go in `/etc/sudoers.d/`.

All of this serves the [[principle of least privilege|least-privilege]]: every user and service gets only the access it needs, and powerful access is granted narrowly, temporarily and with a log.

<!-- #practice -->
You are `analyst` on web01. The files in your home directory need fixing. Use `ls -l` after each change to check your work.

<!-- #security -->
**Permissions are where most real-world Linux privilege escalation happens.** Kernel exploits make headlines, but attackers who land on a box as a low-privileged user (say `www-data` after a web exploit) usually escalate through misconfigurations: a world-writable script that root runs, a SUID binary that should not be SUID, a sudo rule that is broader than it looks, a readable backup of `/etc/shadow`. Recognising these is a core analyst and auditor skill, and the hardening lesson turns it into a checklist.

**Watch the account files.** A new line in `/etc/passwd` with UID 0, an unexpected member of the `sudo` or `wheel` group, or a new file in `/etc/sudoers.d/` are high-severity findings: each is a way to keep root access. File integrity monitoring and auth-log alerts on `useradd`, `usermod` and `visudo` exist for exactly this.

**Protect password hashes and keys.** If `/etc/shadow` (or a copy of it in a backup, a container image or a world-readable file) leaks, hashes can be cracked offline at billions of guesses per second for weak algorithms. Modern algorithms like yescrypt are deliberately slow, which helps, but strong unique passwords and SSH keys help more. Private keys must be `600` and their directories `700`; SSH refuses keys with looser permissions.

**SUID binaries are attack surface.** Each SUID-root program is code that runs as root on behalf of any user. A bug in one, or a general-purpose tool that wrongly carries the bit, is a path to root. Keep the list short and known.

**Least privilege limits the blast radius.** Running a web server as `www-data` rather than root means a compromised website does not immediately mean a compromised server. Group-based access (`developers`, `adm`) is easier to audit than many individual grants.

<!-- #try-intro -->
On your VM. Steps that need root use `sudo`, which uses *your* password.
