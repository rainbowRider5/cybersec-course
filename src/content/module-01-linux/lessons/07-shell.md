<!-- #shell -->
The [[shell]] is the program that reads your commands, runs them and shows you the results. On most Linux systems the interactive shell is [[bash]] (the Bourne-Again SHell). Others you will meet are `sh` (on Debian/Ubuntu actually `dash`, a small fast shell used for system scripts) and `zsh` (the macOS default). Everything here works in all of them unless noted.

A command line is made of **words** separated by spaces: the command, then its options, then its arguments.

```
ls  -l  -a  /var/log
│   └─┬─┘   └───┬──┘
│  options   argument
command
```

Short options can be combined (`ls -la` is `ls -l -a`); long options use two dashes (`--all`). `man ls` shows the manual for a command and `ls --help` a short summary. Press `q` to leave `man`.

The shell processes the line **before** the command ever runs:

- **Quoting.** Inside `'single quotes'` nothing is special. Inside `"double quotes"` variables like `$HOME` are still expanded but spaces do not split words. So `grep "Failed password" auth.log` searches for the two-word phrase.
- **Globbing.** `*` matches any characters and `?` one character, so `ls /etc/*.conf` lists matching files. The shell expands the pattern into file names; the command never sees the `*`. To pass a literal `*` to a command (like `find -name "*.sh"`), quote it.
- **Variables.** `$NAME` is replaced by the variable’s value.

<!-- #streams -->
Every process starts with three open [[file descriptors|file-descriptor]] (lesson 1):

| fd | Name | Default |
| --- | --- | --- |
| 0 | [[stdin]] (standard input) | the keyboard |
| 1 | [[stdout]] (standard output) | the terminal |
| 2 | [[stderr]] (standard error) | the terminal |

Normal output goes to stdout and error messages to stderr, which is why you can separate them. [[Redirection]] connects these descriptors to files instead:

| Syntax | Effect |
| --- | --- |
| `cmd > file` | stdout to `file`, **overwriting** it |
| `cmd >> file` | stdout to `file`, **appending** |
| `cmd < file` | stdin from `file` |
| `cmd 2> file` | stderr to `file` |
| `cmd 2> /dev/null` | Throw error messages away ([[/dev/null|dev-null]] discards everything written to it) |
| `cmd > file 2>&1` | stdout to `file`, then stderr to wherever stdout goes (the order matters) |
| `cmd &> file` | Both to `file` (bash shortcut) |

A [[pipe]], `|`, connects the stdout of one command to the stdin of the next, so small tools can be chained into a pipeline. Each tool does one simple job; the pipe does the plumbing.

Every command also finishes with an [[exit status]]: **0 means success**, anything else means failure. The shell keeps the last one in `$?`. You can chain on it: `cmd1 && cmd2` runs cmd2 only if cmd1 succeeded, `cmd1 || cmd2` only if it failed, and `cmd1 ; cmd2` runs both regardless.

<!-- #pipeline -->
Here is the most useful pipeline in log analysis, on a small file of login results. Step the data through it, then try unticking `sort` to see why it is there.

<!-- #text-tools -->
These are the text tools you will use daily. All of them read files named as arguments, or stdin if there are none, so they work both alone and in pipelines.

| Tool | Does | Examples |
| --- | --- | --- |
| [[grep]] | Print lines matching a pattern | `grep -i error syslog` (ignore case), `-v` (lines NOT matching), `-n` (line numbers), `-c` (count), `-r` (recurse into directories), `-E` (extended [[regex]]), `-o` (only the matching part) |
| [[cut]] | Cut out fields or characters | `cut -d: -f1 /etc/passwd` (field 1, `:` delimiter), `cut -c1-10` |
| [[awk]] | A small language for column-based text | `awk '{print $1}'` (first whitespace field), `awk -F: '$3 >= 1000 {print $1}' /etc/passwd`, `$NF` is the last field |
| `sort` | Sort lines | `-n` numeric, `-r` reverse, `-u` unique, `-k2` by the 2nd field, `-t:` field separator |
| `uniq` | Collapse **adjacent** duplicate lines | `-c` count, `-d` only duplicated lines. Almost always after `sort` |
| `wc` | Count | `wc -l` lines, `-w` words, `-c` bytes |
| `head` / `tail` | First / last lines | `head -n 5`, `tail -n 20`, `tail -f` follows a growing file live |

Combined, they answer real questions quickly:

```
# Which IPs failed SSH logins most often?
grep "Failed password" /var/log/auth.log | awk '{print $(NF-3)}' | sort | uniq -c | sort -rn

# Which accounts have a real login shell?
grep -v -E 'nologin|false' /etc/passwd | cut -d: -f1

# The 10 most recent sudo commands
grep 'COMMAND=' /var/log/auth.log | tail -n 10
```

(`$(NF-3)` in the first example is the fourth field from the end, which is always the IP address in those lines, whether or not they contain “invalid user”.)

<!-- #find -->
[[find]] searches the directory tree for files matching tests, starting from one or more paths:

```
find /etc -name "*.conf"                 # by name (quote the pattern!)
find /home -type f -user bob             # regular files owned by bob
find / -type f -perm -4000 2>/dev/null   # files with the SUID bit set
find / -type f -perm -0002 2>/dev/null   # world-writable files
find /var/www -mtime -2                  # modified in the last 2 days
find /tmp -type f -newer /etc/passwd     # modified more recently than /etc/passwd
find / -size +100M 2>/dev/null           # larger than 100 MiB
```

`-type f` is a regular file, `d` a directory, `l` a symlink. In `-perm`, a leading `-` means “all of these bits are set” and `/` means “any of these bits”; with neither it means “exactly this mode”. Searching from `/` as a normal user produces many “Permission denied” errors on stderr, hence `2>/dev/null`. `-exec cmd {} \;` runs a command on each result; always look at the list before acting on it.

<!-- #env -->
An [[environment variable]] is a named value that every process inherits from its parent. Some are set at login:

| Variable | Holds |
| --- | --- |
| `HOME` | Your home directory |
| `USER` | Your username |
| `PWD` | The current directory |
| `SHELL` | Your login shell |
| `PATH` | Where to look for commands |

Show one with `echo $HOME`, all of them with `env`. `NAME=value` creates a shell variable; `export NAME` (or `export NAME=value`) puts it in the environment so programs you start inherit it.

[[PATH]] deserves special attention. When you type a command without a `/`, the shell searches each directory in `PATH`, in order, and runs the **first** match:

```
$ echo $PATH
/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
$ which ls
/usr/bin/ls
$ type cd
cd is a shell builtin
```

The current directory is deliberately **not** in `PATH`. That is why you run a script in the current directory as `./script.sh`: the `./` is an explicit path, so no search happens.

<!-- #scripts -->
A [[shell script]] is a text file of commands. Start it with a [[shebang]] line, which tells the kernel which interpreter to run it with, then make it executable:

```bash
#!/bin/bash
# failed-logins.sh: summarise failed SSH logins per source IP
set -euo pipefail                  # stop on errors, unset variables and failed pipes

LOG="${1:-/var/log/auth.log}"      # first argument, or a default

if [[ ! -r "$LOG" ]]; then
    echo "Cannot read $LOG (try sudo)" >&2
    exit 1
fi

echo "Failed SSH logins per IP in $LOG:"
grep "Failed password" "$LOG" \
    | awk '{print $(NF-3)}' \
    | sort | uniq -c | sort -rn \
    | head -n 10
```

```
$ chmod +x failed-logins.sh
$ sudo ./failed-logins.sh
Failed SSH logins per IP in /var/log/auth.log:
      6 203.0.113.45
      2 198.51.100.77
```

Things to notice:

- `$1`, `$2`… are the script’s arguments, `$#` is how many there are and `"$@"` is all of them.
- **Always quote variables**: `"$LOG"`, not `$LOG`. Unquoted, a value containing spaces or `*` is split into words and glob-expanded, a classic source of bugs and security holes.
- `>&2` sends the error message to stderr, and `exit 1` returns a failure status to whoever ran the script.
- `set -euo pipefail` makes the script stop at the first failing command instead of carrying on with bad data.
- You can also run a script without the execute bit as `bash script.sh`. The interpreter only needs to *read* it.

<!-- #practice -->
Put it together on web01. `logins.txt` in your home directory is the file from the pipeline diagram, and `/var/log/auth.log` is the log from the previous lesson.

<!-- #security -->
**Attackers use exactly these tools.** “Living off the land” means using what is already installed: `find` to locate SUID binaries and writable files, `grep -r password` to hunt for credentials in config files, `curl … | bash` to download and run code, `history -c` to cover tracks. Recognising these command lines in logs, EDR telemetry or a compromised user’s history is part of the job. And the same pipelines make you fast at triage: one line of `grep | awk | sort | uniq -c` turns a 50,000-line log into a ranked list of attackers.

**[[PATH hijacking|path-hijacking]].** Because the shell runs the first match in `PATH`, anyone who can write to a directory that comes *early* in someone’s `PATH` can plant a program called `ls` or `sudo` there and have it run instead of the real one. It is especially dangerous when root’s `PATH`, or the `PATH` of a cron job or root-run script, includes a writable directory, or `.` (the current directory). Defences: never put `.` or user-writable directories in root’s `PATH`, use absolute paths (`/usr/bin/tar`) in privileged scripts, and keep sudo’s `secure_path`.

**Quoting is a security control.** A root-run script that does `rm -rf $DIR/` with an unquoted, unset or attacker-controlled variable can do enormous damage, and scripts that pass user input to `eval` or build command lines from it are vulnerable to command injection. Quote every variable and treat input as data, never as code.

**Secrets leak through the shell.** Passwords typed as command-line arguments (`mysql -pSecret`) end up in `.bash_history` and are visible to every user in `ps` output while the command runs. Environment variables of a process can be read from `/proc/<PID>/environ` by its owner and root. Prefer config files with `600` permissions or prompts.

<!-- #try-intro -->
On your VM:
