<!-- #program-process -->
A **[[program]]** is a file on disk: `/usr/bin/ls`, `/usr/sbin/sshd`, a Python script. A **[[process]]** is a program *running*: the kernel has loaded it into memory and is scheduling it on a CPU. One program can run as many processes at once; a busy web server may have dozens of `nginx` processes.

The kernel tracks a lot about each process:

- a [[PID]] (process ID), a number unique among running processes
- a [[PPID]], the PID of its parent, the process that created it
- the user and group it runs as (its UID and GID), which decide what it may access
- its memory, its open [[file descriptors|file-descriptor]] and network connections
- its current directory, environment variables and command line
- its [[state|process-state]]: running, sleeping, stopped…

You can see all of it under `/proc/<PID>/`: `cmdline`, `environ`, `cwd`, `exe` (a link to the program file), `fd/` (open files) and `status`.

<!-- #tree -->
Every process except PID 1 (and a couple of kernel threads) has a parent, so processes form a tree with `systemd` at the root. When you log in over SSH, the chain looks like this:

```
$ pstree -p
systemd(1)─┬─cron(640)
           ├─nginx(702)───nginx(703)
           ├─rsyslogd(598)
           └─sshd(812)───sshd(2201)───sshd(2209)───bash(2210)───pstree(2320)
```

`sshd(812)` is the listening server. For each connection it starts a privileged child (2201), which starts an unprivileged child running as you (2209), which starts your login shell, `bash`. Every command you type becomes a child of that shell.

This tree is one of the most useful things to look at in an investigation, because **parent-child relationships reveal behaviour**. A shell whose parent is `sshd` is a normal login. A shell whose parent is `nginx` or `apache2` almost certainly means someone exploited the website.

<!-- #fork-exec -->
How does a shell start a command? Linux uses two separate steps:

1. **[[fork]]**: the shell asks the kernel to duplicate itself. The new child process gets a new PID, and its PPID is the shell’s PID. At this moment it is a copy of the shell.
2. **[[exec]]**: the child calls `execve()` with the path of the program to run. The kernel replaces the child’s program with the new one. The PID stays the same.

Meanwhile the shell **waits** for the child to finish. When the child exits, it leaves an exit status (0 for success, anything else for an error), and until the parent collects that status with `wait`, the dead child remains in the process table as a [[zombie]] (state `Z`, shown as `<defunct>`). Zombies use no memory or CPU, but a buggy parent that never waits can fill the process table with them.

If a parent dies before its children, the children become [[orphans|orphan]] and are adopted by PID 1 (or a designated “subreaper”), which collects their exit status when they finish.

Watch both a foreground and a background command go through these steps:

<!-- #states -->
The `STAT` (or `S`) column of `ps` shows a process’s [[state|process-state]]:

| Code | State | Meaning |
| --- | --- | --- |
| `R` | Running / runnable | On a CPU, or ready and waiting for one |
| `S` | Interruptible sleep | Waiting for something (input, a timer, network). Most processes, most of the time |
| `D` | Uninterruptible sleep | Waiting on I/O, usually disk. Cannot be interrupted, even by SIGKILL, until the I/O completes |
| `T` | Stopped | Paused by a signal such as SIGSTOP or Ctrl+Z |
| `Z` | Zombie | Finished, exit status not yet collected by the parent |
| `I` | Idle | An idle kernel thread |

Extra characters after the letter add detail: `s` session leader, `+` in the foreground process group of its terminal, `<` high priority, `N` low priority, `l` multi-threaded.

<!-- #ps-top -->
[[ps]] takes a snapshot of the process table. Two styles of options exist for historical reasons, and both are worth knowing:

```
$ ps aux            # BSD style: all processes, with user and resource columns
USER   PID %CPU %MEM    VSZ   RSS TTY   STAT START  TIME COMMAND
root     1  0.0  0.6 167744 12880 ?     Ss   08:01  0:02 /sbin/init
analyst 4242 98.7 1.2  31840 24800 ?     R    09:07 14:21 python3 /home/analyst/stress.py

$ ps -ef            # System V style: shows the PPID
UID    PID  PPID  C STIME TTY      TIME CMD
root     1     0  0 08:01 ?    00:00:02 /sbin/init
```

| Column | Meaning |
| --- | --- |
| `USER` / `UID` | Who the process runs as |
| `PID`, `PPID` | Its ID and its parent’s ID |
| `%CPU`, `%MEM` | Share of CPU time and RAM |
| `VSZ`, `RSS` | Virtual memory size and resident (actually in RAM) size, in KiB |
| `TTY` | Controlling terminal; `?` means none (daemons) |
| `STAT` | State (see above) |
| `COMMAND` / `CMD` | The command line. Names in `[brackets]` are kernel threads |

Pick exactly the columns you want with `-o`: `ps -eo pid,ppid,user,stat,cmd`. Find PIDs by name with `pgrep -a nginx`. For a live, sorted view use [[top]] (or the friendlier `htop`): press `P` to sort by CPU, `M` by memory, `k` to send a signal and `q` to quit.

<!-- #signals -->
A [[signal]] is a small asynchronous notification sent to a process: “please stop”, “reload your config”, “you have been interrupted”. Each has a name and a number. The program can install a *handler* to react to most signals in its own way; otherwise the default action applies (usually terminate).

| Signal | No. | Default action | Typical use |
| --- | --- | --- | --- |
| `SIGHUP` | 1 | Terminate | Terminal hung up; many daemons treat it as “reload config” |
| `SIGINT` | 2 | Terminate | Ctrl+C in the terminal |
| `SIGQUIT` | 3 | Terminate + core dump | Ctrl+\ |
| `SIGKILL` | 9 | Terminate | Force kill. **Cannot be caught or ignored** |
| `SIGTERM` | 15 | Terminate | Polite request to exit. The **default** for `kill` |
| `SIGCONT` | 18 | Continue | Resume a stopped process |
| `SIGSTOP` | 19 | Stop | Pause. **Cannot be caught or ignored** |
| `SIGTSTP` | 20 | Stop | Ctrl+Z in the terminal |

(Numbers are for x86 and ARM Linux; a few differ on other architectures, which is one reason to prefer names.)

The difference between [[SIGTERM]] and [[SIGKILL]] matters in practice. SIGTERM *asks*: a well-written program catches it, finishes or saves its work, removes lock and temporary files, and exits. SIGKILL is not even delivered to the program; the kernel simply destroys it, so nothing gets cleaned up. Always try SIGTERM first and use SIGKILL only if the process ignores it.

```
kill 4242            # sends SIGTERM (15)
kill -TERM 4242      # the same, explicitly
kill -9 4242         # SIGKILL: last resort
kill -l              # list signal names
pkill -f stress.py   # signal processes by matching their command line
```

You may only signal your own processes, unless you are root. When a process is killed by a signal, the shell reports an exit status of 128 + the signal number: 143 for SIGTERM, 137 for SIGKILL, 130 for Ctrl+C. Try each signal on a backup script that has a cleanup handler:

<!-- #jobs -->
A command normally runs in the **[[foreground]]**: the shell waits and your keyboard input goes to it. Adding `&` runs it in the **[[background]]**, so you get your prompt back at once. This is called *[[job control]]*:

| Action | How |
| --- | --- |
| Start in the background | `long-command &` |
| List this shell’s jobs | `jobs` |
| Pause the foreground job | Ctrl+Z (sends SIGTSTP) |
| Resume it in the background | `bg` |
| Bring a job to the foreground | `fg %1` |
| Keep running after logout | `nohup long-command &` (ignores SIGHUP) |

When you log out, the terminal “hangs up” and its jobs normally receive SIGHUP and exit. `nohup`, `setsid`, `screen` and `tmux` are the usual ways to keep work running, and attackers use exactly the same tricks for their tools.

<!-- #systemd -->
Long-running services are not started by hand from a shell. systemd starts and supervises them using **[[unit files|unit-file]]**. A service unit looks like this:

```
# /usr/lib/systemd/system/nginx.service (abridged)
[Unit]
Description=A high performance web server and a reverse proxy server
After=network.target

[Service]
Type=forking
ExecStart=/usr/sbin/nginx -g 'daemon on; master_process on;'
ExecReload=/usr/sbin/nginx -s reload
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Units shipped by packages live in `/usr/lib/systemd/system/` (on older Debian/Ubuntu, `/lib/systemd/system/`). Units and overrides written by administrators go in `/etc/systemd/system/`, which takes priority. Users can also have their own units in `~/.config/systemd/user/`.

You control units with [[systemctl]]:

| Command | Effect |
| --- | --- |
| `systemctl status nginx` | State, main PID and the latest log lines |
| `sudo systemctl start nginx` / `stop` / `restart` | Start, stop or restart now |
| `sudo systemctl reload nginx` | Ask it to re-read its config without restarting |
| `sudo systemctl enable nginx` | Start automatically **at boot** (does not start it now) |
| `sudo systemctl disable nginx` | Do not start at boot |
| `sudo systemctl enable --now nginx` | Enable and start in one go (`disable --now` does the reverse) |
| `systemctl is-enabled nginx`, `is-active nginx` | Quick yes/no checks |
| `systemctl list-units --type=service` | Services currently loaded |
| `systemctl list-unit-files --state=enabled` | Everything set to start at boot |
| `journalctl -u nginx` | That unit’s logs |

[[Enabling|enable]] a unit just creates a symlink in the `.wants` directory of its target, for example `/etc/systemd/system/multi-user.target.wants/nginx.service`. So “which services start at boot?” is literally a question about which symlinks exist.

<!-- #cron -->
[[cron]] runs commands on a schedule. Each user can have a [[crontab]] (edit with `crontab -e`, list with `crontab -l`, stored under `/var/spool/cron/`), and the system has `/etc/crontab` plus files in `/etc/cron.d/`. Each line has five time fields and then the command:

```
# ┌───────── minute (0–59)
# │ ┌─────── hour (0–23)
# │ │ ┌───── day of month (1–31)
# │ │ │ ┌─── month (1–12)
# │ │ │ │ ┌─ day of week (0–7, 0 and 7 are Sunday)
# │ │ │ │ │
  30 2 * * *   /usr/local/bin/backup.sh       # 02:30 every day
  */5 * * * *  /usr/local/bin/check-disk.sh   # every 5 minutes
  0 9 * * 1-5  /usr/local/bin/report.sh       # 09:00 Monday to Friday
  @reboot      /usr/local/bin/on-boot.sh      # once at every boot
```

`*` means “every”, `*/5` means “every 5th”, `1-5` is a range and `1,15` a list. In `/etc/crontab` and `/etc/cron.d/` there is an extra field, the **user** to run as, between the time fields and the command. Scripts dropped into `/etc/cron.hourly`, `cron.daily`, `cron.weekly` and `cron.monthly` are run by `run-parts` on those schedules.

Modern systems also use **[[systemd timers|systemd-timer]]**, `.timer` units that start a matching `.service` on a schedule. List them with `systemctl list-timers`.

<!-- #practice -->
Something on web01 is eating all the CPU, and two other processes need attention. You are `analyst`; all three processes belong to you.

<!-- #security -->
**Process listings are primary evidence.** When triaging a Linux host, analysts look for processes that do not fit: a shell or `curl` whose parent is a web server or database, programs running from `/tmp`, `/dev/shm` or hidden directories, binaries whose `/proc/<PID>/exe` link ends in `(deleted)`, names chosen to blend in (a user process called `[kworker/0:1]` imitating a kernel thread), unexpected outbound connections (`sudo ss -tnp`), and processes running as root that have no reason to.

**Do not kill first.** In incident response, terminating a malicious process destroys evidence that only exists in memory: decrypted payloads, network connections, the deleted binary. The usual order is: record what you see (`ps`, `/proc/<PID>/` details, open connections), contain the host (isolate it from the network), capture memory if you can, and only then stop the process.

**Services and cron are the classic persistence spots.** An attacker who wants to survive reboots adds a systemd service or timer, a crontab line or a script in `/etc/cron.d/`. Audits compare enabled units, crontabs and timers against a known-good baseline. Look in all of: `/etc/crontab`, `/etc/cron.d/`, `/etc/cron.*/`, `/var/spool/cron/`, `/etc/systemd/system/`, `~/.config/systemd/user/`.

**Who a service runs as decides the blast radius.** A service running as root that gets exploited gives the attacker root. Unit files can drop privileges (`User=`), and systemd offers sandboxing options (`ProtectSystem=`, `NoNewPrivileges=`, `PrivateTmp=`) that limit what a compromised service can touch.

<!-- #try-intro -->
On your VM:
