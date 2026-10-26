import type { Lesson } from '../../../course/types';
import { chunks } from '../../../course/chunks';
import raw from './07-shell.md?raw';
import PipelineViz from '../visualizations/PipelineViz';
import { lastOut, modeOf, node, ran, shellScenario } from '../scenarios';

const t = chunks(raw);

const lesson: Lesson = {
  slug: 'shell',
  title: 'The shell and Bash scripting basics',
  summary: 'stdin, stdout and stderr, redirection and pipes, grep, cut, awk, sort and uniq, find, environment variables and PATH, and writing a small script.',
  estimatedMinutes: 55,
  objectives: [
    'Explain stdin, stdout and stderr and use redirection (`>`, `>>`, `2>`, `2>&1`).',
    'Build pipelines with `grep`, `cut`, `awk`, `sort`, `uniq -c` and `wc`.',
    'Search the filesystem with `find` by name, type, owner, permissions and age.',
    'Explain environment variables, how `PATH` lookup works and why `./` is needed.',
    'Write, make executable and run a small Bash script that uses arguments and exit codes.',
    'Recognise PATH hijacking and unquoted-variable risks.',
  ],
  sections: [
    { id: 'shell', title: 'What the shell does', blocks: [t('shell')] },
    { id: 'streams', title: 'Standard streams, redirection and pipes', blocks: [t('streams')] },
    {
      id: 'pipeline',
      title: 'A pipeline, step by step',
      blocks: [t('pipeline'), { kind: 'viz', title: 'Data flowing through `cat | grep | sort | uniq -c`', component: PipelineViz, caption: 'Change the grep pattern, remove `sort`, or add a final `sort -rn`.' }],
    },
    { id: 'text-tools', title: 'Text tools: grep, cut, awk, sort, uniq, wc', blocks: [t('text-tools')] },
    { id: 'find', title: 'Finding files with find', blocks: [t('find')] },
    { id: 'env', title: 'Environment variables and PATH', blocks: [t('env')] },
    { id: 'scripts', title: 'Writing a script', blocks: [t('scripts')] },
    {
      id: 'practice',
      title: 'Practice: pipelines, find and a script',
      blocks: [
        t('practice'),
        {
          kind: 'terminal',
          title: 'web01: analyst',
          scenario: shellScenario(),
          tall: true,
          tasks: [
            {
              id: 'count-pipeline',
              solution: ['grep FAIL logins.txt | sort | uniq -c'],
              instruction: 'Using `logins.txt`, build a pipeline that counts the FAIL lines per IP.',
              hint: '`grep FAIL logins.txt | sort | uniq -c`',
              check: (s) => /^\s*4 FAIL 203\.0\.113\.45$/m.test(lastOut(s)) && /uniq\s+-c/.test(s.lastCommand),
              success: '203.0.113.45 failed 4 times. Add `| sort -rn` to put the biggest count first.',
            },
            {
              id: 'save',
              solution: ['grep "Failed password" /var/log/auth.log > ~/failed.txt'],
              instruction: 'Save just the “Failed password” lines of `/var/log/auth.log` into a new file `~/failed.txt`.',
              hint: '`grep "Failed password" /var/log/auth.log > ~/failed.txt`, then `cat ~/failed.txt`.',
              check: (s) => {
                const c = node(s, '/home/analyst/failed.txt')?.content ?? '';
                const lines = c.trim().split('\n').filter(Boolean);
                return lines.length > 0 && lines.every((l) => l.includes('Failed password'));
              },
              success: '`>` sent stdout into the file instead of the screen. Running it again would overwrite the file; `>>` would append.',
            },
            {
              id: 'per-ip',
              solution: ["grep \"Failed password\" /var/log/auth.log | awk '{print $(NF-3)}' | sort | uniq -c | sort -rn"],
              instruction: 'Now rank the source IPs of failed SSH passwords in `/var/log/auth.log`, highest count first.',
              hint: "`grep \"Failed password\" /var/log/auth.log | awk '{print $(NF-3)}' | sort | uniq -c | sort -rn`",
              check: (s) => /^\s*6 203\.0\.113\.45\s*$/.test(lastOut(s).split('\n')[0] ?? ''),
              success: '6 failures from 203.0.113.45, 2 from 198.51.100.77. You just reproduced a SIEM dashboard in one line.',
            },
            {
              id: 'find-sh',
              solution: ['find ~ -name "*.sh"'],
              instruction: 'Use `find` to list every file ending in `.sh` under your home directory.',
              hint: '`find ~ -name "*.sh"` (quote the pattern).',
              check: (s) => ran(s, /^find\b.*-i?name/) && lastOut(s).includes('scripts/hello.sh'),
              success: 'Found `scripts/hello.sh`.',
            },
            {
              id: 'run-script',
              solution: ['chmod u+x scripts/hello.sh', './scripts/hello.sh'],
              instruction: 'Make `scripts/hello.sh` executable by its owner, then run it.',
              hint: '`chmod u+x scripts/hello.sh` then `./scripts/hello.sh`',
              check: (s) => (modeOf(s, '/home/analyst/scripts/hello.sh') & 0o100) !== 0 && ran(s, /^(\.\/|~\/|\/home\/analyst\/)?scripts\/hello\.sh/) && lastOut(s).includes('Hello'),
              success: 'The shebang told the kernel to run it with bash, and the variables `$USER` and `$PWD` were filled in from the environment.',
            },
            {
              id: 'path',
              solution: ['echo $PATH', 'export PATH="$HOME/bin:$PATH"'],
              instruction: 'Show your `PATH`, then add `~/bin` to the **front** of it for this session.',
              hint: '`echo $PATH`, then `export PATH="$HOME/bin:$PATH"`',
              check: (s) => ran(s, /echo.*\$PATH/) && (s.env.PATH ?? '').split(':')[0].replace(/\/$/, '') === '/home/analyst/bin',
              success: 'Commands in `~/bin` now win over system ones with the same name. Handy, and exactly why a writable directory early in root’s PATH is dangerous.',
            },
          ],
        },
      ],
    },
  ],
  security: [t('security')],
  tryIt: {
    intro: t('try-intro'),
    steps: [
      { instruction: 'Separate stdout from stderr.', command: 'find / -name "*.conf" > found.txt 2> errors.txt\nwc -l found.txt errors.txt\nfind / -name "sshd_config" 2>/dev/null' },
      { instruction: 'Practise the text tools on /etc/passwd.', command: "cut -d: -f1,7 /etc/passwd | head\nawk -F: '$3 >= 1000 {print $1, $6}' /etc/passwd\ncut -d: -f7 /etc/passwd | sort | uniq -c | sort -rn" },
      { instruction: 'Hunt for risky files the way an auditor (or attacker) would.', command: 'sudo find / -xdev -type f -perm -4000 2>/dev/null\nsudo find / -xdev -type f -perm -0002 2>/dev/null\nfind /tmp /var/tmp -type f -mtime -1 2>/dev/null' },
      { instruction: 'See PATH lookup in action.', command: 'echo $PATH\nwhich python3 ls\ntype cd ls\nenv | sort | head' },
      {
        instruction: 'Write the failed-login script from this lesson and run it.',
        command: 'mkdir -p ~/bin && nano ~/bin/failed-logins.sh   # paste the script, save\nchmod +x ~/bin/failed-logins.sh\nsudo ~/bin/failed-logins.sh',
        note: 'On RHEL-family systems pass the log path: `sudo ~/bin/failed-logins.sh /var/log/secure`.',
      },
      { instruction: 'Check a script for common mistakes with ShellCheck.', command: 'sudo apt install shellcheck\nshellcheck ~/bin/failed-logins.sh' },
    ],
  },
  quiz: [
    {
      id: 'm1-sh-devnull',
      type: 'single',
      section: 'streams',
      prompt: 'What does `2>/dev/null` do at the end of a command?',
      options: ['Sends the output to a second file called null', 'Discards the command’s error messages (stderr)', 'Runs the command twice', 'Discards all output'],
      answer: 1,
      explanation: 'File descriptor 2 is stderr; redirecting it to `/dev/null` throws error messages away while normal output (stdout) still appears.',
    },
    {
      id: 'm1-sh-append',
      type: 'single',
      section: 'streams',
      prompt: 'What is the difference between `> report.txt` and `>> report.txt`?',
      options: ['None', '`>` overwrites the file; `>>` appends to it', '`>` appends; `>>` overwrites', '`>>` redirects stderr'],
      answer: 1,
      explanation: '`>` truncates the file first, `>>` adds to the end. Using `>` by accident is a classic way to destroy a log file.',
    },
    {
      id: 'm1-sh-uniq-nosort',
      type: 'output',
      section: 'pipeline',
      prompt: 'Why does the same IP appear several times, with counts that are too small?',
      exhibit: { label: '$ grep FAIL logins.txt | uniq -c', text: '      1 FAIL 203.0.113.45\n      1 FAIL 198.51.100.77\n      2 FAIL 203.0.113.45\n      1 FAIL 198.51.100.77\n      1 FAIL 203.0.113.45\n      1 FAIL 192.0.2.10' },
      options: ['grep is broken', '`uniq` only merges adjacent duplicates, so the input must be sorted first', 'The file has duplicate IPs with different spellings', '`-c` counts characters, not lines'],
      answer: 1,
      explanation: 'Put `sort` before `uniq -c`: `grep FAIL logins.txt | sort | uniq -c`. Sorting brings identical lines together.',
    },
    {
      id: 'm1-sh-wc',
      type: 'text',
      section: 'text-tools',
      prompt: 'Which command, placed at the end of a pipeline, prints how many lines it received?',
      accepted: ['wc -l', 'wc --lines'],
      placeholder: 'command',
      explanation: '`wc -l` counts lines. `grep -c PATTERN file` is a shortcut when you only need to count matches.',
    },
    {
      id: 'm1-sh-path',
      type: 'single',
      section: 'env',
      prompt: 'What does the `PATH` environment variable control?',
      options: [
        'The current directory',
        'The ordered list of directories the shell searches for a command typed without a `/`',
        'Where log files are written',
        'Which files a user may read',
      ],
      answer: 1,
      explanation: 'The first match in PATH order wins. That is why `./script.sh` is needed for a script in the current directory, and why writable directories early in PATH are dangerous.',
    },
    {
      id: 'm1-sh-find-perm',
      type: 'output',
      section: 'find',
      prompt: 'What does this command list?',
      exhibit: { label: 'command', text: 'find / -type f -perm -4000 2>/dev/null' },
      options: ['Files larger than 4000 bytes', 'Regular files that have the SUID bit set', 'Files with mode exactly 4000', 'Files modified in the last 4000 minutes'],
      answer: 1,
      explanation: '`-perm -4000` matches files with (at least) the 4000 bit, which is SUID. `2>/dev/null` hides the permission errors from directories you cannot read.',
    },
    {
      id: 'm1-sh-path-risk',
      type: 'multi',
      section: 'security',
      prompt: 'Which of these entries in **root’s** `PATH` would be a security risk? Select all that apply.',
      options: ['`.` (the current directory)', '`/tmp/tools`, placed before `/usr/bin`', '`/usr/sbin`', '`/home/bob/bin`, placed first', '`/usr/bin`'],
      answers: [0, 1, 3],
      explanation: 'Any directory that other users can write to (or the current directory, wherever root happens to be) lets someone plant a fake `ls` or `sudo` that root then runs. System directories owned by root are fine.',
    },
    {
      id: 'm1-sh-term-uniq',
      type: 'terminal',
      section: 'pipeline',
      prompt: 'In the terminal, count how many times each line occurs in `~/logins.txt`, with the counts in front.',
      scenario: shellScenario(),
      task: {
        id: 'count-logins',
        solution: ['sort logins.txt | uniq -c'],
        instruction: 'Print each distinct line of `logins.txt` with its count (for example `4 FAIL 203.0.113.45`).',
        hint: '`sort logins.txt | uniq -c`',
        check: (s) => /^\s*4 FAIL 203\.0\.113\.45$/m.test(lastOut(s)) && /^\s*2 OK 198\.51\.100\.23$/m.test(lastOut(s)),
      },
      explanation: '`sort logins.txt | uniq -c` (or `cat logins.txt | sort | uniq -c`). Sorting first is what makes the counts correct.',
    },
    {
      id: 'm1-sh-shebang',
      type: 'single',
      section: 'scripts',
      prompt: 'What does the first line `#!/bin/bash` of a script do?',
      options: ['It is a comment with no effect', 'It tells the kernel which interpreter to run the script with when it is executed directly', 'It makes the script executable', 'It runs the script as root'],
      answer: 1,
      explanation: 'The shebang names the interpreter. The script still needs the execute bit (`chmod +x`) to be run as `./script.sh`.',
    },
    {
      id: 'm1-sh-cut',
      type: 'single',
      section: 'text-tools',
      prompt: 'Which command prints only the usernames from `/etc/passwd`?',
      options: ['`cut -d: -f1 /etc/passwd`', '`cut -f1 /etc/passwd`', '`grep -f1 /etc/passwd`', '`sort -u /etc/passwd`'],
      answer: 0,
      explanation: 'Fields in /etc/passwd are separated by colons, so tell cut the delimiter with `-d:` and pick field 1 with `-f1`. Without `-d`, cut splits on tabs. `awk -F: \'{print $1}\' /etc/passwd` also works.',
    },
  ],
};

export default lesson;
