import { useState } from 'react';

interface State {
  original: boolean;
  hard: boolean;
  soft: boolean;
}

/**
 * Directory entries (names) → inodes (metadata) → data blocks.
 * Shows why a hard link survives deleting the original name and a symlink does not.
 */
export default function LinksViz() {
  const [s, setS] = useState<State>({ original: true, hard: false, soft: false });
  const links = (s.original ? 1 : 0) + (s.hard ? 1 : 0);
  const inodeAlive = links > 0;
  const dangling = s.soft && !s.original;

  const log: string[] = [];
  if (s.hard) log.push('$ ln report.txt backup.txt');
  if (s.soft) log.push('$ ln -s report.txt latest');
  if (!s.original) log.push('$ rm report.txt');

  const lsLines: string[] = [];
  if (s.original) lsLines.push(`1234 -rw-r--r-- ${links} analyst analyst 412 report.txt`);
  if (s.hard) lsLines.push(`1234 -rw-r--r-- ${links} analyst analyst 412 backup.txt`);
  if (s.soft) lsLines.push(`1301 lrwxrwxrwx 1 analyst analyst  10 latest -> report.txt${dangling ? '   (broken)' : ''}`);

  const row = (y: number) => y;
  return (
    <div>
      <div className="controls" style={{ marginBottom: '0.8rem' }}>
        <button type="button" className="btn btn-small" disabled={s.hard} onClick={() => setS({ ...s, hard: true })}>
          Create hard link <code>backup.txt</code>
        </button>
        <button type="button" className="btn btn-small" disabled={s.soft} onClick={() => setS({ ...s, soft: true })}>
          Create symlink <code>latest</code>
        </button>
        <button type="button" className="btn btn-small" disabled={!s.original} onClick={() => setS({ ...s, original: false })}>
          Delete <code>report.txt</code>
        </button>
        <button type="button" className="btn btn-small btn-quiet" onClick={() => setS({ original: true, hard: false, soft: false })}>
          Reset
        </button>
      </div>

      <div className="viz-scroll">
        <svg viewBox="0 0 700 300" role="img" aria-labelledby="links-t links-d">
          <title id="links-t">Names, inodes and data</title>
          <desc id="links-d">
            {`Directory entries on the left point to inodes in the middle, which point to data blocks on the right. report.txt ${s.original ? 'exists' : 'was deleted'}. ` +
              `${s.hard ? 'backup.txt is a hard link to the same inode 1234. ' : ''}${s.soft ? `latest is a symlink storing the path report.txt${dangling ? ', which no longer exists, so it is broken' : ''}. ` : ''}` +
              `Inode 1234 has link count ${links}${inodeAlive ? '' : ' and has been freed'}.`}
          </desc>
          <text x="20" y="24" className="layer-label">DIRECTORY ENTRIES (names)</text>
          <text x="270" y="24" className="layer-label">INODES (metadata)</text>
          <text x="530" y="24" className="layer-label">DATA BLOCKS</text>

          {/* names */}
          <NameBox y={row(50)} label="report.txt" visible={s.original} />
          <NameBox y={row(130)} label="backup.txt" visible={s.hard} hard />
          <NameBox y={row(210)} label="latest" visible={s.soft} soft broken={dangling} />

          {/* inode 1234 */}
          <g opacity={inodeAlive ? 1 : 0.35}>
            <rect x="250" y="60" width="200" height="98" rx="8" fill="var(--d-kernel)" stroke="var(--d-stroke)" />
            <text x="264" y="84" className="mono box-label">inode 1234</text>
            <text x="264" y="104" className="small-label">type: regular file · mode 644</text>
            <text x="264" y="121" className="small-label">owner analyst · size 412</text>
            <text x="264" y="140" className={`small-label${s.hard || !s.original ? ' emph' : ''}`}>
              link count: {links}
              {inodeAlive ? '' : ' → freed'}
            </text>
          </g>
          {/* inode 1301 (symlink) */}
          {s.soft && (
            <g>
              <rect x="250" y="190" width="200" height="74" rx="8" fill="var(--d-syscall)" stroke="var(--d-stroke)" />
              <text x="264" y="214" className="mono box-label">inode 1301</text>
              <text x="264" y="233" className="small-label">type: symbolic link</text>
              <text x="264" y="251" className="small-label mono">stores: "report.txt"</text>
            </g>
          )}

          {/* data */}
          <g opacity={inodeAlive ? 1 : 0.35}>
            <rect x="510" y="70" width="170" height="78" rx="8" fill="var(--d-hw)" stroke="var(--d-stroke)" />
            <text x="524" y="98" className="mono small-label">quarterly numbers</text>
            <text x="524" y="116" className="mono small-label">Q3: 41,200</text>
            <text x="524" y="134" className="small-label">{inodeAlive ? 'blocks in use' : 'blocks free for reuse'}</text>
          </g>

          {/* arrows */}
          <defs>
            <marker id="arrow-l" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--d-flow)" />
            </marker>
            <marker id="arrow-bad" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--bad)" />
            </marker>
          </defs>
          {s.original && <path d="M190 72 C 220 72, 220 95, 248 95" fill="none" stroke="var(--d-flow)" strokeWidth="2" markerEnd="url(#arrow-l)" />}
          {s.hard && <path d="M190 152 C 220 152, 220 125, 248 125" fill="none" stroke="var(--d-flow)" strokeWidth="2" markerEnd="url(#arrow-l)" />}
          {s.soft && <path d="M190 232 C 220 232, 220 227, 248 227" fill="none" stroke="var(--d-flow)" strokeWidth="2" markerEnd="url(#arrow-l)" />}
          {s.soft && (
            // the symlink points at a NAME, not at the inode
            <path
              d="M250 205 C 215 190, 215 85, 192 75"
              fill="none"
              stroke={dangling ? 'var(--bad)' : 'var(--d-highlight)'}
              strokeWidth="2"
              strokeDasharray="5 4"
              markerEnd={dangling ? 'url(#arrow-bad)' : 'url(#arrow-l)'}
            />
          )}
          {inodeAlive && <path d="M452 109 L 508 109" fill="none" stroke="var(--d-flow)" strokeWidth="2" markerEnd="url(#arrow-l)" />}
        </svg>
      </div>

      <div className="explain-panel" aria-live="polite">
        <pre className="strace-line" style={{ marginBottom: '0.5rem' }}>
          <code>{(log.length ? log.join('\n') + '\n' : '') + '$ ls -li\n' + (lsLines.join('\n') || '(empty)')}</code>
        </pre>
        <p>
          {!s.hard && !s.soft && s.original && 'A file is really two things: a name in a directory, and an inode that holds the metadata and points to the data. Try the buttons.'}
          {s.hard && s.original && 'A hard link is just a second name for the same inode. Both names are equal: neither is the “original”. The inode’s link count is now 2.'}
          {s.soft && s.original && !s.hard && 'A symbolic link is a separate small file (its own inode) that stores a path. The kernel follows that path when you open it.'}
          {!s.original && s.hard && 'rm only removes a name. The inode and its data survive because backup.txt still points to them (link count 1). Data is freed only when the count reaches 0 and no process has the file open.'}
          {!s.original && !s.hard && 'With no names left (link count 0) the inode and its blocks are freed.'}
          {dangling && ' The symlink still stores “report.txt”, but nothing has that name any more, so it is now a broken (dangling) link.'}
        </p>
      </div>
    </div>
  );
}

function NameBox({ y, label, visible, hard, soft, broken }: { y: number; label: string; visible: boolean; hard?: boolean; soft?: boolean; broken?: boolean }) {
  if (!visible) {
    return (
      <g opacity="0.4">
        <rect x="20" y={y} width="170" height="44" rx="6" fill="none" stroke="var(--d-stroke)" strokeDasharray="4 4" />
        <text x="105" y={y + 27} textAnchor="middle" className="small-label">
          {label === 'report.txt' ? '(deleted)' : '—'}
        </text>
      </g>
    );
  }
  return (
    <g>
      <rect x="20" y={y} width="170" height="44" rx="6" fill="var(--surface)" stroke={broken ? 'var(--bad)' : 'var(--d-stroke)'} strokeWidth={broken ? 2 : 1} />
      <text x="34" y={y + 27} className="mono box-label">
        {label}
      </text>
      <text x="180" y={y + 27} textAnchor="end" className="small-label">
        {hard ? 'hard link' : soft ? (broken ? 'broken' : 'symlink') : ''}
      </text>
    </g>
  );
}
