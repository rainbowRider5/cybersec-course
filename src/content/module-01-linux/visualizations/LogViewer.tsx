import { useId, useMemo, useState } from 'react';
import { Markdown } from '../../../components/Markdown';
import { AUTH_LOG, type LogCategory } from '../data/authLog';

const RE = /^(\w{3} [ \d]\d \d\d:\d\d:\d\d) (\S+) ([^[:\s]+)(?:\[(\d+)\])?: (.*)$/;

const CATS: { id: LogCategory | 'all' | 'important'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'important', label: 'Notable' },
  { id: 'failed', label: 'Failed auth' },
  { id: 'invalid', label: 'Invalid user' },
  { id: 'success', label: 'Accepted' },
  { id: 'sudo', label: 'sudo' },
  { id: 'session', label: 'Sessions' },
  { id: 'account', label: 'Account changes' },
];

function parse(line: string) {
  const m = RE.exec(line);
  if (!m) return null;
  return { time: m[1], host: m[2], prog: m[3], pid: m[4], msg: m[5] };
}

/** Pulls extra fields out of common sshd / sudo messages. */
function details(msg: string): [string, string][] {
  const out: [string, string][] = [];
  const ssh = /(Failed|Accepted) (password|publickey) for (invalid user )?(\S+) from (\S+) port (\d+) (\S+)/.exec(msg);
  if (ssh) {
    out.push(['result', ssh[1]], ['method', ssh[2]], ['username', ssh[4] + (ssh[3] ? ' (does not exist)' : '')], ['source IP', ssh[5]], ['source port', ssh[6]], ['protocol', ssh[7].replace(/:$/, '')]);
    return out;
  }
  const inv = /Invalid user (\S+) from (\S+) port (\d+)/.exec(msg);
  if (inv) return [['username', `${inv[1]} (does not exist)`], ['source IP', inv[2]], ['source port', inv[3]]];
  if (/ : /.test(msg) && /COMMAND=/.test(msg)) {
    const [who, ...rest] = msg.split(' : ');
    out.push(['invoking user', who.trim()]);
    for (const part of rest.join(' : ').split(' ; ')) {
      const eq = part.indexOf('=');
      if (eq > 0) out.push([part.slice(0, eq).trim(), part.slice(eq + 1).trim()]);
      else out.push(['result', part.trim()]);
    }
  }
  const rhost = /rhost=(\S+)/.exec(msg);
  if (rhost) out.push(['remote host', rhost[1]]);
  return out;
}

export default function LogViewer() {
  const [cat, setCat] = useState<(typeof CATS)[number]['id']>('all');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<number | null>(13);
  const id = useId();

  const rows = useMemo(
    () =>
      AUTH_LOG.map((e, i) => ({ ...e, i, p: parse(e.line) })).filter((e) => {
        if (cat === 'important' && !e.important) return false;
        if (cat !== 'all' && cat !== 'important' && e.category !== cat) return false;
        if (q && !e.line.toLowerCase().includes(q.toLowerCase())) return false;
        return true;
      }),
    [cat, q],
  );

  const failedByIp = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of AUTH_LOG) {
      const x = /Failed password for .* from (\S+)/.exec(e.line);
      if (x) m.set(x[1], (m.get(x[1]) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, []);

  const selected = sel !== null ? AUTH_LOG[sel] : null;
  const sp = selected ? parse(selected.line) : null;

  return (
    <div className="log-viewer">
      <div className="log-filters">
        <div className="log-cats" role="group" aria-label="Filter by event type">
          {CATS.map((c) => (
            <button key={c.id} type="button" className={`btn btn-small${cat === c.id ? ' btn-primary' : ''}`} aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>
              {c.label}
            </button>
          ))}
        </div>
        <label htmlFor={`${id}-q`} className="visually-hidden">
          Search log lines
        </label>
        <input id={`${id}-q`} type="search" placeholder="grep… e.g. 203.0.113.45 or bob" value={q} onChange={(e) => setQ(e.target.value)} className="mono" />
      </div>
      <p className="log-file mono">
        /var/log/auth.log · {rows.length} of {AUTH_LOG.length} lines{' '}
        <span style={{ color: 'var(--muted)' }}>(click a line for its annotation)</span>
      </p>
      <ol className="log-lines" aria-label="Log lines">
        {rows.map((r) => (
          <li key={r.i}>
            <button type="button" className={`log-line cat-${r.category}${sel === r.i ? ' selected' : ''}${r.important ? ' important' : ''}`} onClick={() => setSel(r.i)} aria-pressed={sel === r.i}>
              {r.p ? (
                <>
                  <span className="lf-time">{r.p.time}</span> <span className="lf-host">{r.p.host}</span>{' '}
                  <span className="lf-prog">
                    {r.p.prog}
                    {r.p.pid ? `[${r.p.pid}]` : ''}:
                  </span>{' '}
                  <span className="lf-msg">{r.p.msg}</span>
                </>
              ) : (
                r.line
              )}
            </button>
          </li>
        ))}
        {rows.length === 0 && <li className="log-empty">No lines match. Try a different filter.</li>}
      </ol>

      {selected && sp && (
        <div className="explain-panel log-annotation" aria-live="polite">
          <h4>Line {sel! + 1}</h4>
          <dl className="log-fields">
            <div>
              <dt>timestamp</dt>
              <dd className="mono">{sp.time}</dd>
              <dd className="log-field-note">
                <Markdown text="Local time, with no year and no time zone in this classic syslog format. Newer rsyslog setups write ISO 8601, e.g. `2026-10-26T03:15:49.123+00:00`." inline />
              </dd>
            </div>
            <div>
              <dt>hostname</dt>
              <dd className="mono">{sp.host}</dd>
              <dd className="log-field-note">The machine that wrote the line. Matters once logs from many servers are collected in one place.</dd>
            </div>
            <div>
              <dt>program[PID]</dt>
              <dd className="mono">
                {sp.prog}
                {sp.pid ? `[${sp.pid}]` : ''}
              </dd>
              <dd className="log-field-note">Which program logged it, and that process’s ID. Lines with the same sshd PID belong to the same connection.</dd>
            </div>
            {details(sp.msg).map(([k, v]) => (
              <div key={k + v}>
                <dt>{k}</dt>
                <dd className="mono">{v}</dd>
              </div>
            ))}
          </dl>
          <Markdown text={selected.note} />
        </div>
      )}

      <div className="log-summary">
        <h4 style={{ margin: '0 0 0.3rem', fontFamily: 'var(--font-sans)' }}>Failed passwords by source IP</h4>
        <pre className="strace-line" style={{ margin: 0 }}>
          <code>
            {'$ grep "Failed password" /var/log/auth.log | awk \'{print $(NF-3)}\' | sort | uniq -c | sort -rn\n' +
              failedByIp.map(([ip, n]) => `${String(n).padStart(7)} ${ip}`).join('\n')}
          </code>
        </pre>
        <p className="perm-hint" style={{ marginTop: '0.4rem' }}>
          You will build this exact pipeline yourself in the shell lesson.
        </p>
      </div>
    </div>
  );
}
