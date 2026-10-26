import {
  FsError,
  absPath,
  assignInodes,
  basename,
  can,
  homeOf,
  inGroup,
  isRoot,
  linkCount,
  lookup,
  modeString,
  nodeSize,
  octal,
  parentAndName,
  parentForWrite,
  peek,
  splitPath,
  tryLookup,
  userDef,
  walkTree,
} from './fs';
import { ParseError, globToRegExp, parse, tokenize, type SimpleCommand } from './parse';
import type { FsNode, ProcessDef, TerminalScenario, TerminalState } from './types';

/* ------------------------------------------------------------------ */
/* Session                                                             */
/* ------------------------------------------------------------------ */

export function createState(scenario: TerminalScenario): TerminalState {
  const s = structuredClone(scenario);
  assignInodes(s.fs);
  const user = s.users.find((u) => u.name === s.user);
  return {
    hostname: s.hostname,
    user: s.user,
    cwd: s.cwd,
    prevCwd: s.cwd,
    users: s.users,
    groups: s.groups,
    fs: s.fs,
    processes: s.processes,
    services: s.services,
    env: {
      USER: s.user,
      HOME: user?.home ?? '/',
      SHELL: '/bin/bash',
      PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      LANG: 'C.UTF-8',
      HOSTNAME: s.hostname,
      PWD: s.cwd,
      ...s.env,
    },
    umask: s.umask ?? 0o022,
    whoOutput: s.whoOutput ?? '',
    lastOutput: s.lastOutput ?? '',
    history: [],
    lastCommand: '',
    lastStdout: '',
    lastExitCode: 0,
    signals: [],
    nextPid: 3000,
  };
}

export interface OutputLine {
  kind: 'out' | 'err' | 'info';
  text: string;
}

export interface RunResult {
  lines: OutputLine[];
  clear: boolean;
}

interface Ctx {
  state: TerminalState;
  stdin: string | null;
  /** True when stdout goes to the screen (not a pipe or file). Changes how `ls` lays out names. */
  tty: boolean;
}

interface CmdResult {
  out: string;
  err: string;
  code: number;
  info?: string;
  clear?: boolean;
}

type Cmd = (args: string[], ctx: Ctx) => CmdResult;

const ok = (out = ''): CmdResult => ({ out, err: '', code: 0 });
const fail = (err: string, code = 1, out = ''): CmdResult => ({ out, err: err.endsWith('\n') ? err : err + '\n', code });

/** User switches made with `sudo -i` / `su`; `exit` pops them. */
const userStacks = new WeakMap<TerminalState, string[]>();

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export function run(state: TerminalState, line: string): RunResult {
  const trimmed = line.trim();
  const result: RunResult = { lines: [], clear: false };
  if (!trimmed) return result;
  state.history.push(trimmed);
  state.lastCommand = trimmed;
  state.lastStdout = '';

  let list;
  try {
    list = parse(tokenize(trimmed, state.env, homeOf(state), state.lastExitCode));
  } catch (e) {
    if (e instanceof ParseError) {
      result.lines.push({ kind: 'err', text: `bash: ${e.message}` });
      state.lastExitCode = 2;
      return result;
    }
    throw e;
  }

  let stdoutAll = '';
  for (const item of list) {
    if (item.join === '&&' && state.lastExitCode !== 0) continue;
    if (item.join === '||' && state.lastExitCode === 0) continue;
    const r = runPipeline(state, item.pipeline);
    for (const l of r.lines) result.lines.push(l);
    if (r.clear) {
      result.clear = true;
      result.lines = [];
    }
    stdoutAll += r.stdout;
  }
  state.lastStdout = stdoutAll;
  return result;
}

function runPipeline(state: TerminalState, pipeline: SimpleCommand[]): RunResult & { stdout: string } {
  const lines: OutputLine[] = [];
  let stdin: string | null = null;
  let code = 0;
  let clear = false;
  let finalOut = '';

  pipeline.forEach((cmd, idx) => {
    const last = idx === pipeline.length - 1;
    const argv = expandArgv(state, cmd.argv);

    if (cmd.stdinFile) {
      try {
        stdin = readFile(state, absPath(state, cmd.stdinFile));
      } catch (e) {
        lines.push({ kind: 'err', text: `bash: ${cmd.stdinFile}: ${(e as Error).message}` });
        code = 1;
        stdin = '';
        return;
      }
    }
    const tty = last && !cmd.redirects.some((r) => r.fd === 1);
    const r = exec(state, argv, { state, stdin, tty });
    let out = r.out;
    let err = r.err;
    if (cmd.stderrToStdout) {
      out = err + out;
      err = '';
    }
    for (const red of cmd.redirects) {
      const data = red.fd === 1 ? out : err;
      const wr = writeRedirect(state, red.target, data, red.append);
      if (wr) {
        lines.push({ kind: 'err', text: wr });
        r.code = 1;
      }
      if (red.fd === 1) out = '';
      else err = '';
    }
    if (err) pushText(lines, 'err', err);
    if (r.info) pushText(lines, 'info', r.info);
    if (r.clear) clear = true;
    code = r.code;
    if (last) {
      finalOut = out;
      if (out) pushText(lines, 'out', out);
    } else {
      stdin = out;
    }
  });
  state.lastExitCode = code;
  return { lines, clear, stdout: finalOut };
}

function pushText(lines: OutputLine[], kind: OutputLine['kind'], text: string) {
  const t = text.endsWith('\n') ? text.slice(0, -1) : text;
  for (const l of t.split('\n')) lines.push({ kind, text: l });
}

/* ------------------------------------------------------------------ */
/* Expansion                                                           */
/* ------------------------------------------------------------------ */

function expandArgv(state: TerminalState, words: { value: string; glob: boolean }[]): string[] {
  const out: string[] = [];
  for (const w of words) {
    if (!w.glob) {
      out.push(w.value);
      continue;
    }
    const matches = expandGlob(state, w.value);
    if (matches.length) out.push(...matches);
    else out.push(w.value);
  }
  return out;
}

function expandGlob(state: TerminalState, pattern: string): string[] {
  const absolute = pattern.startsWith('/');
  const parts = pattern.split('/').filter(Boolean);
  let paths: string[] = [absolute ? '/' : ''];
  for (const part of parts) {
    const next: string[] = [];
    for (const p of paths) {
      const join = (name: string) => (p === '' ? name : p.endsWith('/') ? p + name : `${p}/${name}`);
      if (!/[*?[]/.test(part)) {
        next.push(join(part));
        continue;
      }
      const node = tryLookup(state, absPath(state, p || '.'));
      if (!node || node.type !== 'dir' || !can(state, node, 'r')) continue;
      const re = globToRegExp(part);
      for (const name of Object.keys(node.children!).sort()) {
        if (name.startsWith('.') && !part.startsWith('.')) continue;
        if (re.test(name)) next.push(join(name));
      }
    }
    paths = next;
  }
  return paths.filter((p) => p && tryLookup(state, absPath(state, p), false));
}

/* ------------------------------------------------------------------ */
/* File helpers                                                        */
/* ------------------------------------------------------------------ */

function readFile(state: TerminalState, abs: string): string {
  if (abs === '/dev/null') return '';
  const node = lookup(state, abs);
  if (node.type === 'dir') throw new FsError('Is a directory');
  if (!can(state, node, 'r')) throw new FsError('Permission denied');
  return node.content ?? '';
}

function primaryGroup(state: TerminalState): string {
  return userDef(state)?.groups[0] ?? state.user;
}

function nowStamp(): string {
  const d = new Date();
  const mon = d.toLocaleString('en-US', { month: 'short' });
  const day = String(d.getDate()).padStart(2, ' ');
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${mon} ${day} ${hm}`;
}

function writeFile(state: TerminalState, abs: string, data: string, append: boolean): void {
  if (abs === '/dev/null') return;
  const existing = tryLookup(state, abs);
  if (existing) {
    if (existing.type === 'dir') throw new FsError('Is a directory');
    if (!can(state, existing, 'w')) throw new FsError('Permission denied');
    existing.content = append ? (existing.content ?? '') + data : data;
    existing.size = undefined;
    existing.mtime = nowStamp();
    return;
  }
  const { parent, name } = parentForWrite(state, abs);
  parent.children![name] = {
    type: 'file',
    mode: 0o666 & ~state.umask,
    owner: state.user,
    group: primaryGroup(state),
    content: data,
    mtime: nowStamp(),
    ino: 140000 + Math.floor(Math.random() * 9000),
  };
}

function writeRedirect(state: TerminalState, target: string, data: string, append: boolean): string | null {
  try {
    writeFile(state, absPath(state, target), data, append);
    return null;
  } catch (e) {
    return `bash: ${target}: ${(e as Error).message}`;
  }
}

/** Parses combined short flags: "-la" -> {l, a}. Returns remaining positional args. */
function flags(args: string[], withValue: string[] = []): { f: Set<string>; v: Record<string, string>; rest: string[] } {
  const f = new Set<string>();
  const v: Record<string, string> = {};
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      rest.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      f.add(a);
      continue;
    }
    if (a.startsWith('-') && a.length > 1 && !/^-\d+$/.test(a)) {
      for (let j = 1; j < a.length; j++) {
        const ch = a[j];
        if (withValue.includes(ch)) {
          const val = a.slice(j + 1) || args[++i] || '';
          v[ch] = val;
          break;
        }
        f.add(ch);
      }
      continue;
    }
    rest.push(a);
  }
  return { f, v, rest };
}

function inputFrom(ctx: Ctx, files: string[], cmd: string): { text: string; err: string; names: string[]; parts: string[] } {
  if (files.length === 0) return { text: ctx.stdin ?? '', err: '', names: ['-'], parts: [ctx.stdin ?? ''] };
  let text = '';
  let err = '';
  const names: string[] = [];
  const parts: string[] = [];
  for (const f of files) {
    try {
      const c = f === '-' ? ctx.stdin ?? '' : readFile(ctx.state, absPath(ctx.state, f));
      text += c;
      names.push(f);
      parts.push(c);
    } catch (e) {
      err += `${cmd}: ${f}: ${(e as Error).message}\n`;
    }
  }
  return { text, err, names, parts };
}

function toLines(text: string): string[] {
  if (!text) return [];
  const t = text.endsWith('\n') ? text.slice(0, -1) : text;
  return t.split('\n');
}

const joinLines = (lines: string[]) => (lines.length ? lines.join('\n') + '\n' : '');

/* ------------------------------------------------------------------ */
/* Command dispatch                                                    */
/* ------------------------------------------------------------------ */

function exec(state: TerminalState, argv: string[], ctx: Ctx): CmdResult {
  if (argv.length === 0) return ok();
  const [name, ...args] = argv;

  // VAR=value assignment
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(name) && args.length === 0) {
    const eq = name.indexOf('=');
    state.env[name.slice(0, eq)] = name.slice(eq + 1);
    return ok();
  }

  // explicit path to a program or script
  if (name.includes('/')) return runPath(state, name, args, ctx);

  // PATH lookup: a script found earlier in PATH shadows a built-in command (PATH hijacking)
  const found = which(state, name);
  if (found) {
    const node = tryLookup(state, found);
    if (node && node.type === 'file' && isScript(node)) return runScript(state, found, node, args, ctx);
  }
  const fn = COMMANDS[name];
  if (fn) return fn(args, ctx);
  if (SUGGEST[name]) return fail(`bash: ${name}: not available in this simulator. ${SUGGEST[name]}`, 127);
  return fail(`bash: ${name}: command not found  (type "help" to list what this simulator supports)`, 127);
}

const SUGGEST: Record<string, string> = {
  nano: 'There is no text editor here; use echo with > or >> to write files.',
  vi: 'There is no text editor here; use echo with > or >> to write files.',
  vim: 'There is no text editor here; use echo with > or >> to write files.',
  less: 'Use cat, head or tail instead.',
  more: 'Use cat, head or tail instead.',
  top: 'Use ps aux instead. Try top on a real Linux VM.',
  htop: 'Use ps aux instead.',
  journalctl: 'Read /var/log/auth.log with cat or grep instead. Try journalctl on a real VM.',
  strace: 'Try strace on a real VM (see the Try it yourself section).',
  apt: 'Package management is not simulated.',
  dnf: 'Package management is not simulated.',
  ufw: 'Try ufw on a real VM.',
  ssh: 'Networking is not simulated.',
  curl: 'Networking is not simulated.',
};

function isScript(node: FsNode): boolean {
  return (node.content ?? '').startsWith('#!');
}

function which(state: TerminalState, name: string): string | null {
  for (const d of (state.env.PATH ?? '').split(':')) {
    if (!d) continue;
    const p = `${d.replace(/\/$/, '')}/${name}`;
    const node = tryLookup(state, absPath(state, p));
    if (node && node.type === 'file' && can(state, node, 'x')) return absPath(state, p);
  }
  return null;
}

function runPath(state: TerminalState, p: string, args: string[], ctx: Ctx): CmdResult {
  const abs = absPath(state, p);
  let node: FsNode;
  try {
    node = lookup(state, abs);
  } catch (e) {
    return fail(`bash: ${p}: ${(e as Error).message}`, 127);
  }
  if (node.type === 'dir') return fail(`bash: ${p}: Is a directory`, 126);
  if (!can(state, node, 'x')) return fail(`bash: ${p}: Permission denied`, 126);
  if (isScript(node)) {
    if (!can(state, node, 'r')) return fail(`bash: ${p}: Permission denied`, 126);
    return runScript(state, abs, node, args, ctx);
  }
  const fn = COMMANDS[basename(abs)];
  if (fn) return fn(args, ctx);
  return ok();
}

let scriptDepth = 0;

function runScript(state: TerminalState, path: string, node: FsNode, args: string[], ctx: Ctx): CmdResult {
  if (scriptDepth > 3) return fail('bash: maximum script nesting reached');
  const lines = (node.content ?? '').split('\n').slice(1);
  let out = '';
  let err = '';
  let code = 0;
  const saved = { ...state.env };
  args.forEach((a, i) => (state.env[String(i + 1)] = a));
  state.env['0'] = path;
  state.env['#'] = String(args.length);
  scriptDepth++;
  try {
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      if (/^(if|then|else|elif|fi|for|while|do|done|case|esac|function)\b/.test(line)) {
        err += `(simulator) control flow such as "${line.split(' ')[0]}" is not supported; run this script in a real VM\n`;
        code = 1;
        break;
      }
      if (line === 'set -euo pipefail' || line.startsWith('set ')) continue;
      let list;
      try {
        list = parse(tokenize(line, state.env, homeOf(state), code));
      } catch (e) {
        err += `${path}: ${(e as Error).message}\n`;
        code = 2;
        continue;
      }
      for (const item of list) {
        for (const cmd of item.pipeline) {
          let stdin: string | null = ctx.stdin;
          const argv = expandArgv(state, cmd.argv);
          const r = exec(state, argv, { state, stdin, tty: false });
          let o = r.out;
          for (const red of cmd.redirects) {
            const w = writeRedirect(state, red.target, red.fd === 1 ? o : r.err, red.append);
            if (w) err += w + '\n';
            if (red.fd === 1) o = '';
          }
          out += o;
          if (!cmd.redirects.some((x) => x.fd === 2)) err += r.err;
          code = r.code;
          stdin = o;
        }
      }
    }
  } finally {
    scriptDepth--;
    for (const k of ['0', '#', ...args.map((_, i) => String(i + 1))]) delete state.env[k];
    Object.assign(state.env, { ...saved, ...state.env });
  }
  return { out, err, code };
}

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

const HELP = `Commands available in this simulator:

  Navigation   pwd  cd  ls [-l -a -A -d -h -i]  stat  file
  Reading      cat [-n]  head  tail  wc  grep  find
  Text tools   sort  uniq  cut  awk (simple)  echo
  Files        touch  mkdir [-p]  rm [-r -f]  cp  mv  ln [-s]
  Permissions  chmod  chown  chgrp  umask
  Users        whoami  id  groups  who  last  sudo
  Processes    ps [aux | -ef | -o ...]  pstree [-p]  kill [-SIGNAL]
  Services     systemctl status|start|stop|restart|enable|disable|list-units
  Shell        history  clear  export  env  which  type  uname  hostname  help

Pipes (|), redirection (> >> < 2> 2>&1), ; && || and $VARIABLES work.
Keys: Up/Down = history, Tab = complete, Ctrl+L = clear, Ctrl+C = cancel line.
Everything here is simulated in your browser. Nothing runs on a real system.`;

const COMMANDS: Record<string, Cmd> = {
  help: () => ok(HELP + '\n'),

  clear: () => ({ out: '', err: '', code: 0, clear: true }),

  pwd: (_a, { state }) => ok(state.cwd + '\n'),

  whoami: (_a, { state }) => ok(state.user + '\n'),

  hostname: (_a, { state }) => ok(state.hostname + '\n'),

  uname: (args, { state }) => {
    const { f } = flags(args);
    if (f.has('a')) return ok(`Linux ${state.hostname} 6.8.0-45-generic #45-Ubuntu SMP PREEMPT_DYNAMIC x86_64 x86_64 x86_64 GNU/Linux\n`);
    if (f.has('r')) return ok('6.8.0-45-generic\n');
    return ok('Linux\n');
  },

  id: (args, { state }) => {
    const name = args[0] ?? state.user;
    const u = userDef(state, name);
    if (!u) return fail(`id: '${name}': no such user`);
    const gid = (g: string) => state.groups.find((x) => x.name === g)?.gid ?? 0;
    const groups = u.groups.map((g) => `${gid(g)}(${g})`).join(',');
    return ok(`uid=${u.uid}(${u.name}) gid=${gid(u.groups[0])}(${u.groups[0]}) groups=${groups}\n`);
  },

  groups: (args, { state }) => {
    const name = args[0] ?? state.user;
    const u = userDef(state, name);
    if (!u) return fail(`groups: '${name}': no such user`);
    return ok((args[0] ? `${name} : ` : '') + u.groups.join(' ') + '\n');
  },

  who: (_a, { state }) => ok(state.whoOutput),
  w: (_a, { state }) => ok(state.whoOutput),
  last: (_a, { state }) => ok(state.lastOutput),

  echo: (args) => {
    let newline = true;
    let escapes = false;
    while (args[0] === '-n' || args[0] === '-e' || args[0] === '-ne' || args[0] === '-en') {
      const a = args.shift()!;
      if (a.includes('n')) newline = false;
      if (a.includes('e')) escapes = true;
    }
    let s = args.join(' ');
    if (escapes) s = s.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    return ok(s + (newline ? '\n' : ''));
  },

  export: (args, { state }) => {
    for (const a of args) {
      const eq = a.indexOf('=');
      if (eq > 0) state.env[a.slice(0, eq)] = a.slice(eq + 1);
    }
    if (args.length === 0) {
      return ok(Object.entries(state.env).map(([k, v]) => `declare -x ${k}="${v}"`).join('\n') + '\n');
    }
    return ok();
  },

  unset: (args, { state }) => {
    for (const a of args) delete state.env[a];
    return ok();
  },

  env: (_a, { state }) => ok(Object.entries(state.env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n'),

  printenv: (args, { state }) => {
    if (args.length === 0) return COMMANDS.env(args, { state, stdin: null, tty: true });
    const v = state.env[args[0]];
    return v === undefined ? { out: '', err: '', code: 1 } : ok(v + '\n');
  },

  which: (args, { state }) => {
    let out = '';
    let code = 0;
    for (const a of args) {
      const p = which(state, a);
      if (p) out += p + '\n';
      else code = 1;
    }
    return { out, err: '', code };
  },

  type: (args, { state }) => {
    let out = '';
    for (const a of args) {
      if (['cd', 'echo', 'export', 'history', 'pwd', 'umask', 'kill', 'type', 'exit', 'help', 'unset'].includes(a)) {
        out += `${a} is a shell builtin\n`;
        continue;
      }
      const p = which(state, a);
      out += p ? `${a} is ${p}\n` : `bash: type: ${a}: not found\n`;
    }
    return ok(out);
  },

  history: (args, { state }) => {
    if (args[0] === '-c') {
      state.history = [];
      return ok();
    }
    return ok(state.history.map((h, i) => `${String(i + 1).padStart(5)}  ${h}`).join('\n') + '\n');
  },

  exit: (_a, { state }) => {
    const stack = userStacks.get(state);
    if (stack && stack.length) {
      state.user = stack.pop()!;
      state.env.USER = state.user;
      state.env.HOME = homeOf(state);
      return ok('logout\n');
    }
    return { out: '', err: '', code: 0, info: '(simulator) This is your only shell, so it stays open.' };
  },

  cd: (args, { state }) => {
    let target = args[0] ?? homeOf(state);
    if (target === '-') target = state.prevCwd;
    const abs = absPath(state, target);
    try {
      const node = lookup(state, abs);
      if (node.type !== 'dir') return fail(`bash: cd: ${target}: Not a directory`);
      if (!can(state, node, 'x')) return fail(`bash: cd: ${target}: Permission denied`);
    } catch (e) {
      return fail(`bash: cd: ${target}: ${(e as Error).message}`);
    }
    state.prevCwd = state.cwd;
    state.cwd = abs;
    state.env.PWD = abs;
    return ok(args[0] === '-' ? abs + '\n' : '');
  },

  ls: (args, ctx) => cmdLs(args, ctx),

  cat: (args, ctx) => {
    const { f, rest } = flags(args);
    const { text, err } = inputFrom(ctx, rest, 'cat');
    let out = text;
    if (f.has('n')) out = joinLines(toLines(text).map((l, i) => `${String(i + 1).padStart(6)}\t${l}`));
    return { out, err, code: err ? 1 : 0 };
  },

  head: (args, ctx) => headTail(args, ctx, 'head'),
  tail: (args, ctx) => headTail(args, ctx, 'tail'),

  wc: (args, ctx) => {
    const { f, rest } = flags(args);
    const { parts, names, err } = inputFrom(ctx, rest, 'wc');
    const pick = f.size ? f : new Set(['l', 'w', 'c']);
    const rows = parts.map((t, i) => {
      const cols: number[] = [];
      if (pick.has('l')) cols.push((t.match(/\n/g) ?? []).length);
      if (pick.has('w')) cols.push(t.split(/\s+/).filter(Boolean).length);
      if (pick.has('c')) cols.push(new TextEncoder().encode(t).length);
      return { cols, name: names[i] };
    });
    const single = rows.length === 1 && rows[0].cols.length === 1;
    const out = rows
      .map((r) => {
        const nums = single ? String(r.cols[0]) : r.cols.map((n) => String(n).padStart(7)).join(' ');
        return r.name === '-' ? nums : `${nums} ${r.name}`;
      })
      .join('\n');
    return { out: out ? out + '\n' : '', err, code: err ? 1 : 0 };
  },

  grep: (args, ctx) => cmdGrep(args, ctx),

  sort: (args, ctx) => {
    const { f, v, rest } = flags(args, ['k', 't']);
    const { text, err } = inputFrom(ctx, rest, 'sort');
    let lines = toLines(text);
    const key = (l: string) => {
      if (!v.k) return l;
      const n = parseInt(v.k, 10);
      const fields = v.t ? l.split(v.t) : l.trim().split(/\s+/);
      return fields.slice(n - 1).join(v.t ?? ' ');
    };
    const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    lines.sort((a, b) => {
      let c: number;
      if (f.has('n')) {
        const na = parseFloat(key(a)) || 0;
        const nb = parseFloat(key(b)) || 0;
        c = na - nb || cmpStr(a, b);
      } else c = cmpStr(key(a), key(b)) || cmpStr(a, b);
      return f.has('r') ? -c : c;
    });
    if (f.has('u')) lines = lines.filter((l, i) => i === 0 || l !== lines[i - 1]);
    return { out: joinLines(lines), err, code: err ? 2 : 0 };
  },

  uniq: (args, ctx) => {
    const { f, rest } = flags(args);
    const { text, err } = inputFrom(ctx, rest.slice(0, 1), 'uniq');
    const groups: { line: string; n: number }[] = [];
    for (const l of toLines(text)) {
      const prev = groups[groups.length - 1];
      const same = prev && (f.has('i') ? prev.line.toLowerCase() === l.toLowerCase() : prev.line === l);
      if (same) prev.n++;
      else groups.push({ line: l, n: 1 });
    }
    const out = groups
      .filter((g) => (f.has('d') ? g.n > 1 : f.has('u') ? g.n === 1 : true))
      .map((g) => (f.has('c') ? `${String(g.n).padStart(7)} ${g.line}` : g.line));
    return { out: joinLines(out), err, code: err ? 1 : 0 };
  },

  cut: (args, ctx) => {
    const { v, rest } = flags(args, ['d', 'f', 'c']);
    const { text, err } = inputFrom(ctx, rest, 'cut');
    const spec = v.f ?? v.c;
    if (!spec) return fail('cut: you must specify a list of bytes, characters, or fields');
    const ranges = spec.split(',').map((r) => {
      const [a, b] = r.split('-');
      const lo = a ? parseInt(a, 10) : 1;
      const hi = r.includes('-') ? (b ? parseInt(b, 10) : Infinity) : lo;
      return [lo, hi] as const;
    });
    const inRange = (i: number) => ranges.some(([lo, hi]) => i >= lo && i <= hi);
    const delim = v.d ?? '\t';
    const out = toLines(text).map((l) => {
      if (v.c) return [...l].filter((_, i) => inRange(i + 1)).join('');
      if (!l.includes(delim)) return l;
      return l.split(delim).filter((_, i) => inRange(i + 1)).join(delim);
    });
    return { out: joinLines(out), err, code: err ? 1 : 0 };
  },

  awk: (args, ctx) => cmdAwk(args, ctx),

  find: (args, ctx) => cmdFind(args, ctx),

  stat: (args, { state }) => {
    let out = '';
    let err = '';
    for (const p of args) {
      try {
        const node = lookup(state, absPath(state, p), false);
        const kind = node.type === 'dir' ? 'directory' : node.type === 'link' ? 'symbolic link' : nodeSize(node) === 0 ? 'regular empty file' : 'regular file';
        const uid = userDef(state, node.owner)?.uid ?? 0;
        const gid = state.groups.find((g) => g.name === node.group)?.gid ?? 0;
        out +=
          `  File: ${p}${node.type === 'link' ? ` -> ${node.target}` : ''}\n` +
          `  Size: ${String(nodeSize(node)).padEnd(10)}Blocks: ${String(Math.ceil(nodeSize(node) / 4096) * 8).padEnd(10)} ${kind}\n` +
          `Inode: ${String(node.ino ?? 0).padEnd(10)}Links: ${linkCount(state, node)}\n` +
          `Access: (${octal(node.mode)}/${modeString(node)})  Uid: (${String(uid).padStart(5)}/${node.owner.padStart(8)})   Gid: (${String(gid).padStart(5)}/${node.group.padStart(8)})\n` +
          `Modify: ${node.mtime ?? 'Oct 26 08:00'}\n`;
      } catch (e) {
        err += `stat: cannot statx '${p}': ${(e as Error).message}\n`;
      }
    }
    return { out, err, code: err ? 1 : 0 };
  },

  file: (args, { state }) => {
    let out = '';
    for (const p of args) {
      const node = tryLookup(state, absPath(state, p), false);
      if (!node) out += `${p}: cannot open \`${p}' (No such file or directory)\n`;
      else if (node.type === 'dir') out += `${p}: directory\n`;
      else if (node.type === 'char') out += `${p}: character special (${node.dev?.replace(', ', '/')})\n`;
      else if (node.type === 'block') out += `${p}: block special (${node.dev?.replace(', ', '/')})\n`;
      else if (node.type === 'link') out += `${p}: symbolic link to ${node.target}\n`;
      else if ((node.content ?? '').startsWith('\u0000ELF')) out += `${p}: ELF 64-bit LSB pie executable, x86-64, dynamically linked\n`;
      else if ((node.content ?? '').startsWith('#!/bin/bash')) out += `${p}: Bourne-Again shell script, ASCII text executable\n`;
      else if ((node.content ?? '').startsWith('#!')) out += `${p}: a ${node.content!.split('\n')[0].slice(2)} script, ASCII text executable\n`;
      else if (!node.content) out += `${p}: empty\n`;
      else out += `${p}: ASCII text\n`;
    }
    return ok(out);
  },

  touch: (args, { state }) => {
    let err = '';
    for (const p of args) {
      const abs = absPath(state, p);
      const node = tryLookup(state, abs);
      if (node) {
        if (!can(state, node, 'w') && node.owner !== state.user && !isRoot(state)) err += `touch: cannot touch '${p}': Permission denied\n`;
        else node.mtime = nowStamp();
        continue;
      }
      try {
        writeFile(state, abs, '', false);
      } catch (e) {
        err += `touch: cannot touch '${p}': ${(e as Error).message}\n`;
      }
    }
    return { out: '', err, code: err ? 1 : 0 };
  },

  mkdir: (args, { state }) => {
    const { f, rest } = flags(args);
    let err = '';
    for (const p of rest) {
      const abs = absPath(state, p);
      const parts = splitPath(abs);
      const targets = f.has('p') ? parts.map((_, i) => '/' + parts.slice(0, i + 1).join('/')) : [abs];
      for (const t of targets) {
        if (tryLookup(state, t)) {
          if (!f.has('p')) err += `mkdir: cannot create directory '${p}': File exists\n`;
          continue;
        }
        try {
          const { parent, name } = parentForWrite(state, t);
          parent.children![name] = {
            type: 'dir',
            mode: 0o777 & ~state.umask,
            owner: state.user,
            group: primaryGroup(state),
            children: {},
            mtime: nowStamp(),
            ino: 150000 + Math.floor(Math.random() * 9000),
          };
        } catch (e) {
          err += `mkdir: cannot create directory '${p}': ${(e as Error).message}\n`;
          break;
        }
      }
    }
    return { out: '', err, code: err ? 1 : 0 };
  },

  rm: (args, { state }) => {
    const { f, rest } = flags(args);
    let err = '';
    for (const p of rest) {
      const abs = absPath(state, p);
      let node: FsNode;
      try {
        node = lookup(state, abs, false);
      } catch (e) {
        if (!f.has('f')) err += `rm: cannot remove '${p}': ${(e as Error).message}\n`;
        continue;
      }
      if (node.type === 'dir' && !f.has('r') && !f.has('R')) {
        err += `rm: cannot remove '${p}': Is a directory\n`;
        continue;
      }
      if (abs === '/') {
        err += `rm: it is dangerous to operate recursively on '/'\n`;
        continue;
      }
      try {
        const { parent, name } = parentForWrite(state, abs);
        // sticky bit: only the file owner, the directory owner or root may delete
        if (parent.mode & 0o1000 && !isRoot(state) && node.owner !== state.user && parent.owner !== state.user) {
          err += `rm: cannot remove '${p}': Operation not permitted\n`;
          continue;
        }
        delete parent.children![name];
      } catch (e) {
        err += `rm: cannot remove '${p}': ${(e as Error).message}\n`;
      }
    }
    return { out: '', err, code: err ? 1 : 0 };
  },

  cp: (args, { state }) => {
    const { rest } = flags(args);
    if (rest.length < 2) return fail('cp: missing destination file operand');
    const dst = rest.pop()!;
    let err = '';
    for (const src of rest) {
      try {
        const data = readFile(state, absPath(state, src));
        let target = absPath(state, dst);
        const tnode = tryLookup(state, target);
        if (tnode?.type === 'dir') target = `${target === '/' ? '' : target}/${basename(src)}`;
        writeFile(state, target, data, false);
      } catch (e) {
        err += `cp: cannot copy '${src}': ${(e as Error).message}\n`;
      }
    }
    return { out: '', err, code: err ? 1 : 0 };
  },

  mv: (args, { state }) => {
    const { rest } = flags(args);
    if (rest.length !== 2) return fail('cp: usage: mv SOURCE DEST');
    const [src, dst] = rest;
    try {
      const sAbs = absPath(state, src);
      const node = lookup(state, sAbs, false);
      const from = parentForWrite(state, sAbs);
      let target = absPath(state, dst);
      if (tryLookup(state, target)?.type === 'dir') target = `${target === '/' ? '' : target}/${basename(src)}`;
      const to = parentForWrite(state, target);
      delete from.parent.children![from.name];
      to.parent.children![to.name] = node;
      return ok();
    } catch (e) {
      return fail(`mv: cannot move '${src}': ${(e as Error).message}`);
    }
  },

  ln: (args, { state }) => {
    const { f, rest } = flags(args);
    if (rest.length !== 2) return fail('ln: usage: ln [-s] TARGET LINK_NAME');
    const [target, name] = rest;
    try {
      const abs = absPath(state, name);
      if (tryLookup(state, abs, false)) return fail(`ln: failed to create link '${name}': File exists`);
      if (f.has('s')) {
        const { parent, name: n } = parentForWrite(state, abs);
        parent.children![n] = { type: 'link', mode: 0o777, owner: state.user, group: primaryGroup(state), target, mtime: nowStamp(), ino: 160000 + Math.floor(Math.random() * 9000) };
      } else {
        const node = lookup(state, absPath(state, target));
        if (node.type === 'dir') return fail(`ln: ${target}: hard link not allowed for directory`);
        const { parent, name: n } = parentForWrite(state, abs);
        parent.children![n] = node; // same object = same inode
      }
      return ok();
    } catch (e) {
      return fail(`ln: failed to create link '${name}': ${(e as Error).message}`);
    }
  },

  chmod: (args, ctx) => cmdChmod(args, ctx),
  chown: (args, ctx) => cmdChown(args, ctx, false),
  chgrp: (args, ctx) => cmdChown(args, ctx, true),

  umask: (args, { state }) => {
    if (!args[0]) return ok(octal(state.umask) + '\n');
    if (args[0] === '-S') {
      const p = 0o777 & ~state.umask;
      const s = (b: number) => (b & 4 ? 'r' : '') + (b & 2 ? 'w' : '') + (b & 1 ? 'x' : '');
      return ok(`u=${s(p >> 6)},g=${s((p >> 3) & 7)},o=${s(p & 7)}\n`);
    }
    if (!/^[0-7]{1,4}$/.test(args[0])) return fail(`bash: umask: ${args[0]}: octal number out of range`);
    state.umask = parseInt(args[0], 8) & 0o777;
    return ok();
  },

  sudo: (args, ctx) => cmdSudo(args, ctx),
  su: (args, ctx) => {
    if (isRoot(ctx.state)) return switchUser(ctx.state, args.filter((a) => a !== '-')[0] ?? 'root');
    return fail('su: Authentication failure  (simulator: use "sudo -i" instead)');
  },

  ps: (args, ctx) => cmdPs(args, ctx),
  pstree: (args, ctx) => cmdPstree(args, ctx),
  kill: (args, ctx) => cmdKill(args, ctx),
  systemctl: (args, ctx) => cmdSystemctl(args, ctx),
  bash: (args, ctx) => runInterpreter(args, ctx),
  sh: (args, ctx) => runInterpreter(args, ctx),
};

function runInterpreter(args: string[], ctx: Ctx): CmdResult {
  const p = args[0];
  if (!p) return { out: '', err: '', code: 0, info: '(simulator) You are already in bash. Pass a script: bash script.sh' };
  const abs = absPath(ctx.state, p);
  try {
    const node = lookup(ctx.state, abs);
    // Interpreters only need READ permission on the script, not execute.
    if (!can(ctx.state, node, 'r')) return fail(`bash: ${p}: Permission denied`, 126);
    const withShebang = isScript(node) ? node : { ...node, content: '#!/bin/bash\n' + (node.content ?? '') };
    return runScript(ctx.state, abs, withShebang, args.slice(1), ctx);
  } catch (e) {
    return fail(`bash: ${p}: ${(e as Error).message}`, 127);
  }
}

/* ---------------------------- ls ---------------------------------- */

function humanSize(n: number): string {
  if (n < 1024) return String(n);
  const units = ['K', 'M', 'G'];
  let v = n;
  let u = -1;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return (v < 10 ? v.toFixed(1) : Math.round(v).toString()) + units[u];
}

function cmdLs(args: string[], { state, tty }: Ctx): CmdResult {
  const { f, rest } = flags(args);
  const long = f.has('l');
  const all = f.has('a');
  const almost = f.has('A');
  const targets = rest.length ? rest : ['.'];
  let err = '';
  const fileEntries: { name: string; node: FsNode }[] = [];
  const dirs: { label: string; node: FsNode; abs: string }[] = [];

  for (const t of targets) {
    const abs = absPath(state, t);
    let node: FsNode;
    try {
      node = lookup(state, abs, false);
      if (node.type === 'link' && !(long || f.has('d')) ) node = lookup(state, abs, true);
      else if (node.type === 'link' && t.endsWith('/')) node = lookup(state, abs, true);
    } catch (e) {
      err += `ls: cannot access '${t}': ${(e as Error).message}\n`;
      continue;
    }
    if (node.type === 'dir' && !f.has('d')) dirs.push({ label: t, node, abs });
    else fileEntries.push({ name: t, node });
  }

  const fmt = (entries: { name: string; node: FsNode }[], withTotal: boolean): string => {
    if (!entries.length) return withTotal && long ? 'total 0\n' : '';
    if (!long) {
      const names = entries.map((e) => (f.has('i') ? `${e.node.ino} ` : '') + e.name);
      if (!tty || names.join('  ').length > 78) return names.join('\n') + '\n';
      return names.join('  ') + '\n';
    }
    const rows = entries.map((e) => ({
      ino: String(e.node.ino ?? ''),
      mode: modeString(e.node),
      links: String(linkCount(state, e.node)),
      owner: e.node.owner,
      group: e.node.group,
      size: e.node.dev ?? (f.has('h') ? humanSize(nodeSize(e.node)) : String(nodeSize(e.node))),
      time: e.node.mtime ?? 'Oct 26 08:00',
      name: e.name + (e.node.type === 'link' ? ` -> ${e.node.target}` : ''),
    }));
    const w = (k: keyof (typeof rows)[0]) => Math.max(...rows.map((r) => r[k].length));
    const total = entries.reduce((s, e) => s + (e.node.type === 'file' ? Math.ceil(nodeSize(e.node) / 4096) * 4 : e.node.type === 'dir' ? 4 : 0), 0);
    const lines = rows.map(
      (r) =>
        (f.has('i') ? r.ino.padStart(w('ino')) + ' ' : '') +
        `${r.mode} ${r.links.padStart(w('links'))} ${r.owner.padEnd(w('owner'))} ${r.group.padEnd(w('group'))} ${r.size.padStart(w('size'))} ${r.time} ${r.name}`,
    );
    return (withTotal ? `total ${total}\n` : '') + lines.join('\n') + '\n';
  };

  let out = fmt(fileEntries, false);
  dirs.forEach((d, i) => {
    if (!can(state, d.node, 'r')) {
      err += `ls: cannot open directory '${d.label}': Permission denied\n`;
      return;
    }
    let entries = Object.keys(d.node.children!)
      .filter((n) => all || almost || !n.startsWith('.'))
      .sort((a, b) => a.replace(/^\./, '').toLowerCase().localeCompare(b.replace(/^\./, '').toLowerCase()))
      .map((name) => ({ name, node: d.node.children![name] }));
    if (all) {
      const parent = d.abs === '/' ? d.node : (tryLookup(state, parentAndName(d.abs)[0]) ?? d.node);
      entries = [{ name: '.', node: d.node }, { name: '..', node: parent }, ...entries];
    }
    if (long && !can(state, d.node, 'x')) {
      err += `ls: cannot access '${d.label}': Permission denied\n`;
      return;
    }
    const header = targets.length > 1 ? `${out || i > 0 ? '\n' : ''}${d.label}:\n` : '';
    out += header + fmt(entries, true);
  });
  return { out, err, code: err ? 2 : 0 };
}

/* ---------------------------- head/tail ---------------------------- */

function headTail(args: string[], ctx: Ctx, which: 'head' | 'tail'): CmdResult {
  let n = 10;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-n') n = parseInt(args[++i] ?? '10', 10);
    else if (/^-n\d+$/.test(a)) n = parseInt(a.slice(2), 10);
    else if (/^-\d+$/.test(a)) n = parseInt(a.slice(1), 10);
    else if (a === '-f') return fail(`${which}: -f (follow) is not supported in this simulator`);
    else rest.push(a);
  }
  const { text, err } = inputFrom(ctx, rest, which);
  const lines = toLines(text);
  const pick = which === 'head' ? lines.slice(0, n) : lines.slice(Math.max(0, lines.length - n));
  return { out: joinLines(pick), err, code: err ? 1 : 0 };
}

/* ---------------------------- grep --------------------------------- */

/** Converts a POSIX basic regular expression to a JS RegExp source. */
function breToJs(p: string): string {
  let out = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '\\' && i + 1 < p.length) {
      const n = p[i + 1];
      out += '|+?(){}'.includes(n) ? n : '\\' + n;
      i++;
    } else if ('|+?(){}'.includes(c)) out += '\\' + c;
    else out += c;
  }
  return out;
}

function cmdGrep(args: string[], ctx: Ctx): CmdResult {
  const { f, v, rest } = flags(args, ['e']);
  const pattern = v.e ?? rest.shift();
  if (pattern === undefined) return fail('Usage: grep [OPTION]... PATTERNS [FILE]...', 2);
  let src = f.has('F') ? pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : f.has('E') ? pattern : breToJs(pattern);
  if (f.has('w')) src = `(?<![A-Za-z0-9_])(?:${src})(?![A-Za-z0-9_])`;
  let re: RegExp;
  try {
    re = new RegExp(src, f.has('i') ? 'i' : '');
  } catch {
    return fail('grep: Invalid regular expression', 2);
  }

  // collect inputs
  const inputs: { name: string; text: string }[] = [];
  let err = '';
  const recursive = f.has('r') || f.has('R');
  if (rest.length === 0 && !recursive) inputs.push({ name: '(standard input)', text: ctx.stdin ?? '' });
  for (const p of rest.length ? rest : ['.']) {
    const abs = absPath(ctx.state, p);
    const node = tryLookup(ctx.state, abs);
    if (node?.type === 'dir') {
      if (!recursive) {
        err += `grep: ${p}: Is a directory\n`;
        continue;
      }
      walkTree(
        ctx.state,
        abs,
        p,
        (path, n) => {
          if (n.type === 'file') {
            if (can(ctx.state, n, 'r')) inputs.push({ name: path, text: n.content ?? '' });
            else err += `grep: ${path}: Permission denied\n`;
          }
        },
        (path, msg) => (err += `grep: ${path}: ${msg}\n`),
      );
      continue;
    }
    try {
      inputs.push({ name: p, text: readFile(ctx.state, abs) });
    } catch (e) {
      err += `grep: ${p}: ${(e as Error).message}\n`;
    }
  }

  const multi = (inputs.length > 1 || recursive) && !f.has('h');
  let out = '';
  let matchedAny = false;
  for (const inp of inputs) {
    if (inp.text.startsWith('\u0000ELF')) {
      if (re.test(inp.text)) out += `grep: ${inp.name}: binary file matches\n`;
      continue;
    }
    const lines = toLines(inp.text);
    let count = 0;
    const prefix = multi ? `${inp.name}:` : '';
    lines.forEach((l, i) => {
      const m = re.test(l);
      if (m === !f.has('v')) {
        count++;
        if (f.has('c') || f.has('l')) return;
        if (f.has('o') && !f.has('v')) {
          const g = new RegExp(re.source, re.flags + 'g');
          for (const mm of l.match(g) ?? []) out += `${prefix}${f.has('n') ? `${i + 1}:` : ''}${mm}\n`;
        } else out += `${prefix}${f.has('n') ? `${i + 1}:` : ''}${l}\n`;
      }
    });
    if (count) matchedAny = true;
    if (f.has('c')) out += `${prefix}${count}\n`;
    if (f.has('l') && count) out += `${inp.name}\n`;
  }
  return { out, err, code: err && !matchedAny ? 2 : matchedAny ? 0 : 1 };
}

/* ---------------------------- awk ---------------------------------- */

function cmdAwk(args: string[], ctx: Ctx): CmdResult {
  let fs: string | null = null;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-F') fs = args[++i] ?? ' ';
    else if (args[i].startsWith('-F')) fs = args[i].slice(2);
    else rest.push(args[i]);
  }
  const prog = rest.shift();
  if (!prog) return fail('usage: awk [-F sep] \'program\' [file ...]', 2);
  const unsupported = fail(
    "awk: this simulator understands simple programs only, e.g. '{print $1}', '/regex/ {print $1, $3}', '$3 >= 1000 {print $1}'",
    2,
  );
  const m = /^\s*(.*?)\s*(?:\{\s*(.*?)\s*\})?\s*$/.exec(prog);
  if (!m) return unsupported;
  const cond = m[1];
  const action = m[2] ?? 'print';
  if (!/^print\b/.test(action) && action !== '') return unsupported;

  const { text, err } = inputFrom(ctx, rest, 'awk');
  const out: string[] = [];
  let nr = 0;
  const split = (l: string) => (fs === null || fs === ' ' ? l.trim().split(/\s+/).filter(Boolean) : l.split(fs === '\\t' ? '\t' : fs));

  const evalTerm = (t: string, fields: string[], line: string): string => {
    if (t === '$0') return line;
    if (t === 'NR') return String(nr);
    if (t === 'NF') return String(fields.length);
    if (t === '$NF') return fields[fields.length - 1] ?? '';
    const nm = /^\$\(NF-(\d+)\)$/.exec(t);
    if (nm) return fields[fields.length - 1 - parseInt(nm[1], 10)] ?? '';
    const fm = /^\$(\d+)$/.exec(t);
    if (fm) return fields[parseInt(fm[1], 10) - 1] ?? '';
    const sm = /^"(.*)"$/.exec(t);
    if (sm) return sm[1].replace(/\\t/g, '\t');
    if (/^-?\d+(\.\d+)?$/.test(t)) return t;
    throw new Error('unsupported');
  };
  const evalExpr = (e: string, fields: string[], line: string): string => {
    const terms = e.match(/"[^"]*"|\S+/g) ?? [];
    return terms.map((t) => evalTerm(t, fields, line)).join('');
  };

  try {
    for (const line of toLines(text)) {
      nr++;
      const fields = split(line);
      if (cond) {
        const rm = /^\/(.*)\/$/.exec(cond);
        const cm = /^(\$\w+|NR|NF)\s*(==|!=|>=|<=|>|<|~|!~)\s*(.+)$/.exec(cond);
        if (rm) {
          if (!new RegExp(rm[1]).test(line)) continue;
        } else if (cm) {
          const left = evalTerm(cm[1], fields, line);
          const rhs = cm[3].trim();
          let pass: boolean;
          if (cm[2] === '~' || cm[2] === '!~') {
            const r = /^\/(.*)\/$/.exec(rhs);
            if (!r) throw new Error('unsupported');
            pass = new RegExp(r[1]).test(left) === (cm[2] === '~');
          } else {
            const right = evalTerm(rhs, fields, line);
            const numeric = /^-?\d+(\.\d+)?$/.test(left) && /^-?\d+(\.\d+)?$/.test(right);
            const a: number | string = numeric ? parseFloat(left) : left;
            const b: number | string = numeric ? parseFloat(right) : right;
            pass = { '==': a === b, '!=': a !== b, '>=': a >= b, '<=': a <= b, '>': a > b, '<': a < b }[cm[2]] as boolean;
          }
          if (!pass) continue;
        } else throw new Error('unsupported');
      }
      const body = action.replace(/^print\s*/, '');
      if (!body) {
        out.push(line);
        continue;
      }
      const parts = body.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((p) => evalExpr(p.trim(), fields, line));
      out.push(parts.join(' '));
    }
  } catch {
    return unsupported;
  }
  return { out: joinLines(out), err, code: err ? 2 : 0 };
}

/* ---------------------------- find --------------------------------- */

type Pred = (path: string, node: FsNode) => boolean;

/** Applies a symbolic mode like "u+x,go-w" to a mode. `umask` applies when no who is given. */
function applySymbolic(mode: number, spec: string, isDir: boolean, umask: number): number | null {
  let m = mode;
  for (const clause of spec.split(',')) {
    const cm = /^([ugoa]*)((?:[+\-=][rwxXst]*)+)$/.exec(clause);
    if (!cm) return null;
    const who = cm[1] || 'a';
    const masked = cm[1] === '';
    const ops = cm[2].match(/[+\-=][rwxXst]*/g)!;
    for (const op of ops) {
      const o = op[0];
      const perms = op.slice(1);
      let bits = 0;
      const shifts: number[] = [];
      if (who.includes('u') || who.includes('a')) shifts.push(6);
      if (who.includes('g') || who.includes('a')) shifts.push(3);
      if (who.includes('o') || who.includes('a')) shifts.push(0);
      for (const p of perms) {
        let b = 0;
        if (p === 'r') b = 4;
        if (p === 'w') b = 2;
        if (p === 'x') b = 1;
        if (p === 'X' && (isDir || m & 0o111)) b = 1;
        for (const s of shifts) bits |= b << s;
        if (p === 's') {
          if (shifts.includes(6)) bits |= 0o4000;
          if (shifts.includes(3)) bits |= 0o2000;
        }
        if (p === 't' && shifts.includes(0)) bits |= 0o1000;
      }
      if (masked) bits &= ~umask | 0o7000;
      if (o === '+') m |= bits;
      else if (o === '-') m &= ~bits;
      else {
        let clear = 0;
        for (const s of shifts) clear |= 7 << s;
        if (shifts.includes(6)) clear |= 0o4000;
        if (shifts.includes(3)) clear |= 0o2000;
        if (shifts.includes(0)) clear |= 0o1000;
        m = (m & ~clear) | bits;
      }
    }
  }
  return m;
}

function cmdFind(args: string[], { state }: Ctx): CmdResult {
  const starts: string[] = [];
  let i = 0;
  while (i < args.length && !args[i].startsWith('-') && args[i] !== '!' && args[i] !== '(') starts.push(args[i++]);
  if (!starts.length) starts.push('.');
  let maxDepth = Infinity;
  let minDepth = 0;
  const groups: Pred[][] = [[]];
  let negate = false;
  const add = (p: Pred) => {
    const n = negate;
    groups[groups.length - 1].push(n ? (a, b) => !p(a, b) : p);
    negate = false;
  };
  for (; i < args.length; i++) {
    const a = args[i];
    const val = () => {
      const v = args[++i];
      if (v === undefined) throw new Error(`find: missing argument to \`${a}'`);
      return v;
    };
    try {
      switch (a) {
        case '!':
        case '-not':
          negate = true;
          break;
        case '-o':
        case '-or':
          groups.push([]);
          break;
        case '-a':
        case '-and':
        case '-print':
          break;
        case '-name': {
          const re = globToRegExp(val());
          add((p) => re.test(basename(p)));
          break;
        }
        case '-iname': {
          const re = globToRegExp(val(), 'i');
          add((p) => re.test(basename(p)));
          break;
        }
        case '-type': {
          const t = val();
          const map: Record<string, FsNode['type']> = { f: 'file', d: 'dir', l: 'link' };
          add((_p, n) => n.type === map[t]);
          break;
        }
        case '-user': {
          const u = val();
          add((_p, n) => n.owner === u);
          break;
        }
        case '-group': {
          const g = val();
          add((_p, n) => n.group === g);
          break;
        }
        case '-perm': {
          const spec = val();
          const kind = spec[0] === '-' ? 'all' : spec[0] === '/' ? 'any' : 'exact';
          const body = kind === 'exact' ? spec : spec.slice(1);
          const bits = /^[0-7]+$/.test(body) ? parseInt(body, 8) : applySymbolic(0, body, false, 0);
          if (bits === null) return fail(`find: invalid mode '${spec}'`);
          add((_p, n) => {
            const m = n.mode & 0o7777;
            if (kind === 'all') return (m & bits) === bits;
            if (kind === 'any') return bits === 0 || (m & bits) !== 0;
            return m === bits;
          });
          break;
        }
        case '-maxdepth':
          maxDepth = parseInt(val(), 10);
          break;
        case '-mindepth':
          minDepth = parseInt(val(), 10);
          break;
        case '-xdev':
          break;
        case '-exec':
        case '-execdir':
        case '-delete':
          return fail(`find: ${a} is not supported in this simulator (it would act on every match; review the list first)`);
        default:
          return fail(`find: unknown predicate \`${a}'  (supported: -name -iname -type -perm -user -group -maxdepth -mindepth ! -o)`);
      }
    } catch (e) {
      return fail((e as Error).message);
    }
  }
  const nonEmpty = groups.filter((g) => g.length);
  const matches: Pred = (p, n) => nonEmpty.length === 0 || nonEmpty.some((g) => g.every((pr) => pr(p, n)));
  let out = '';
  let err = '';
  for (const s of starts) {
    walkTree(
      state,
      absPath(state, s),
      s,
      (p, n, depth) => {
        if (depth >= minDepth && matches(p, n)) out += p + '\n';
      },
      (p, msg) => (err += `find: '${p}': ${msg}\n`),
      maxDepth,
    );
  }
  return { out, err, code: err ? 1 : 0 };
}

/* ---------------------------- chmod / chown ------------------------ */

function cmdChmod(args: string[], { state }: Ctx): CmdResult {
  const recursive = args[0] === '-R';
  const rest = recursive ? args.slice(1) : args;
  if (rest.length < 2) return fail("chmod: missing operand\nTry 'chmod MODE FILE'");
  const [spec, ...paths] = rest;
  let err = '';
  const apply = (p: string, node: FsNode) => {
    if (!isRoot(state) && node.owner !== state.user) {
      err += `chmod: changing permissions of '${p}': Operation not permitted\n`;
      return;
    }
    if (/^[0-7]{1,4}$/.test(spec)) {
      let m = parseInt(spec, 8);
      // GNU chmod keeps a directory's SUID/SGID bits when a short numeric mode is given
      if (node.type === 'dir' && spec.length <= 3) m |= node.mode & 0o6000;
      node.mode = m;
    } else {
      const m = applySymbolic(node.mode, spec, node.type === 'dir', state.umask);
      if (m === null) {
        err += `chmod: invalid mode: '${spec}'\n`;
        return;
      }
      node.mode = m;
    }
  };
  for (const p of paths) {
    try {
      const abs = absPath(state, p);
      const node = lookup(state, abs);
      if (recursive) walkTree(state, abs, p, (pp, n) => n.type !== 'link' && apply(pp, n), (pp, msg) => (err += `chmod: '${pp}': ${msg}\n`));
      else apply(p, node);
    } catch (e) {
      err += `chmod: cannot access '${p}': ${(e as Error).message}\n`;
    }
    if (err.includes('invalid mode')) break;
  }
  return { out: '', err, code: err ? 1 : 0 };
}

function cmdChown(args: string[], { state }: Ctx, groupOnly: boolean): CmdResult {
  const cmd = groupOnly ? 'chgrp' : 'chown';
  const recursive = args[0] === '-R';
  const rest = recursive ? args.slice(1) : args;
  if (rest.length < 2) return fail(`${cmd}: missing operand`);
  const [spec, ...paths] = rest;
  let owner: string | undefined;
  let group: string | undefined;
  if (groupOnly) group = spec;
  else {
    const [o, g] = spec.split(/[:.]/);
    owner = o || undefined;
    group = g || undefined;
  }
  if (owner && !userDef(state, owner)) return fail(`${cmd}: invalid user: '${spec}'`);
  if (group && !state.groups.some((g) => g.name === group)) return fail(`${cmd}: invalid group: '${spec}'`);
  let err = '';
  const apply = (p: string, node: FsNode) => {
    // Only root may give a file away. The owner may change the group to one they belong to.
    const ownerChange = owner && owner !== node.owner;
    const groupAllowed = !group || isRoot(state) || (node.owner === state.user && inGroup(state, group));
    if ((!isRoot(state) && ownerChange) || !groupAllowed) {
      err += `${cmd}: changing ${ownerChange ? 'ownership' : 'group'} of '${p}': Operation not permitted\n`;
      return;
    }
    if (owner) node.owner = owner;
    if (group) node.group = group;
    // Changing ownership clears SUID/SGID on regular files (a kernel safety rule, root included).
    if (node.type === 'file') node.mode &= ~0o6000;
  };
  for (const p of paths) {
    try {
      const abs = absPath(state, p);
      const node = lookup(state, abs);
      if (recursive) walkTree(state, abs, p, (pp, n) => apply(pp, n), (pp, msg) => (err += `${cmd}: '${pp}': ${msg}\n`));
      else apply(p, node);
    } catch (e) {
      err += `${cmd}: cannot access '${p}': ${(e as Error).message}\n`;
    }
  }
  return { out: '', err, code: err ? 1 : 0 };
}

/* ---------------------------- sudo --------------------------------- */

function canSudo(state: TerminalState): boolean {
  return isRoot(state) || inGroup(state, 'sudo') || inGroup(state, 'wheel');
}

function switchUser(state: TerminalState, to: string): CmdResult {
  if (!userDef(state, to)) return fail(`su: user ${to} does not exist`);
  const stack = userStacks.get(state) ?? [];
  stack.push(state.user);
  userStacks.set(state, stack);
  state.user = to;
  state.env.USER = to;
  state.env.HOME = homeOf(state);
  return { out: '', err: '', code: 0, info: `(simulator) You are now ${to}. Type "exit" to go back.` };
}

function cmdSudo(args: string[], ctx: Ctx): CmdResult {
  const { state } = ctx;
  if (!args.length) return fail('usage: sudo command');
  if (!canSudo(state)) {
    return fail(`[sudo] password for ${state.user}: \n${state.user} is not in the sudoers file.\nThis incident has been reported to the administrator.`);
  }
  if (args[0] === '-l') {
    return ok(`User ${state.user} may run the following commands on ${state.hostname}:\n    (ALL : ALL) ALL\n`);
  }
  if (args[0] === '-i' || (args[0] === 'su' && (args.length === 1 || args[1] === '-'))) return switchUser(state, 'root');
  let target = 'root';
  let cmd = args;
  if (args[0] === '-u') {
    target = args[1];
    cmd = args.slice(2);
    if (!userDef(state, target)) return fail(`sudo: unknown user ${target}`);
  }
  const prev = state.user;
  state.user = target;
  try {
    return exec(state, cmd, ctx);
  } finally {
    state.user = prev;
  }
}

/* ---------------------------- processes ---------------------------- */

const SIGNALS: Record<string, number> = { HUP: 1, INT: 2, QUIT: 3, KILL: 9, USR1: 10, TERM: 15, CONT: 18, STOP: 19, TSTP: 20 };

function shellPid(state: TerminalState): number {
  const bash = [...state.processes].reverse().find((p) => p.cmd.includes('bash') && p.user === (userStacks.get(state)?.[0] ?? state.user));
  return bash?.pid ?? state.processes[state.processes.length - 1]?.pid ?? 1;
}

function withSelf(state: TerminalState, cmdline: string): ProcessDef[] {
  const pid = state.nextPid++;
  const sh = shellPid(state);
  const tty = state.processes.find((p) => p.pid === sh)?.tty ?? 'pts/0';
  return [...state.processes, { pid, ppid: sh, user: state.user, cmd: cmdline, state: 'R', tty, start: '09:14' }];
}

function comm(p: ProcessDef): string {
  if (p.comm) return p.comm;
  const first = p.cmd.split(' ')[0];
  if (first.startsWith('[')) return p.cmd.replace(/[[\]]/g, '');
  return basename(first).replace(/:$/, '');
}

function statStr(p: ProcessDef): string {
  let s = p.state;
  if (p.pid === 1 || p.cmd.includes('sshd') || p.cmd.includes('bash')) s += 's';
  if (p.tty && p.tty !== '?' && p.cmd.includes('bash')) s += '+';
  return s;
}

function cmdPs(args: string[], { state }: Ctx): CmdResult {
  const joined = args.join(' ');
  const procs = withSelf(state, `ps ${joined}`.trim());
  const pseudo = (p: ProcessDef) => ({
    vsz: 4000 + ((p.pid * 7919) % 160000),
    rss: 1200 + ((p.pid * 104729) % 14000),
  });
  const all = /\baux?\b|-e|-A|ax/.test(joined) || args.includes('-ef');
  let list = all ? procs : procs.filter((p) => p.tty === procs[procs.length - 1].tty);
  const pIdx = args.indexOf('-p');
  if (pIdx >= 0) {
    const ids = (args[pIdx + 1] ?? '').split(',').map(Number);
    list = procs.filter((p) => ids.includes(p.pid));
  }
  const uIdx = args.indexOf('-u');
  if (uIdx >= 0) list = procs.filter((p) => p.user === args[uIdx + 1]);

  const oIdx = args.indexOf('-o');
  if (oIdx >= 0) {
    const cols = (args[oIdx + 1] ?? 'pid,cmd').split(',');
    const head: Record<string, string> = { pid: 'PID', ppid: 'PPID', user: 'USER', stat: 'STAT', state: 'S', cmd: 'CMD', args: 'COMMAND', comm: 'COMMAND', tty: 'TT' };
    const val = (p: ProcessDef, c: string) =>
      ({ pid: String(p.pid), ppid: String(p.ppid), user: p.user, stat: statStr(p), state: p.state, cmd: p.cmd, args: p.cmd, comm: comm(p), tty: p.tty ?? '?' })[c] ?? '?';
    const rows = [cols.map((c) => head[c] ?? c.toUpperCase()), ...list.map((p) => cols.map((c) => val(p, c)))];
    const widths = cols.map((_, i) => Math.max(...rows.map((r) => r[i].length)));
    return ok(rows.map((r) => r.map((v, i) => (i === r.length - 1 ? v : ['pid', 'ppid'].includes(cols[i]) ? v.padStart(widths[i]) : v.padEnd(widths[i]))).join(' ')).join('\n') + '\n');
  }

  if (/\baux?\b/.test(joined) || joined === 'ax') {
    const lines = ['USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND'];
    for (const p of list) {
      const { vsz, rss } = pseudo(p);
      lines.push(
        `${p.user.padEnd(8).slice(0, 8)} ${String(p.pid).padStart(7)} ${(p.cpu ?? 0).toFixed(1).padStart(4)} ${(p.mem ?? 0.1).toFixed(1).padStart(4)} ${String(vsz).padStart(6)} ${String(rss).padStart(5)} ${(p.tty ?? '?').padEnd(8)} ${statStr(p).padEnd(4)} ${(p.start ?? '08:01').padEnd(5)}   0:00 ${p.cmd}`,
      );
    }
    return ok(lines.join('\n') + '\n');
  }
  if (args.includes('-ef') || (args.includes('-e') && args.includes('-f')) || args.includes('-f')) {
    const lines = ['UID          PID    PPID  C STIME TTY          TIME CMD'];
    for (const p of list) {
      lines.push(`${p.user.padEnd(8).slice(0, 8)} ${String(p.pid).padStart(7)} ${String(p.ppid).padStart(7)}  0 ${(p.start ?? '08:01').padEnd(5)} ${(p.tty ?? '?').padEnd(8)} 00:00:00 ${p.cmd}`);
    }
    return ok(lines.join('\n') + '\n');
  }
  const lines = ['    PID TTY          TIME CMD'];
  for (const p of list) lines.push(`${String(p.pid).padStart(7)} ${(p.tty ?? '?').padEnd(8)}     00:00:00 ${comm(p)}`);
  return ok(lines.join('\n') + '\n');
}

function cmdPstree(args: string[], { state }: Ctx): CmdResult {
  const showPid = args.includes('-p');
  const procs = withSelf(state, 'pstree');
  const kids = (pid: number) => procs.filter((p) => p.ppid === pid && p.pid !== pid && !p.cmd.startsWith('['));
  const label = (p: ProcessDef) => (showPid ? `${comm(p)}(${p.pid})` : comm(p));
  const lines: string[] = [];
  const rec = (p: ProcessDef, prefix: string, lastChild: boolean, root: boolean) => {
    lines.push(root ? label(p) : `${prefix}${lastChild ? '└─' : '├─'}${label(p)}`);
    const ch = kids(p.pid);
    ch.forEach((c, i) => rec(c, root ? '' : prefix + (lastChild ? '  ' : '│ '), i === ch.length - 1, false));
  };
  const init = procs.find((p) => p.pid === 1);
  if (init) rec(init, '', true, true);
  return ok(lines.join('\n') + '\n');
}

function cmdKill(args: string[], { state }: Ctx): CmdResult {
  if (args[0] === '-l') return ok(' 1) SIGHUP\t 2) SIGINT\t 3) SIGQUIT\t 9) SIGKILL\t10) SIGUSR1\n15) SIGTERM\t18) SIGCONT\t19) SIGSTOP\t20) SIGTSTP\n');
  let sig = 'TERM';
  const pids: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-s') sig = (args[++i] ?? 'TERM').toUpperCase().replace(/^SIG/, '');
    else if (a.startsWith('-')) {
      const v = a.slice(1).toUpperCase().replace(/^SIG/, '');
      sig = /^\d+$/.test(v) ? (Object.entries(SIGNALS).find(([, n]) => n === parseInt(v, 10))?.[0] ?? v) : v;
    } else pids.push(a);
  }
  if (!SIGNALS[sig] && sig !== '0') return fail(`bash: kill: ${args[0]}: invalid signal specification`);
  if (!pids.length) return fail('kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]', 2);
  let err = '';
  let info = '';
  for (const ps of pids) {
    const pid = parseInt(ps, 10);
    const p = state.processes.find((x) => x.pid === pid);
    if (!p || Number.isNaN(pid)) {
      err += `bash: kill: (${ps}) - No such process\n`;
      continue;
    }
    if (!isRoot(state) && p.user !== state.user) {
      err += `bash: kill: (${pid}) - Operation not permitted\n`;
      continue;
    }
    if (sig === '0') continue;
    state.signals.push({ pid, signal: `SIG${sig}`, cmd: p.cmd });
    if (pid === 1) {
      info += '(simulator) PID 1 (systemd) is protected by the kernel: it ignores signals it has no handler for, even SIGKILL.\n';
      continue;
    }
    if (pid === shellPid(state)) {
      info += '(simulator) That is your own shell. An interactive bash ignores SIGTERM; SIGKILL would end this session, so the simulator skips it.\n';
      continue;
    }
    if (sig === 'STOP' || sig === 'TSTP') {
      p.state = 'T';
      info += `(simulator) ${comm(p)} (${pid}) is now stopped (state T). Send SIGCONT to resume it.\n`;
    } else if (sig === 'CONT') {
      p.state = 'S';
      info += `(simulator) ${comm(p)} (${pid}) resumed.\n`;
    } else if (sig === 'KILL') {
      removeProcess(state, pid);
      info += `(simulator) The kernel destroyed ${comm(p)} (${pid}) immediately. It got no chance to clean up.\n`;
    } else if (p.ignoresTerm) {
      info += `(simulator) ${comm(p)} (${pid}) caught SIG${sig} and ignored it. It is still running. Check with ps.\n`;
    } else {
      removeProcess(state, pid);
      info += `(simulator) ${comm(p)} (${pid}) received SIG${sig}${p.termMessage ? `: ${p.termMessage}` : ' and exited'}.\n`;
    }
  }
  return { out: '', err, code: err ? 1 : 0, info: info || undefined };
}

function procName(state: TerminalState, pid: number, fallback: string): string {
  const p = state.processes.find((x) => x.pid === pid);
  return p ? comm(p) : fallback;
}

function removeProcess(state: TerminalState, pid: number) {
  state.processes = state.processes.filter((p) => p.pid !== pid);
  for (const p of state.processes) if (p.ppid === pid) p.ppid = 1; // orphans are adopted by PID 1
  for (const s of state.services) if (s.pid === pid) {
    s.active = false;
    s.pid = undefined;
  }
}

/* ---------------------------- systemctl ---------------------------- */

function cmdSystemctl(args: string[], { state }: Ctx): CmdResult {
  const [sub, ...rest] = args.filter((a) => a !== '--no-pager');
  const now = rest.includes('--now');
  const names = rest.filter((a) => !a.startsWith('-')).map((n) => n.replace(/\.service$/, ''));
  const find = (n: string) => state.services.find((s) => s.name === n);
  const needRoot = (verb: string, n: string) =>
    isRoot(state) ? null : fail(`Failed to ${verb} ${n}.service: Interactive authentication required.\nSee system logs and 'systemctl status ${n}.service' for details.`);

  if (!sub || sub === 'list-units') {
    const lines = ['  UNIT                      LOAD   ACTIVE   SUB     DESCRIPTION'];
    for (const s of state.services) {
      lines.push(`  ${(s.name + '.service').padEnd(25)} loaded ${(s.active ? 'active' : 'inactive').padEnd(8)} ${(s.active ? 'running' : 'dead').padEnd(7)} ${s.description}`);
    }
    lines.push('', `${state.services.length} loaded units listed.`);
    return ok(lines.join('\n') + '\n');
  }
  if (sub === 'list-unit-files') {
    return ok(['UNIT FILE                 STATE', ...state.services.map((s) => `${(s.name + '.service').padEnd(25)} ${s.enabled ? 'enabled' : 'disabled'}`)].join('\n') + '\n');
  }
  if (!names.length) return fail(`Too few arguments.`);
  let out = '';
  let code = 0;
  for (const n of names) {
    const s = find(n);
    if (!s) {
      if (sub === 'status') return fail(`Unit ${n}.service could not be found.`, 4);
      return fail(`Failed to ${sub} ${n}.service: Unit ${n}.service not found.`, 5);
    }
    const unit = s.unitPath ?? `/usr/lib/systemd/system/${s.name}.service`;
    switch (sub) {
      case 'status': {
        out +=
          `${s.active ? '●' : '○'} ${s.name}.service - ${s.description}\n` +
          `     Loaded: loaded (${unit}; ${s.enabled ? 'enabled' : 'disabled'}; preset: enabled)\n` +
          `     Active: ${s.active ? 'active (running) since Mon 2026-10-26 08:01:12 UTC; 1h 13min ago' : 'inactive (dead)'}\n` +
          (s.active && s.pid ? `   Main PID: ${s.pid} (${procName(state, s.pid, s.name)})\n` : '');
        if (!s.active) code = 3;
        break;
      }
      case 'is-active':
        out += (s.active ? 'active' : 'inactive') + '\n';
        if (!s.active) code = 3;
        break;
      case 'is-enabled':
        out += (s.enabled ? 'enabled' : 'disabled') + '\n';
        if (!s.enabled) code = 1;
        break;
      case 'start':
      case 'stop':
      case 'restart':
      case 'reload': {
        const r = needRoot(sub, n);
        if (r) return r;
        if (sub === 'stop') {
          if (s.pid) removeProcess(state, s.pid);
          s.active = false;
        } else {
          if (!s.active || sub === 'restart') {
            if (s.pid) removeProcess(state, s.pid);
            s.pid = state.nextPid++;
            state.processes.push({ pid: s.pid, ppid: 1, user: 'root', cmd: `/usr/sbin/${s.name}`, state: 'S', tty: '?' });
          }
          s.active = true;
        }
        break;
      }
      case 'enable':
      case 'disable': {
        const r = needRoot(sub, n);
        if (r) return r;
        const enable = sub === 'enable';
        if (enable !== s.enabled) {
          out += enable
            ? `Created symlink /etc/systemd/system/multi-user.target.wants/${s.name}.service → ${unit}.\n`
            : `Removed "/etc/systemd/system/multi-user.target.wants/${s.name}.service".\n`;
        }
        s.enabled = enable;
        if (now) {
          if (enable && !s.active) {
            s.pid = state.nextPid++;
            state.processes.push({ pid: s.pid, ppid: 1, user: 'root', cmd: `/usr/sbin/${s.name}`, state: 'S', tty: '?' });
            s.active = true;
          }
          if (!enable && s.active) {
            if (s.pid) removeProcess(state, s.pid);
            s.active = false;
          }
        }
        break;
      }
      default:
        return fail(`Unknown command verb ${sub}.`);
    }
  }
  return { out, err: '', code };
}

/* ------------------------------------------------------------------ */
/* Tab completion                                                      */
/* ------------------------------------------------------------------ */

export function complete(state: TerminalState, line: string): string {
  const words = line.split(' ');
  const last = words[words.length - 1];
  if (words.length === 1) {
    const opts = Object.keys(COMMANDS).filter((c) => c.startsWith(last));
    if (opts.length === 1) return opts[0] + ' ';
    return line;
  }
  const slash = last.lastIndexOf('/');
  const dirPart = slash >= 0 ? last.slice(0, slash + 1) : '';
  const namePart = slash >= 0 ? last.slice(slash + 1) : last;
  const node = tryLookup(state, absPath(state, dirPart || '.'));
  if (!node || node.type !== 'dir' || !can(state, node, 'r')) return line;
  const opts = Object.keys(node.children!).filter((n) => n.startsWith(namePart) && (namePart.startsWith('.') || !n.startsWith('.')));
  if (!opts.length) return line;
  let common = opts[0];
  for (const o of opts) while (!o.startsWith(common)) common = common.slice(0, -1);
  let completed = dirPart + common;
  if (opts.length === 1) {
    const child = node.children![opts[0]];
    completed += child.type === 'dir' ? '/' : ' ';
  }
  words[words.length - 1] = completed;
  return words.join(' ');
}

export function prompt(state: TerminalState): string {
  const home = homeOf(state);
  const where = state.cwd === home ? '~' : state.cwd.startsWith(home + '/') ? '~' + state.cwd.slice(home.length) : state.cwd;
  return `${state.user}@${state.hostname}:${where}${isRoot(state) ? '#' : '$'} `;
}

export { peek };
