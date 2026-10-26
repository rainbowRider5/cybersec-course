import { useId, useState } from 'react';
import { Markdown } from '../../../components/Markdown';

const INPUT = [
  'FAIL 203.0.113.45',
  'OK 198.51.100.23',
  'FAIL 198.51.100.77',
  'FAIL 203.0.113.45',
  'OK 198.51.100.40',
  'FAIL 203.0.113.45',
  'FAIL 198.51.100.77',
  'FAIL 203.0.113.45',
  'OK 198.51.100.23',
  'FAIL 192.0.2.10',
];

interface Stage {
  cmd: string;
  run: (lines: string[]) => string[];
  explain: string;
}

function uniqC(lines: string[]): string[] {
  const out: { l: string; n: number }[] = [];
  for (const l of lines) {
    const last = out[out.length - 1];
    if (last && last.l === l) last.n++;
    else out.push({ l, n: 1 });
  }
  return out.map((o) => `${String(o.n).padStart(7)} ${o.l}`);
}

export default function PipelineViz() {
  const [pattern, setPattern] = useState('FAIL');
  const [useSort, setUseSort] = useState(true);
  const [rank, setRank] = useState(false);
  const [shown, setShown] = useState(1);
  const id = useId();

  const stages: Stage[] = [
    { cmd: 'cat logins.txt', run: () => INPUT, explain: '`cat` reads the file and writes every line to its standard output. The pipe connects that output to the next command’s standard input.' },
    {
      cmd: `grep ${pattern || '""'}`,
      run: (ls) => ls.filter((l) => l.includes(pattern)),
      explain: `\`grep\` passes on only the lines containing “${pattern}”. Lines that do not match are dropped.`,
    },
  ];
  if (useSort) stages.push({ cmd: 'sort', run: (ls) => [...ls].sort(), explain: '`sort` puts identical lines next to each other. That matters because the next tool only compares neighbouring lines.' });
  stages.push({
    cmd: 'uniq -c',
    run: uniqC,
    explain: useSort
      ? '`uniq -c` collapses each run of identical adjacent lines into one, prefixed with a count.'
      : '**Without sort, the counts are wrong**: `uniq` only merges duplicates that are next to each other, so the same IP appears several times with small counts.',
  });
  if (rank) stages.push({ cmd: 'sort -rn', run: (ls) => [...ls].sort((a, b) => parseInt(b, 10) - parseInt(a, 10) || (a < b ? -1 : 1)), explain: '`sort -rn` sorts numerically (`-n`) in reverse (`-r`), so the busiest source comes first.' });

  const outputs: string[][] = [];
  let cur: string[] = [];
  for (const s of stages) {
    cur = s.run(cur);
    outputs.push(cur);
  }
  const visible = Math.min(shown, stages.length);
  const command = stages.map((s) => s.cmd).join(' | ');

  return (
    <div className="pipeline-viz">
      <div className="controls" style={{ marginBottom: '0.6rem' }}>
        <label htmlFor={`${id}-pat`} style={{ fontSize: '0.9rem' }}>
          grep pattern
        </label>
        <input
          id={`${id}-pat`}
          type="text"
          className="mono"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          style={{ width: '8rem' }}
          spellCheck={false}
        />
        <label className="pipe-toggle">
          <input type="checkbox" checked={useSort} onChange={(e) => setUseSort(e.target.checked)} /> include <code>sort</code>
        </label>
        <label className="pipe-toggle">
          <input type="checkbox" checked={rank} onChange={(e) => setRank(e.target.checked)} /> add <code>| sort -rn</code>
        </label>
      </div>
      <pre className="strace-line" style={{ marginBottom: '0.8rem' }}>
        <code>$ {command}</code>
      </pre>
      <div className="controls" style={{ marginBottom: '0.8rem' }}>
        <button type="button" className="btn btn-primary btn-small" onClick={() => setShown((n) => Math.min(stages.length, n + 1))} disabled={visible >= stages.length}>
          Send data to the next stage →
        </button>
        <button type="button" className="btn btn-small" onClick={() => setShown(stages.length)} disabled={visible >= stages.length}>
          Show all
        </button>
        <button type="button" className="btn btn-small btn-quiet" onClick={() => setShown(1)}>
          Restart
        </button>
      </div>

      <ol className="pipe-stages" aria-label="Pipeline stages">
        {stages.map((s, i) => {
          const on = i < visible;
          return (
            <li key={s.cmd + i} className={`pipe-stage${on ? ' on' : ''}${i === visible - 1 ? ' current' : ''}`}>
              {i > 0 && (
                <div className="pipe-connector" aria-hidden="true">
                  <span>stdout → | → stdin</span>
                </div>
              )}
              <div className="pipe-box">
                <div className="pipe-cmd mono">{s.cmd}</div>
                {on ? (
                  <>
                    <pre className="pipe-data">
                      <code>{outputs[i].length ? outputs[i].join('\n') : '(no lines)'}</code>
                    </pre>
                    <div className="pipe-count">{outputs[i].length} line{outputs[i].length === 1 ? '' : 's'} out</div>
                  </>
                ) : (
                  <div className="pipe-wait">waiting for input…</div>
                )}
              </div>
              {on && i === visible - 1 && (
                <p className="pipe-explain" aria-live="polite">
                  <Markdown text={s.explain} inline />
                </p>
              )}
            </li>
          );
        })}
      </ol>
      <p className="perm-hint">
        In a real shell all the commands start at the same time and the data streams through as it is produced; stepping through stage by stage
        just makes the flow visible.
      </p>
    </div>
  );
}
