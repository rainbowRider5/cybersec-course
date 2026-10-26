import { useId, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import type { OrderingQuestion, Question } from '../course/types';
import { Markdown } from '../components/Markdown';
import { Terminal } from '../components/Terminal';
import { sameSet, shuffle, textMatches, typeLabel } from './grading';

export interface AnswerResult {
  correct: boolean;
  unsure: boolean;
}

interface Props {
  question: Question;
  number: number;
  total: number;
  onAnswer: (r: AnswerResult) => void;
  result: AnswerResult | null;
}

export function QuestionView({ question: q, number, total, onAnswer, result }: Props) {
  const headingId = useId();
  const answered = result !== null;

  return (
    <article className="card question-card" aria-labelledby={headingId}>
      <p className="question-type">
        Question {number} of {total} · {typeLabel(q)}
      </p>
      <div className="question-prompt" id={headingId}>
        <Markdown text={q.prompt} />
      </div>
      {q.exhibit && (
        <figure className="exhibit">
          {q.exhibit.label && <figcaption className="exhibit-label">{q.exhibit.label}</figcaption>}
          <pre tabIndex={0}>
            <code>{q.exhibit.text}</code>
          </pre>
        </figure>
      )}

      {(q.type === 'single' || (q.type === 'output' && q.options)) && (
        <SingleChoice
          key={q.id}
          options={q.options!}
          answer={q.type === 'single' ? q.answer : q.answer!}
          answered={answered}
          onAnswer={onAnswer}
        />
      )}
      {q.type === 'multi' && <MultiChoice key={q.id} options={q.options} answers={q.answers} answered={answered} onAnswer={onAnswer} />}
      {(q.type === 'text' || (q.type === 'output' && !q.options)) && (
        <ShortAnswer
          key={q.id}
          accepted={q.accepted ?? []}
          caseSensitive={q.caseSensitive}
          placeholder={q.type === 'text' ? q.placeholder : undefined}
          answered={answered}
          onAnswer={onAnswer}
        />
      )}
      {q.type === 'order' && <Ordering key={q.id} q={q} answered={answered} onAnswer={onAnswer} />}
      {q.type === 'terminal' && <TerminalAnswer key={q.id} q={q} answered={answered} onAnswer={onAnswer} />}

      {result && <Feedback q={q} result={result} />}
    </article>
  );
}

function Feedback({ q, result }: { q: Question; result: AnswerResult }) {
  const tone = result.unsure ? 'unsure' : result.correct ? 'right' : 'wrong';
  const title = result.unsure ? 'Added to your Review queue' : result.correct ? 'Correct' : 'Not quite';
  return (
    <div className={`feedback ${tone}`} role="status" aria-live="polite">
      <div className="feedback-title">{title}</div>
      {result.unsure && <p>Good call to flag it. Here is the explanation, and you will see this question again in Review.</p>}
      <Markdown text={q.explanation} />
    </div>
  );
}

function Actions({ onCheck, onUnsure, canCheck, answered }: { onCheck: () => void; onUnsure: () => void; canCheck: boolean; answered: boolean }) {
  if (answered) return null;
  return (
    <div className="question-actions">
      <button type="button" className="btn btn-primary" onClick={onCheck} disabled={!canCheck}>
        Check answer
      </button>
      <span className="spacer" />
      <button type="button" className="btn btn-quiet" onClick={onUnsure}>
        Not sure
      </button>
    </div>
  );
}

/* ---------------------------- single ------------------------------- */

function SingleChoice({ options, answer, answered, onAnswer }: { options: string[]; answer: number; answered: boolean; onAnswer: (r: AnswerResult) => void }) {
  const [picked, setPicked] = useState<number | null>(null);
  const name = useId();
  return (
    <>
      <fieldset className={`options-fieldset${answered ? ' locked-q' : ''}`} style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="visually-hidden">Choose one answer</legend>
        <ul className="options">
          {options.map((o, i) => {
            const cls = answered ? (i === answer ? 'correct' : i === picked ? 'incorrect' : '') : picked === i ? 'selected' : '';
            return (
              <li key={i} className={`option ${cls}`}>
                <label>
                  <input type="radio" name={name} checked={picked === i} disabled={answered} onChange={() => setPicked(i)} />
                  <span>
                    <Markdown text={o} inline />
                  </span>
                  <span className="option-mark">{answered && i === answer ? 'correct' : answered && i === picked ? 'your answer' : ''}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>
      <Actions
        answered={answered}
        canCheck={picked !== null}
        onCheck={() => onAnswer({ correct: picked === answer, unsure: false })}
        onUnsure={() => onAnswer({ correct: false, unsure: true })}
      />
    </>
  );
}

/* ---------------------------- multi -------------------------------- */

function MultiChoice({ options, answers, answered, onAnswer }: { options: string[]; answers: number[]; answered: boolean; onAnswer: (r: AnswerResult) => void }) {
  const [picked, setPicked] = useState<number[]>([]);
  const toggle = (i: number) => setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]));
  return (
    <>
      <fieldset className={answered ? 'locked-q' : ''} style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="visually-hidden">Select all answers that apply</legend>
        <ul className="options">
          {options.map((o, i) => {
            const isAns = answers.includes(i);
            const isPicked = picked.includes(i);
            const cls = answered ? (isAns ? 'correct' : isPicked ? 'incorrect' : '') : isPicked ? 'selected' : '';
            const mark = answered ? (isAns && isPicked ? 'correct' : isAns ? 'missed' : isPicked ? 'not this one' : '') : '';
            return (
              <li key={i} className={`option ${cls}`}>
                <label>
                  <input type="checkbox" checked={isPicked} disabled={answered} onChange={() => toggle(i)} />
                  <span>
                    <Markdown text={o} inline />
                  </span>
                  <span className="option-mark">{mark}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>
      <Actions
        answered={answered}
        canCheck={picked.length > 0}
        onCheck={() => onAnswer({ correct: sameSet(picked, answers), unsure: false })}
        onUnsure={() => onAnswer({ correct: false, unsure: true })}
      />
    </>
  );
}

/* ---------------------------- text --------------------------------- */

function ShortAnswer({
  accepted,
  caseSensitive,
  placeholder,
  answered,
  onAnswer,
}: {
  accepted: string[];
  caseSensitive?: boolean;
  placeholder?: string;
  answered: boolean;
  onAnswer: (r: AnswerResult) => void;
}) {
  const [value, setValue] = useState('');
  const id = useId();
  const correct = textMatches(value, accepted, caseSensitive);
  const check = () => value.trim() && onAnswer({ correct, unsure: false });
  return (
    <>
      <label htmlFor={id} className="visually-hidden">
        Your answer
      </label>
      <div className="text-answer">
        <input
          id={id}
          type="text"
          value={value}
          placeholder={placeholder ?? 'Type your answer'}
          disabled={answered}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && check()}
        />
      </div>
      {answered && (
        <p style={{ marginTop: '0.7rem', fontSize: '0.92rem' }}>
          {value.trim() ? (
            <>
              You answered <code>{value.trim()}</code>.{' '}
            </>
          ) : null}
          Accepted answer{accepted.length > 1 ? 's' : ''}: {accepted.map((a, i) => (
            <span key={a}>
              {i > 0 && ', '}
              <code>{a}</code>
            </span>
          ))}
        </p>
      )}
      <Actions answered={answered} canCheck={value.trim().length > 0} onCheck={check} onUnsure={() => onAnswer({ correct: false, unsure: true })} />
    </>
  );
}

/* ---------------------------- ordering ----------------------------- */

function Ordering({ q, answered, onAnswer }: { q: OrderingQuestion; answered: boolean; onAnswer: (r: AnswerResult) => void }) {
  const initial = useMemo(() => {
    let s = shuffle(q.items.map((_, i) => i));
    // never start in the solved order
    let guard = 0;
    while (s.every((v, i) => v === i) && guard++ < 10) s = shuffle(s);
    return s;
  }, [q]);
  const [order, setOrder] = useState<number[]>(initial);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [grabbed, setGrabbed] = useState<number | null>(null);
  const [announce, setAnnounce] = useState('');
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length || from === to) return;
    setOrder((o) => {
      const n = [...o];
      const [x] = n.splice(from, 1);
      n.splice(to, 0, x);
      return n;
    });
    setAnnounce(`${q.items[order[from]]} moved to position ${to + 1} of ${order.length}.`);
  };

  const onKey = (e: KeyboardEvent<HTMLLIElement>, pos: number) => {
    if (answered) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      setGrabbed((g) => (g === pos ? null : pos));
      setAnnounce(grabbed === pos ? 'Dropped.' : `Picked up ${q.items[order[pos]]}. Use the arrow keys to move it, Space to drop.`);
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const to = e.key === 'ArrowUp' ? pos - 1 : pos + 1;
      if (grabbed === pos) {
        move(pos, to);
        setGrabbed(to);
        requestAnimationFrame(() => itemRefs.current[to]?.focus());
      } else {
        itemRefs.current[Math.max(0, Math.min(order.length - 1, to))]?.focus();
      }
    }
  };

  const onDrop = (e: DragEvent, to: number) => {
    e.preventDefault();
    if (dragFrom !== null) move(dragFrom, to);
    setDragFrom(null);
    setDragOver(null);
  };

  return (
    <>
      <p className="visually-hidden" id={`${q.id}-howto`}>
        Focus an item, press Space to pick it up, use the up and down arrow keys to move it, and press Space again to drop it. Or use the Move up and
        Move down buttons.
      </p>
      <p style={{ fontSize: '0.88rem', color: 'var(--muted)', marginTop: 0 }} aria-hidden="true">
        Drag the items, or use the arrow buttons. Keyboard: focus an item, Space to pick up, ↑/↓ to move, Space to drop.
      </p>
      <ol className="order-list" aria-describedby={`${q.id}-howto`}>
        {order.map((itemIdx, pos) => {
          const state = answered ? (itemIdx === pos ? 'correct' : 'incorrect') : '';
          return (
            <li
              key={itemIdx}
              ref={(el) => {
                itemRefs.current[pos] = el;
              }}
              className={`order-item ${state} ${dragFrom === pos ? 'dragging' : ''} ${dragOver === pos && dragFrom !== pos ? 'drop-target' : ''} ${grabbed === pos ? 'grabbed' : ''}`}
              draggable={!answered}
              tabIndex={answered ? -1 : 0}
              aria-roledescription="sortable item"
              aria-label={`${pos + 1}. ${q.items[itemIdx]}${grabbed === pos ? ' (picked up)' : ''}`}
              onKeyDown={(e) => onKey(e, pos)}
              onDragStart={(e) => {
                setDragFrom(pos);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', String(pos));
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(pos);
              }}
              onDragLeave={() => setDragOver((d) => (d === pos ? null : d))}
              onDrop={(e) => onDrop(e, pos)}
              onDragEnd={() => {
                setDragFrom(null);
                setDragOver(null);
              }}
            >
              <span className="order-pos">{pos + 1}.</span>
              <span>
                <Markdown text={q.items[itemIdx]} inline />
                {answered && itemIdx !== pos && (
                  <span className="option-mark" style={{ marginLeft: '0.5rem', color: 'var(--bad)' }}>
                    belongs at {itemIdx + 1}
                  </span>
                )}
              </span>
              {!answered && (
                <span className="order-btns">
                  <button type="button" tabIndex={-1} aria-label={`Move ${q.items[itemIdx]} up`} disabled={pos === 0} onClick={() => move(pos, pos - 1)}>
                    ↑
                  </button>
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={`Move ${q.items[itemIdx]} down`}
                    disabled={pos === order.length - 1}
                    onClick={() => move(pos, pos + 1)}
                  >
                    ↓
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <p className="visually-hidden" aria-live="assertive">
        {announce}
      </p>
      {answered && (
        <div style={{ marginTop: '0.8rem', fontSize: '0.92rem' }}>
          <strong>Correct order:</strong>
          <ol style={{ marginTop: '0.3rem' }}>
            {q.items.map((it) => (
              <li key={it}>
                <Markdown text={it} inline />
              </li>
            ))}
          </ol>
        </div>
      )}
      <Actions
        answered={answered}
        canCheck
        onCheck={() => onAnswer({ correct: order.every((v, i) => v === i), unsure: false })}
        onUnsure={() => onAnswer({ correct: false, unsure: true })}
      />
    </>
  );
}

/* ---------------------------- terminal ----------------------------- */

function TerminalAnswer({ q, answered, onAnswer }: { q: Extract<Question, { type: 'terminal' }>; answered: boolean; onAnswer: (r: AnswerResult) => void }) {
  const [done, setDone] = useState(false);
  return (
    <>
      <Terminal title="Quiz terminal" scenario={q.scenario} tasks={[q.task]} onTaskComplete={() => setDone(true)} />
      {!answered && (
        <div className="question-actions">
          <button type="button" className="btn btn-primary" onClick={() => onAnswer({ correct: done, unsure: false })}>
            {done ? 'Task complete: continue' : 'Check task'}
          </button>
          <span className="spacer" />
          <button type="button" className="btn btn-quiet" onClick={() => onAnswer({ correct: false, unsure: true })}>
            Not sure
          </button>
        </div>
      )}
    </>
  );
}
