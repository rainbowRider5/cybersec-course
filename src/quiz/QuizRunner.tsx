import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { LocatedQuestion } from '../course/types';
import { getModule } from '../course/registry';
import { progress } from '../progress/store';
import { Markdown } from '../components/Markdown';
import { sectionTitle } from '../course/sections';
import { QuestionView, type AnswerResult } from './QuestionView';

interface Props {
  title: string;
  questions: LocatedQuestion[];
  /** 0..1 */
  passMark: number;
  /** Called once with the percentage score when the learner reaches the results screen. */
  onFinish?: (scorePct: number) => void;
  /** Shown on the results screen. */
  doneLinks: { to: string; label: string; primary?: boolean }[];
  onRetry: () => void;
  /** Review mode hides the pass/fail verdict. */
  mode?: 'lesson' | 'final' | 'review';
}

export function QuizRunner({ title, questions, passMark, onFinish, doneLinks, onRetry, mode = 'lesson' }: Props) {
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<Record<string, AnswerResult>>({});
  const [finished, setFinished] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  const current = questions[index];
  const result = current ? results[current.question.id] ?? null : null;

  const answer = (r: AnswerResult) => {
    const { question, moduleSlug, lessonSlug } = current;
    setResults((rs) => ({ ...rs, [question.id]: r }));
    if (r.correct) progress.removeFromReview(question.id);
    else progress.addToReview(question.id, moduleSlug, lessonSlug, r.unsure ? 'unsure' : 'wrong');
    requestAnimationFrame(() => nextRef.current?.focus({ preventScroll: true }));
  };

  const next = () => {
    if (index + 1 < questions.length) {
      setIndex(index + 1);
      topRef.current?.scrollIntoView({ block: 'start' });
    } else {
      setFinished(true);
      const correct = questions.filter((q) => results[q.question.id]?.correct).length;
      onFinish?.(Math.round((correct / questions.length) * 100));
      window.scrollTo({ top: 0 });
    }
  };

  useEffect(() => {
    // focus the heading of each new question for screen-reader users
    topRef.current?.focus({ preventScroll: true });
  }, [index]);

  if (!questions.length) return <p>No questions here yet.</p>;

  if (finished) return <Results title={title} questions={questions} results={results} passMark={passMark} doneLinks={doneLinks} onRetry={onRetry} mode={mode} />;

  const answeredCount = Object.keys(results).length;
  return (
    <div className="quiz">
      <div className="quiz-progress" ref={topRef} tabIndex={-1} style={{ outline: 'none' }}>
        <span>{title}</span>
        <div className="progress-bar" role="progressbar" aria-label="Quiz progress" aria-valuemin={0} aria-valuemax={questions.length} aria-valuenow={answeredCount}>
          <span style={{ width: `${(answeredCount / questions.length) * 100}%` }} />
        </div>
        <span className="mono">
          {index + 1}/{questions.length}
        </span>
      </div>
      <QuestionView key={current.question.id} question={current.question} number={index + 1} total={questions.length} onAnswer={answer} result={result} />
      {result && (
        <div className="question-actions" style={{ justifyContent: 'flex-end' }}>
          <button ref={nextRef} type="button" className="btn btn-primary" onClick={next}>
            {index + 1 < questions.length ? 'Next question' : 'See results'}
          </button>
        </div>
      )}
    </div>
  );
}

function Results({
  title,
  questions,
  results,
  passMark,
  doneLinks,
  onRetry,
  mode,
}: {
  title: string;
  questions: LocatedQuestion[];
  results: Record<string, AnswerResult>;
  passMark: number;
  doneLinks: Props['doneLinks'];
  onRetry: () => void;
  mode: NonNullable<Props['mode']>;
}) {
  const correct = questions.filter((q) => results[q.question.id]?.correct).length;
  const pct = Math.round((correct / questions.length) * 100);
  const passed = pct >= passMark * 100;
  const missed = questions.filter((q) => !results[q.question.id]?.correct);

  // Per-topic breakdown: by lesson when the quiz spans several lessons, otherwise by lesson section.
  const lessonsInQuiz = new Set(questions.map((q) => `${q.moduleSlug}/${q.lessonSlug}`));
  const bySection = lessonsInQuiz.size === 1;
  const topics = new Map<string, { title: string; link: string; right: number; total: number }>();
  for (const q of questions) {
    const lesson = getModule(q.moduleSlug)?.content?.lessons.find((l) => l.slug === q.lessonSlug);
    const lessonLink = `/m/${q.moduleSlug}/l/${q.lessonSlug}`;
    const secTitle = bySection && lesson ? sectionTitle(lesson, q.question.section) : undefined;
    const key = bySection ? (secTitle ?? 'General') : `${q.moduleSlug}/${q.lessonSlug}`;
    const t = topics.get(key) ?? {
      title: bySection ? (secTitle ?? 'General') : (lesson?.title ?? q.lessonSlug),
      link: bySection && secTitle ? `${lessonLink}?s=${q.question.section}` : lessonLink,
      right: 0,
      total: 0,
    };
    t.total++;
    if (results[q.question.id]?.correct) t.right++;
    topics.set(key, t);
  }

  return (
    <div className="quiz">
      <div className="card results-head">
        <p className="eyebrow">{title} · results</p>
        <p className={`score-big ${mode === 'review' ? '' : passed ? 'pass' : 'fail'}`}>{pct}%</p>
        <p style={{ margin: 0 }}>
          {correct} of {questions.length} correct.{' '}
          {mode === 'review'
            ? 'Questions you got right have left the Review queue.'
            : passed
              ? mode === 'final'
                ? 'You passed the module test.'
                : 'Lesson complete.'
              : `The pass mark is ${Math.round(passMark * 100)}%. Review the sections below and try again.`}
        </p>
        <div className="controls" style={{ justifyContent: 'center', marginTop: '1.1rem' }}>
          {doneLinks.map((l) => (
            <Link key={l.to} to={l.to} className={`btn ${l.primary && (passed || mode === 'review') ? 'btn-primary' : ''}`}>
              {l.label}
            </Link>
          ))}
          <button type="button" className={`btn ${!passed && mode !== 'review' ? 'btn-primary' : ''}`} onClick={onRetry}>
            {mode === 'review' ? 'Review again' : 'Retake'}
          </button>
        </div>
      </div>

      {topics.size > 1 && (
        <section style={{ marginTop: '2rem' }}>
          <h2 style={{ fontSize: '1.2rem' }}>Score by {bySection ? 'section' : 'topic'}</h2>
          <table className="topic-table">
            <thead>
              <tr>
                <th scope="col">{bySection ? 'Section' : 'Topic'}</th>
                <th scope="col" className="topic-bar">
                  <span className="visually-hidden">Bar</span>
                </th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Score
                </th>
              </tr>
            </thead>
            <tbody>
              {[...topics.values()].map((t) => (
                <tr key={t.title}>
                  <td>
                    <Link to={t.link}>{t.title}</Link>
                  </td>
                  <td className="topic-bar">
                    <div className="progress-bar" aria-hidden="true">
                      <span style={{ width: `${(t.right / t.total) * 100}%`, background: t.right / t.total >= passMark ? 'var(--ok)' : 'var(--warn)' }} />
                    </div>
                  </td>
                  <td className="num">
                    {t.right}/{t.total}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {missed.length > 0 && (
        <section style={{ marginTop: '2rem' }}>
          <h2 style={{ fontSize: '1.2rem' }}>To revisit</h2>
          <p style={{ color: 'var(--muted)', fontSize: '0.93rem' }}>These are in your Review queue. Each link goes to the lesson section that covers it.</p>
          <ul className="missed-list">
            {missed.map((q) => {
              const lesson = getModule(q.moduleSlug)?.content?.lessons.find((l) => l.slug === q.lessonSlug);
              const secTitle = lesson ? sectionTitle(lesson, q.question.section) : undefined;
              const to = `/m/${q.moduleSlug}/l/${q.lessonSlug}${secTitle ? `?s=${q.question.section}` : ''}`;
              const r = results[q.question.id];
              return (
                <li key={q.question.id}>
                  <div style={{ fontSize: '0.95rem' }}>
                    <Markdown text={q.question.prompt.split('\n')[0]} inline />
                  </div>
                  <div style={{ fontSize: '0.85rem', marginTop: '0.25rem', display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <span className={`pill ${r?.unsure ? '' : 'pill-warn'}`}>{r?.unsure ? 'not sure' : 'missed'}</span>
                    <Link to={to}>
                      Review: {lesson?.title ?? q.lessonSlug}
                      {secTitle ? ` › ${secTitle}` : ''}
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
