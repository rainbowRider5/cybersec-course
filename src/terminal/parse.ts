/**
 * A small subset of Bash syntax: words, quoting, $VAR expansion, ~, globs,
 * pipes (|), redirection (> >> < 2> 2>> 2>&1 &>), and lists (; && ||).
 */

export interface Word {
  value: string;
  /** True if the word contained an unquoted *, ? or [ and should be glob-expanded. */
  glob: boolean;
}

export type Token = { t: 'word'; w: Word } | { t: 'op'; v: string };

export interface Redirect {
  fd: 1 | 2;
  append: boolean;
  target: string;
}

export interface SimpleCommand {
  argv: Word[];
  redirects: Redirect[];
  stdinFile?: string;
  stderrToStdout: boolean;
}

export interface ListItem {
  /** How this pipeline is joined to the previous one. */
  join: ';' | '&&' | '||';
  pipeline: SimpleCommand[];
}

export class ParseError extends Error {}

export function tokenize(line: string, env: Record<string, string>, home: string, lastCode: number): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let cur: Word | null = null;
  const push = () => {
    if (cur) tokens.push({ t: 'word', w: cur });
    cur = null;
  };
  const ensure = () => (cur ??= { value: '', glob: false });

  const expandVar = (): string => {
    // at line[i] === '$'
    i++;
    if (line[i] === '?') {
      i++;
      return String(lastCode);
    }
    if (line[i] === '{') {
      const end = line.indexOf('}', i);
      if (end === -1) throw new ParseError('bad substitution');
      const name = line.slice(i + 1, end);
      i = end + 1;
      return env[name] ?? '';
    }
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(line.slice(i));
    if (!m) return '$';
    i += m[0].length;
    return env[m[0]] ?? '';
  };

  while (i < line.length) {
    const c = line[i];
    if (c === ' ' || c === '\t') {
      push();
      i++;
      continue;
    }
    if (c === '#' && !cur) break; // comment
    // operators
    const rest = line.slice(i);
    const op = ['2>&1', '2>>', '&>', '&&', '||', '>>', '2>', '|', '>', '<', ';'].find((o) => rest.startsWith(o));
    if (op && !(op.startsWith('2') && cur)) {
      push();
      tokens.push({ t: 'op', v: op });
      i += op.length;
      continue;
    }
    if (c === '&') throw new ParseError('background jobs (&) are not supported in this simulator');
    if (c === "'") {
      const end = line.indexOf("'", i + 1);
      if (end === -1) throw new ParseError('unexpected EOF while looking for matching `\'\'');
      ensure().value += line.slice(i + 1, end);
      i = end + 1;
      continue;
    }
    if (c === '"') {
      ensure();
      i++;
      while (i < line.length && line[i] !== '"') {
        if (line[i] === '\\' && i + 1 < line.length && '"\\$`'.includes(line[i + 1])) {
          cur!.value += line[i + 1];
          i += 2;
        } else if (line[i] === '$') {
          cur!.value += expandVar();
        } else {
          cur!.value += line[i++];
        }
      }
      if (line[i] !== '"') throw new ParseError('unexpected EOF while looking for matching `"\'');
      i++;
      continue;
    }
    if (c === '\\') {
      ensure().value += line[i + 1] ?? '';
      i += 2;
      continue;
    }
    if (c === '$') {
      ensure().value += expandVar();
      continue;
    }
    if (c === '~' && !cur && (line[i + 1] === undefined || line[i + 1] === '/' || line[i + 1] === ' ')) {
      ensure().value += home;
      i++;
      continue;
    }
    if (c === '*' || c === '?' || c === '[') ensure().glob = true;
    ensure().value += c;
    i++;
  }
  push();
  return tokens;
}

export function parse(tokens: Token[]): ListItem[] {
  const list: ListItem[] = [];
  let join: ListItem['join'] = ';';
  let pipeline: SimpleCommand[] = [];
  let cmd: SimpleCommand = { argv: [], redirects: [], stderrToStdout: false };

  const endCommand = () => {
    if (cmd.argv.length === 0) throw new ParseError('syntax error: missing command');
    pipeline.push(cmd);
    cmd = { argv: [], redirects: [], stderrToStdout: false };
  };
  const endPipeline = () => {
    endCommand();
    list.push({ join, pipeline });
    pipeline = [];
  };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.t === 'word') {
      cmd.argv.push(tok.w);
      continue;
    }
    const needTarget = () => {
      const next = tokens[++i];
      if (!next || next.t !== 'word') throw new ParseError(`syntax error near unexpected token \`${tok.v}'`);
      return next.w.value;
    };
    switch (tok.v) {
      case '|':
        endCommand();
        break;
      case ';':
      case '&&':
      case '||':
        if (cmd.argv.length === 0 && pipeline.length === 0 && tok.v === ';' && list.length === 0) break;
        endPipeline();
        join = tok.v as ListItem['join'];
        break;
      case '>':
        cmd.redirects.push({ fd: 1, append: false, target: needTarget() });
        break;
      case '>>':
        cmd.redirects.push({ fd: 1, append: true, target: needTarget() });
        break;
      case '2>':
        cmd.redirects.push({ fd: 2, append: false, target: needTarget() });
        break;
      case '2>>':
        cmd.redirects.push({ fd: 2, append: true, target: needTarget() });
        break;
      case '&>': {
        const t = needTarget();
        cmd.redirects.push({ fd: 1, append: false, target: t });
        cmd.stderrToStdout = true;
        break;
      }
      case '2>&1':
        cmd.stderrToStdout = true;
        break;
      case '<':
        cmd.stdinFile = needTarget();
        break;
    }
  }
  if (cmd.argv.length > 0 || pipeline.length > 0) endPipeline();
  return list;
}

/** Converts a shell glob (* ? [abc]) to an anchored RegExp. */
export function globToRegExp(glob: string, flags = ''): RegExp {
  let re = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') re += '.*';
    else if (c === '?') re += '.';
    else if (c === '[') {
      const end = glob.indexOf(']', i + 1);
      if (end === -1) re += '\\[';
      else {
        let cls = glob.slice(i + 1, end);
        if (cls.startsWith('!')) cls = '^' + cls.slice(1);
        re += `[${cls.replace(/\\/g, '\\\\')}]`;
        i = end;
      }
    } else re += c.replace(/[.+^${}()|\\]/g, '\\$&');
  }
  return new RegExp(re + '$', flags);
}
