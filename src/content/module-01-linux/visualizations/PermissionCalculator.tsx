import { useId, useState } from 'react';
import { permString } from '../../../terminal/fs';

const CLASSES = [
  { key: 'u', label: 'Owner', shift: 6 },
  { key: 'g', label: 'Group', shift: 3 },
  { key: 'o', label: 'Others', shift: 0 },
] as const;
const BITS = [
  { ch: 'r', value: 4, label: 'read' },
  { ch: 'w', value: 2, label: 'write' },
  { ch: 'x', value: 1, label: 'execute' },
] as const;
const SPECIAL = [
  { value: 0o4000, label: 'SUID', hint: 'run as the file’s owner' },
  { value: 0o2000, label: 'SGID', hint: 'run as the file’s group / dirs: new files inherit the group' },
  { value: 0o1000, label: 'Sticky', hint: 'dirs: only an entry’s owner may delete it' },
] as const;

const PRESETS = [
  { mode: 0o644, label: '644', note: 'normal file' },
  { mode: 0o600, label: '600', note: 'private file' },
  { mode: 0o755, label: '755', note: 'program / dir' },
  { mode: 0o750, label: '750', note: 'team dir' },
  { mode: 0o754, label: '754', note: '' },
  { mode: 0o4755, label: '4755', note: '/usr/bin/passwd' },
  { mode: 0o1777, label: '1777', note: '/tmp' },
  { mode: 0o2775, label: '2775', note: 'shared dir' },
  { mode: 0o777, label: '777', note: 'never' },
];

interface Person {
  name: string;
  groups: string[];
}
const PEOPLE: Person[] = [
  { name: 'alice', groups: ['alice', 'developers'] },
  { name: 'bob', groups: ['bob', 'developers'] },
  { name: 'carol', groups: ['carol', 'finance'] },
  { name: 'www-data', groups: ['www-data'] },
  { name: 'root', groups: ['root'] },
];
const OWNERS = ['alice', 'bob', 'root', 'www-data'];
const GROUPS = ['developers', 'alice', 'finance', 'root', 'www-data'];

function parseSymbolic(input: string): number | null {
  let s = input.trim();
  if (s.length === 10) s = s.slice(1);
  if (!/^[r-][w-][xsS-][r-][w-][xsS-][r-][w-][xtT-]$/.test(s)) return null;
  let m = 0;
  const tri = (part: string, shift: number, special: number, sch: string) => {
    if (part[0] === 'r') m |= 4 << shift;
    if (part[1] === 'w') m |= 2 << shift;
    const x = part[2];
    if (x === 'x' || x === sch) m |= 1 << shift;
    if (x === sch || x === sch.toUpperCase()) m |= special;
  };
  tri(s.slice(0, 3), 6, 0o4000, 's');
  tri(s.slice(3, 6), 3, 0o2000, 's');
  tri(s.slice(6, 9), 0, 0o1000, 't');
  return m;
}

const toOctal = (m: number) => (m & 0o7000 ? m.toString(8).padStart(4, '0') : (m & 0o777).toString(8).padStart(3, '0'));

function symbolicChmod(m: number): string {
  const part = (shift: number) => {
    const b = (m >> shift) & 7;
    return (b & 4 ? 'r' : '') + (b & 2 ? 'w' : '') + (b & 1 ? 'x' : '');
  };
  let u = part(6);
  let g = part(3);
  let o = part(0);
  if (m & 0o4000) u += 's';
  if (m & 0o2000) g += 's';
  if (m & 0o1000) o += 't';
  return `u=${u},g=${g},o=${o}`;
}

export default function PermissionCalculator() {
  const [mode, setMode] = useState(0o754);
  const [isDir, setIsDir] = useState(false);
  const [octalText, setOctalText] = useState<string | null>(null);
  const [symText, setSymText] = useState<string | null>(null);
  const [owner, setOwner] = useState('alice');
  const [group, setGroup] = useState('developers');
  const id = useId();

  const typeChar = isDir ? 'd' : '-';
  const symbolic = typeChar + permString(mode);
  const octalShown = octalText ?? toOctal(mode);
  const symShown = symText ?? symbolic;

  const set = (m: number) => {
    setMode(m);
    setOctalText(null);
    setSymText(null);
  };
  const toggleBit = (bit: number) => set(mode ^ bit);

  const onOctal = (v: string) => {
    setOctalText(v);
    if (/^[0-7]{3,4}$/.test(v)) {
      setMode(parseInt(v, 8));
      setSymText(null);
    }
  };
  const onSym = (v: string) => {
    setSymText(v);
    const m = parseSymbolic(v);
    if (m !== null) {
      setMode(m);
      setOctalText(null);
      if (v.trim().length === 10) setIsDir(v.trim()[0] === 'd');
    }
  };
  const octalValid = /^[0-7]{3,4}$/.test(octalShown);
  const symValid = parseSymbolic(symShown) !== null;
  const name = isDir ? 'shared/' : 'report.sh';

  const warnings: string[] = [];
  if (mode & 0o002) {
    if (isDir && mode & 0o1000) warnings.push('World-writable directory, but the sticky bit is set: users can add files but not delete other people’s. This is how /tmp works.');
    else if (isDir) warnings.push('World-writable directory without the sticky bit: anyone can delete or replace anyone’s files in it.');
    else warnings.push('World-writable file: any user on the system can change its contents. If root ever runs it, that is a privilege-escalation path.');
  }
  if (mode & 0o4000 && !isDir) warnings.push('SUID: whoever runs this program gets the file owner’s privileges while it runs. With owner root, any bug in it is a root bug. Only a short, known list of binaries should have this.');
  if (mode & 0o4000 && !(mode & 0o100)) warnings.push('Capital S: SUID is set but the owner has no execute bit, so it has no useful effect. Usually a mistake.');
  if (mode & 0o2000 && isDir) warnings.push('SGID on a directory: new files created inside inherit the directory’s group, which is handy for team folders.');
  if (mode & 0o1000 && !isDir) warnings.push('The sticky bit on a regular file is ignored by Linux. It only matters on directories.');

  return (
    <div className="perm-calc">
      <div className="perm-top">
        <div className="segmented" role="group" aria-label="File type">
          <button type="button" aria-pressed={!isDir} onClick={() => setIsDir(false)}>
            File
          </button>
          <button type="button" aria-pressed={isDir} onClick={() => setIsDir(true)}>
            Directory
          </button>
        </div>
        <div className="perm-presets" role="group" aria-label="Presets">
          {PRESETS.map((p) => (
            <button key={p.label} type="button" className={`btn btn-small${mode === p.mode ? ' btn-primary' : ''}`} onClick={() => set(p.mode)} title={p.note}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="perm-grid-wrap">
        <table className="perm-grid">
          <caption className="visually-hidden">Permission bits. Toggle a checkbox to change the mode.</caption>
          <thead>
            <tr>
              <th scope="col">Class</th>
              {BITS.map((b) => (
                <th key={b.ch} scope="col">
                  <span className="mono">{b.ch}</span> <span className="perm-bitval">({b.value})</span>
                </th>
              ))}
              <th scope="col">Digit</th>
            </tr>
          </thead>
          <tbody>
            {CLASSES.map((c) => {
              const digit = (mode >> c.shift) & 7;
              const parts = BITS.filter((b) => digit & b.value).map((b) => b.value);
              return (
                <tr key={c.key}>
                  <th scope="row">
                    {c.label} <span className="mono perm-bitval">({c.key})</span>
                  </th>
                  {BITS.map((b) => {
                    const bit = b.value << c.shift;
                    return (
                      <td key={b.ch}>
                        <label className="perm-cell">
                          <input type="checkbox" checked={(mode & bit) !== 0} onChange={() => toggleBit(bit)} />
                          <span className="visually-hidden">
                            {c.label} {b.label}
                          </span>
                        </label>
                      </td>
                    );
                  })}
                  <td className="perm-digit mono">
                    <strong>{digit}</strong>
                    <span className="perm-sum">{parts.length ? ` = ${parts.join('+')}` : ' = 0'}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <fieldset className="perm-special">
          <legend>Special bits (the optional 4th, leading digit)</legend>
          {SPECIAL.map((sp) => (
            <label key={sp.label}>
              <input type="checkbox" checked={(mode & sp.value) !== 0} onChange={() => toggleBit(sp.value)} />
              <span>
                <strong>{sp.label}</strong> <span className="mono">({sp.value.toString(8)[0]})</span> <span className="perm-hint">{sp.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </div>

      <div className="perm-outputs">
        <div>
          <label htmlFor={`${id}-oct`}>Octal</label>
          <input
            id={`${id}-oct`}
            type="text"
            inputMode="numeric"
            className={`mono perm-input${octalValid ? '' : ' invalid'}`}
            value={octalShown}
            onChange={(e) => onOctal(e.target.value)}
            onBlur={() => setOctalText(null)}
            aria-invalid={!octalValid}
            aria-describedby={`${id}-oct-help`}
          />
          <span id={`${id}-oct-help`} className="perm-help">
            {octalValid ? '3 or 4 digits, 0–7' : 'Use 3 or 4 digits from 0 to 7'}
          </span>
        </div>
        <div>
          <label htmlFor={`${id}-sym`}>Symbolic (as in ls -l)</label>
          <input
            id={`${id}-sym`}
            type="text"
            className={`mono perm-input${symValid ? '' : ' invalid'}`}
            value={symShown}
            onChange={(e) => onSym(e.target.value)}
            onBlur={() => setSymText(null)}
            aria-invalid={!symValid}
            spellCheck={false}
            aria-describedby={`${id}-sym-help`}
          />
          <span id={`${id}-sym-help`} className="perm-help">
            {symValid ? 'Type e.g. -rwxr-x--- or rwsr-xr-x' : 'Format: [type] then rwx for owner, group, others'}
          </span>
        </div>
      </div>

      <pre className="strace-line" aria-label="Equivalent commands">
        <code>
          {`$ chmod ${toOctal(mode)} ${name}\n$ chmod ${symbolicChmod(mode)} ${name}   # same thing, symbolic form\n$ ls -l${isDir ? 'd' : ''} ${name}\n${symbolic} ${isDir ? 2 : 1} ${owner} ${group} ${isDir ? 4096 : 412} Oct 26 09:12 ${name}`}
        </code>
      </pre>

      {warnings.length > 0 && (
        <ul className="perm-warnings">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      <h4 style={{ marginTop: '1.4rem' }}>Who can do what?</h4>
      <div className="controls" style={{ marginBottom: '0.6rem' }}>
        <label>
          Owner{' '}
          <select value={owner} onChange={(e) => setOwner(e.target.value)}>
            {OWNERS.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </label>
        <label>
          Group{' '}
          <select value={group} onChange={(e) => setGroup(e.target.value)}>
            {GROUPS.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </label>
      </div>
      <WhoTable mode={mode} isDir={isDir} owner={owner} group={group} />
    </div>
  );
}

function WhoTable({ mode, isDir, owner, group }: { mode: number; isDir: boolean; owner: string; group: string }) {
  const verbs = isDir ? ['List names (r)', 'Create / delete entries (w+x)', 'Enter / traverse (x)'] : ['Read (r)', 'Write (w)', 'Execute (x)'];
  return (
    <div className="table-wrap">
      <table className="data who-table">
        <thead>
          <tr>
            <th scope="col">User (groups)</th>
            <th scope="col">Class that applies</th>
            {verbs.map((v) => (
              <th key={v} scope="col">
                {v}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PEOPLE.map((p) => {
            const isRoot = p.name === 'root';
            let cls: 'owner' | 'group' | 'others';
            let bits: number;
            if (p.name === owner) {
              cls = 'owner';
              bits = (mode >> 6) & 7;
            } else if (p.groups.includes(group)) {
              cls = 'group';
              bits = (mode >> 3) & 7;
            } else {
              cls = 'others';
              bits = mode & 7;
            }
            const r = isRoot || (bits & 4) !== 0;
            const x = isRoot ? isDir || (mode & 0o111) !== 0 : (bits & 1) !== 0;
            const w = isRoot || (isDir ? (bits & 2) !== 0 && (bits & 1) !== 0 : (bits & 2) !== 0);
            const lessThanOthers = !isRoot && cls === 'owner' && (((mode >> 3) & 7) & ~bits || (mode & 7) & ~bits);
            return (
              <tr key={p.name}>
                <th scope="row" className="mono" style={{ fontWeight: 500 }}>
                  {p.name} <span className="perm-hint">({p.groups.join(', ')})</span>
                </th>
                <td>
                  {isRoot ? 'root: bypasses read/write checks' : cls}
                  {lessThanOthers ? <div className="perm-hint">Owner class only: no fall-through to group or others, even if they have more.</div> : null}
                </td>
                <Cell ok={r} />
                <Cell ok={w} />
                <Cell ok={x} note={isRoot && !isDir && !x ? 'no x bit set anywhere' : undefined} />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Cell({ ok, note }: { ok: boolean; note?: string }) {
  return (
    <td className={ok ? 'yes' : 'no'}>
      <span aria-hidden="true">{ok ? '✓' : '✕'}</span>
      <span className="visually-hidden">{ok ? 'allowed' : 'denied'}</span>
      {note && <div className="perm-hint">{note}</div>}
    </td>
  );
}
