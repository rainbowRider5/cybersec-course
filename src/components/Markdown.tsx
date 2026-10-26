import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { findTerm } from '../course/registry';
import { useGlossary } from './Glossary';

/**
 * A deliberately small Markdown renderer for lesson text.
 *
 * Blocks: paragraphs, ### headings, - bullet lists, 1. numbered lists, ``` code fences,
 *         | tables |, and > quotes. A quote starting with [!note], [!warning] or [!security]
 *         (optionally followed by a title) renders as a callout box.
 * Inline: `code`, **bold**, *italic*, [link](url), and glossary links:
 *   [[SUID]]            -> term "suid", displayed as "SUID"
 *   [[set-user-ID|suid]] -> displayed text, then term id
 */
export function Markdown({ text, inline = false }: { text: string; inline?: boolean }) {
  if (inline) return <>{renderInline(text)}</>;
  return <>{parseBlocks(text)}</>;
}

function parseBlocks(src: string): ReactNode[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith('```')) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++]);
      i++;
      out.push(
        <pre key={key++}>
          <code>{body.join('\n')}</code>
        </pre>,
      );
      continue;
    }
    if (line.startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        const cells = splitRow(lines[i].trim().replace(/^\|/, '').replace(/\|$/, ''));
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      out.push(
        <div className="table-wrap" key={key++}>
          <table className="data">
            <thead>
              <tr>
                {head.map((h, j) => (
                  <th key={j} scope="col">
                    {renderInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td key={ci}>{renderInline(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (line.startsWith('>')) {
      const body: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) body.push(lines[i++].replace(/^>\s?/, ''));
      const m = /^\[!(note|warning|security)\]\s*(.*)$/.exec(body[0] ?? '');
      const tone = m ? m[1] : 'note';
      const title = m ? m[2] : '';
      const text = (m ? body.slice(1) : body).join('\n');
      const label = tone === 'security' ? 'Security' : tone === 'warning' ? 'Careful' : 'Note';
      out.push(
        <aside key={key++} className={`callout callout-${tone}`}>
          <div className="callout-title">
            <span className="callout-tag">{label}</span>
            {title && <span>{renderInline(title)}</span>}
          </div>
          {parseBlocks(text)}
        </aside>,
      );
      continue;
    }
    const h = /^(#{3,4})\s+(.*)$/.exec(line);
    if (h) {
      const Tag = h[1].length === 3 ? 'h3' : 'h4';
      out.push(<Tag key={key++}>{renderInline(h[2])}</Tag>);
      i++;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && (ordered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/).test(lines[i])) {
        let item = lines[i].replace(ordered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/, '');
        i++;
        // continuation lines (indented)
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s+/.test(lines[i])) item += ' ' + lines[i++].trim();
        items.push(item);
      }
      const children = items.map((it, j) => <li key={j}>{renderInline(it)}</li>);
      out.push(ordered ? <ol key={key++}>{children}</ol> : <ul key={key++}>{children}</ul>);
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].startsWith('```') &&
      !lines[i].startsWith('|') &&
      !lines[i].startsWith('>') &&
      !/^#{3,4}\s/.test(lines[i]) &&
      !/^\s*([-*]|\d+\.)\s+/.test(lines[i])
    ) {
      para.push(lines[i++]);
    }
    out.push(<p key={key++}>{renderInline(para.join(' '))}</p>);
  }
  return out;
}

/** Splits a table row on | but not inside `code`, [[term|links]] or after a backslash. */
function splitRow(row: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inCode = false;
  let inTerm = false;
  for (let i = 0; i < row.length; i++) {
    const c = row[i];
    if (c === '\\' && row[i + 1] === '|') {
      cur += '|';
      i++;
      continue;
    }
    if (c === '`') inCode = !inCode;
    if (!inCode && row.startsWith('[[', i)) inTerm = true;
    if (!inCode && row.startsWith(']]', i)) inTerm = false;
    if (c === '|' && !inCode && !inTerm) {
      cells.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

const INLINE = /(`[^`]+`)|(\[\[[^\]]+\]\])|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\([^)]+\))/g;

function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(INLINE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(<Fragment key={k++}>{text.slice(last, idx)}</Fragment>);
    const tok = m[0];
    if (m[1]) out.push(<code key={k++}>{tok.slice(1, -1)}</code>);
    else if (m[2]) {
      const inner = tok.slice(2, -2);
      const [shown, id] = inner.includes('|') ? inner.split('|') : [inner, inner];
      out.push(<TermLink key={k++} id={id} label={shown} />);
    } else if (m[3]) out.push(<strong key={k++}>{renderInline(tok.slice(2, -2))}</strong>);
    else if (m[4]) out.push(<em key={k++}>{renderInline(tok.slice(1, -1))}</em>);
    else if (m[5]) {
      const lm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok)!;
      const href = lm[2];
      if (href.startsWith('/')) out.push(<Link key={k++} to={href}>{lm[1]}</Link>);
      else out.push(<a key={k++} href={href} target="_blank" rel="noreferrer">{lm[1]}</a>);
    }
    last = idx + tok.length;
  }
  if (last < text.length) out.push(<Fragment key={k++}>{text.slice(last)}</Fragment>);
  return out;
}

function TermLink({ id, label }: { id: string; label: string }) {
  const { open } = useGlossary();
  const term = findTerm(id);
  if (!term) {
    if (import.meta.env.DEV) console.warn(`Glossary term not found: ${id}`);
    return <>{label}</>;
  }
  return (
    <button type="button" className="term-link" title={`${term.term}: ${term.definition}`} onClick={() => open(term.id)}>
      {label}
    </button>
  );
}
