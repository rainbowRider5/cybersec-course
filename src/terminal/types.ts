/**
 * Types for the in-browser simulated terminal.
 * Nothing here executes real code: commands operate on an in-memory filesystem.
 */

/** 'char' and 'block' are device files such as /dev/null or /dev/sda. */
export type NodeType = 'file' | 'dir' | 'link' | 'char' | 'block';

export interface FsNode {
  type: NodeType;
  /** Permission bits including SUID/SGID/sticky, e.g. 0o4755. */
  mode: number;
  owner: string;
  group: string;
  /** File contents (files only). */
  content?: string;
  /** Directory entries (dirs only). Two entries may point at the same object: that is a hard link. */
  children?: Record<string, FsNode>;
  /** Symlink target path (links only). */
  target?: string;
  /** Display timestamp for ls -l, e.g. "Oct 26 09:12". */
  mtime?: string;
  /** Fake size for files whose content we do not store (binaries). */
  size?: number;
  /** Device numbers shown by ls -l instead of a size, e.g. "1, 3". */
  dev?: string;
  /** Inode number. Assigned automatically when a scenario is loaded. */
  ino?: number;
}

export interface UserDef {
  name: string;
  uid: number;
  /** Group names; the first is the primary group. */
  groups: string[];
  home: string;
  shell?: string;
}

export interface GroupDef {
  name: string;
  gid: number;
}

export type ProcState = 'R' | 'S' | 'D' | 'T' | 'Z' | 'I';

export interface ProcessDef {
  pid: number;
  ppid: number;
  user: string;
  /** Full command line, e.g. "/usr/sbin/sshd -D". */
  cmd: string;
  /** Short command name (as in /proc/PID/comm, max 15 chars). Defaults to the program's basename. */
  comm?: string;
  state: ProcState;
  tty?: string;
  cpu?: number;
  mem?: number;
  start?: string;
  /** If true, the process installed a SIGTERM handler that ignores it (only SIGKILL stops it). */
  ignoresTerm?: boolean;
  /** Message printed when it handles SIGTERM gracefully. */
  termMessage?: string;
}

export interface ServiceDef {
  name: string;
  description: string;
  active: boolean;
  enabled: boolean;
  pid?: number;
  unitPath?: string;
}

export interface TerminalScenario {
  hostname: string;
  /** Name of the user the session starts as. */
  user: string;
  cwd: string;
  users: UserDef[];
  groups: GroupDef[];
  fs: FsNode;
  processes: ProcessDef[];
  services: ServiceDef[];
  env?: Record<string, string>;
  umask?: number;
  /** Static output for `who` and `last`. */
  whoOutput?: string;
  lastOutput?: string;
}

export interface SignalRecord {
  pid: number;
  signal: string;
  cmd: string;
}

/** Mutable runtime state of one terminal session. Task checks receive this. */
export interface TerminalState {
  hostname: string;
  user: string;
  cwd: string;
  prevCwd: string;
  users: UserDef[];
  groups: GroupDef[];
  fs: FsNode;
  processes: ProcessDef[];
  services: ServiceDef[];
  env: Record<string, string>;
  umask: number;
  whoOutput: string;
  lastOutput: string;
  history: string[];
  /** The last command line the learner ran and its combined output. */
  lastCommand: string;
  lastStdout: string;
  lastExitCode: number;
  signals: SignalRecord[];
  nextPid: number;
}

export interface TerminalTask {
  id: string;
  /** Markdown. */
  instruction: string;
  hint?: string;
  /** Commands that complete the task. Shown on request, and run by `npm run check`. */
  solution?: string[];
  check: (state: TerminalState) => boolean;
  success?: string;
}
