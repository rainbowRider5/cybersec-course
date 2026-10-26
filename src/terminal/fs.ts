import type { FsNode, TerminalState, UserDef } from './types';

/* ------------------------------------------------------------------ */
/* Builders used by scenario definitions                               */
/* ------------------------------------------------------------------ */

interface NodeOpts {
  mode?: number;
  owner?: string;
  group?: string;
  mtime?: string;
  size?: number;
}

export function dir(children: Record<string, FsNode> = {}, opts: NodeOpts = {}): FsNode {
  return {
    type: 'dir',
    mode: opts.mode ?? 0o755,
    owner: opts.owner ?? 'root',
    group: opts.group ?? opts.owner ?? 'root',
    mtime: opts.mtime,
    children,
  };
}

export function file(content: string, opts: NodeOpts = {}): FsNode {
  return {
    type: 'file',
    mode: opts.mode ?? 0o644,
    owner: opts.owner ?? 'root',
    group: opts.group ?? opts.owner ?? 'root',
    mtime: opts.mtime,
    size: opts.size,
    content,
  };
}

/** A "binary": unreadable gibberish content with a realistic size. */
export function bin(size: number, opts: NodeOpts = {}): FsNode {
  return file('\u0000ELF (binary file, not shown)\n', { mode: 0o755, size, ...opts });
}

export function device(kind: 'char' | 'block', dev: string, opts: NodeOpts = {}): FsNode {
  return { type: kind, mode: opts.mode ?? 0o660, owner: opts.owner ?? 'root', group: opts.group ?? 'root', mtime: opts.mtime, dev, content: '' };
}

export function link(target: string, opts: NodeOpts = {}): FsNode {
  return {
    type: 'link',
    mode: 0o777,
    owner: opts.owner ?? 'root',
    group: opts.group ?? opts.owner ?? 'root',
    mtime: opts.mtime,
    target,
  };
}

/** Assigns inode numbers to every node (shared objects = hard links keep one number). */
export function assignInodes(root: FsNode): void {
  let next = 2;
  const seen = new Set<FsNode>();
  const walk = (n: FsNode) => {
    if (seen.has(n)) return;
    seen.add(n);
    n.ino = next === 2 ? 2 : 131000 + next * 7;
    next++;
    if (n.children) Object.keys(n.children).sort().forEach((k) => walk(n.children![k]));
  };
  walk(root);
}

/* ------------------------------------------------------------------ */
/* Paths                                                               */
/* ------------------------------------------------------------------ */

export function homeOf(state: TerminalState, user = state.user): string {
  return state.users.find((u) => u.name === user)?.home ?? '/';
}

/** Turns any path (relative, ~, .., .) into a normalised absolute path string. */
export function absPath(state: TerminalState, p: string): string {
  let path = p;
  if (path === '~' || path.startsWith('~/')) path = homeOf(state) + path.slice(1);
  if (!path.startsWith('/')) path = (state.cwd === '/' ? '' : state.cwd) + '/' + path;
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return '/' + out.join('/');
}

export function splitPath(abs: string): string[] {
  return abs.split('/').filter(Boolean);
}

export function parentAndName(abs: string): [string, string] {
  const parts = splitPath(abs);
  const name = parts.pop() ?? '';
  return ['/' + parts.join('/'), name];
}

export function basename(p: string): string {
  const parts = splitPath(p);
  return parts[parts.length - 1] ?? '/';
}

/* ------------------------------------------------------------------ */
/* Users & permissions                                                 */
/* ------------------------------------------------------------------ */

export function userDef(state: TerminalState, name = state.user): UserDef | undefined {
  return state.users.find((u) => u.name === name);
}

export function isRoot(state: TerminalState): boolean {
  return state.user === 'root';
}

export function inGroup(state: TerminalState, group: string, user = state.user): boolean {
  return userDef(state, user)?.groups.includes(group) ?? false;
}

export type Perm = 'r' | 'w' | 'x';
const PERM_BIT: Record<Perm, number> = { r: 4, w: 2, x: 1 };

/**
 * Linux permission check: exactly ONE class applies (owner, else group, else others).
 * root bypasses read/write, and may execute if any x bit is set (or always, for directories).
 */
export function can(state: TerminalState, node: FsNode, perm: Perm, user = state.user): boolean {
  const bit = PERM_BIT[perm];
  if (user === 'root') {
    if (perm !== 'x' || node.type === 'dir') return true;
    return (node.mode & 0o111) !== 0;
  }
  let cls: number;
  if (node.owner === user) cls = (node.mode >> 6) & 7;
  else if (inGroup(state, node.group, user)) cls = (node.mode >> 3) & 7;
  else cls = node.mode & 7;
  return (cls & bit) !== 0;
}

/* ------------------------------------------------------------------ */
/* Lookup                                                              */
/* ------------------------------------------------------------------ */

export class FsError extends Error {}

const MAX_LINKS = 8;

/**
 * Walks to an absolute path. Checks search (x) permission on each directory.
 * `follow` controls whether a symlink in the final position is followed.
 */
export function lookup(state: TerminalState, abs: string, follow = true, depth = 0): FsNode {
  if (depth > MAX_LINKS) throw new FsError('Too many levels of symbolic links');
  const parts = splitPath(abs);
  let node = state.fs;
  let curPath = '';
  for (let i = 0; i < parts.length; i++) {
    if (node.type !== 'dir') throw new FsError('Not a directory');
    if (!can(state, node, 'x')) throw new FsError('Permission denied');
    const child = node.children![parts[i]];
    if (!child) throw new FsError('No such file or directory');
    const last = i === parts.length - 1;
    if (child.type === 'link' && (!last || follow)) {
      const target = child.target!.startsWith('/') ? child.target! : `${curPath}/${child.target}`;
      const rest = parts.slice(i + 1).join('/');
      const resolved = normalise(rest ? `${target}/${rest}` : target);
      return lookup(state, resolved, follow, depth + 1);
    }
    curPath += '/' + parts[i];
    node = child;
  }
  return node;
}

function normalise(p: string): string {
  const out: string[] = [];
  for (const part of p.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return '/' + out.join('/');
}

export function tryLookup(state: TerminalState, abs: string, follow = true): FsNode | undefined {
  try {
    return lookup(state, abs, follow);
  } catch {
    return undefined;
  }
}

/** Lookup ignoring permissions. Used by task checks, which inspect the state as an observer. */
export function peek(root: FsNode, abs: string): FsNode | undefined {
  let node: FsNode | undefined = root;
  for (const part of splitPath(abs)) {
    if (!node || node.type !== 'dir') return undefined;
    node = node.children![part];
  }
  return node;
}

/** Parent directory for creating/removing an entry; checks w+x on it. */
export function parentForWrite(state: TerminalState, abs: string): { parent: FsNode; name: string } {
  const [pPath, name] = parentAndName(abs);
  const parent = lookup(state, pPath);
  if (parent.type !== 'dir') throw new FsError('Not a directory');
  if (!can(state, parent, 'w') || !can(state, parent, 'x')) throw new FsError('Permission denied');
  return { parent, name };
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

export function modeString(node: Pick<FsNode, 'type' | 'mode'>): string {
  const t = { dir: 'd', link: 'l', char: 'c', block: 'b', file: '-' }[node.type];
  return t + permString(node.mode);
}

/** 9-character rwx string including s/S, t/T for special bits. */
export function permString(mode: number): string {
  const tri = (bits: number, special: boolean, ch: 's' | 't') => {
    const r = bits & 4 ? 'r' : '-';
    const w = bits & 2 ? 'w' : '-';
    let x = bits & 1 ? 'x' : '-';
    if (special) x = bits & 1 ? ch : ch.toUpperCase();
    return r + w + x;
  };
  return (
    tri((mode >> 6) & 7, (mode & 0o4000) !== 0, 's') +
    tri((mode >> 3) & 7, (mode & 0o2000) !== 0, 's') +
    tri(mode & 7, (mode & 0o1000) !== 0, 't')
  );
}

export function octal(mode: number, digits = 4): string {
  return (mode & 0o7777).toString(8).padStart(digits, '0');
}

export function nodeSize(node: FsNode): number {
  if (node.type === 'dir') return 4096;
  if (node.type === 'link') return node.target!.length;
  if (node.type === 'char' || node.type === 'block') return 0;
  return node.size ?? new TextEncoder().encode(node.content ?? '').length;
}

/** Hard link count: dirs = 2 + subdirs; files = number of directory entries pointing at them. */
export function linkCount(state: TerminalState, node: FsNode): number {
  if (node.type === 'dir') {
    return 2 + Object.values(node.children!).filter((c) => c.type === 'dir').length;
  }
  let count = 0;
  const seen = new Set<FsNode>();
  const walk = (n: FsNode) => {
    if (seen.has(n) || !n.children) return;
    seen.add(n);
    for (const c of Object.values(n.children)) {
      if (c === node) count++;
      if (c.type === 'dir') walk(c);
    }
  };
  walk(state.fs);
  return Math.max(count, 1);
}

/* ------------------------------------------------------------------ */
/* Walking                                                             */
/* ------------------------------------------------------------------ */

/** Depth-first walk that reports permission errors the way `find` does. */
export function walkTree(
  state: TerminalState,
  absStart: string,
  start: string,
  visit: (path: string, node: FsNode, depth: number) => void,
  onError: (path: string, msg: string) => void,
  maxDepth = Infinity,
): void {
  let startNode: FsNode;
  try {
    startNode = lookup(state, absStart, true);
  } catch (e) {
    onError(start, (e as Error).message);
    return;
  }
  const rec = (path: string, node: FsNode, depth: number) => {
    visit(path, node, depth);
    if (node.type !== 'dir' || depth >= maxDepth) return;
    if (!can(state, node, 'r') || !can(state, node, 'x')) {
      onError(path, 'Permission denied');
      return;
    }
    for (const name of Object.keys(node.children!).sort()) {
      const child = node.children![name];
      rec(path.endsWith('/') ? `${path}${name}` : `${path}/${name}`, child, depth + 1);
    }
  };
  rec(start, startNode, 0);
}
