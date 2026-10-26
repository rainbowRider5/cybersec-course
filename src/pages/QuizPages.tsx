import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { MODULES, getModule, lessonKey, questionById } from '../course/registry';
import type { LocatedQuestion } from '../course/types';
import { buildFinalTest } from '../quiz/grading';
import { QuizRunner } from '../quiz/QuizRunner';
import { progress, useProgress } from '../progress/store';
import { NotFound } from './NotFound';

const LESSON_PASS = 0.8;

export function LessonQuizPage() {
  const { moduleSlug, lessonSlug } = useParams();
  const mod = getModule(moduleSlug);
  const lessons = mod?.content?.lessons ?? [];
  const idx = lessons.findIndex((l) => l.slug === lessonSlug);
  const lesson = lessons[idx];
  const [attempt, setAttempt] = useState(0);
  if (!mod || !lesson) return <NotFound />;
  const questions: LocatedQuestion[] = lesson.quiz.map((q) => ({ question: q, moduleSlug: mod.slug, lessonSlug: lesson.slug }));
  const next = lessons[idx + 1];

  return (
    <div className="page">
      <nav className="breadcrumbs" aria-label="Breadcrumb" style={{ maxWidth: 760, margin: '0 auto 1rem' }}>
        <Link to={`/m/${mod.slug}`}>{mod.title}</Link> <span aria-hidden="true">/</span>{' '}
        <Link to={`/m/${mod.slug}/l/${lesson.slug}`}>{lesson.title}</Link> <span aria-hidden="true">/</span> <span>Quiz</span>
      </nav>
      <QuizRunner
        key={`${mod.slug}/${lesson.slug}/${attempt}`}
        title={`Lesson ${idx + 1} quiz`}
        questions={questions}
        passMark={LESSON_PASS}
        onFinish={(pct) => progress.recordLessonAttempt(lessonKey(mod.slug, lesson.slug), pct, LESSON_PASS * 100)}
        onRetry={() => setAttempt((a) => a + 1)}
        doneLinks={[
          ...(next ? [{ to: `/m/${mod.slug}/l/${next.slug}`, label: `Next lesson: ${next.title}`, primary: true }] : [{ to: `/m/${mod.slug}/test`, label: 'Final module test', primary: true }]),
          { to: `/m/${mod.slug}/l/${lesson.slug}`, label: 'Back to the lesson' },
        ]}
      />
    </div>
  );
}

export function FinalTestPage() {
  const { moduleSlug } = useParams();
  const mod = getModule(moduleSlug);
  const data = useProgress();
  const [attempt, setAttempt] = useState(0);
  const [started, setStarted] = useState(false);
  const questions = useMemo(() => (mod?.content ? buildFinalTest(mod.slug, mod.content) : []), [mod, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!mod?.content) return <NotFound />;
  const { passMark, questionCount } = mod.content.finalTest;
  const best = data.tests[mod.slug];

  return (
    <div className="page">
      <nav className="breadcrumbs" aria-label="Breadcrumb" style={{ maxWidth: 760, margin: '0 auto 1rem' }}>
        <Link to="/">Course</Link> <span aria-hidden="true">/</span> <Link to={`/m/${mod.slug}`}>{mod.title}</Link> <span aria-hidden="true">/</span>{' '}
        <span>Final test</span>
      </nav>
      {!started ? (
        <div className="quiz">
          <div className="card" style={{ padding: '1.6rem' }}>
            <p className="eyebrow">Module {mod.number} · final test</p>
            <h1 style={{ fontSize: '1.8rem' }}>{mod.title}: final test</h1>
            <ul>
              <li>{questionCount} questions mixed from all {mod.content.lessons.length} lessons, in a new order each attempt.</li>
              <li>Pass mark: {Math.round(passMark * 100)}%.</li>
              <li>Feedback after every question. Missed and “Not sure” questions go to your Review queue.</li>
              <li>Some questions use the simulated terminal.</li>
            </ul>
            {best && (
              <p>
                Best score so far: <span className="mono">{best.best}%</span> {best.passed ? '(passed)' : ''}
              </p>
            )}
            <button type="button" className="btn btn-primary" onClick={() => setStarted(true)}>
              Start the test
            </button>
          </div>
        </div>
      ) : (
        <QuizRunner
          key={`${mod.slug}/${attempt}`}
          mode="final"
          title={`${mod.title} final test`}
          questions={questions}
          passMark={passMark}
          onFinish={(pct) => progress.recordTestAttempt(mod.slug, pct, passMark * 100)}
          onRetry={() => setAttempt((a) => a + 1)}
          doneLinks={[{ to: `/m/${mod.slug}`, label: 'Back to the module', primary: true }]}
        />
      )}
    </div>
  );
}

export function ReviewPage() {
  const data = useProgress();
  const [params] = useSearchParams();
  const filter = params.get('m');
  const [session, setSession] = useState<LocatedQuestion[] | null>(null);
  const [attempt, setAttempt] = useState(0);
  const index = questionById();

  const queued = Object.entries(data.review)
    .filter(([, r]) => !filter || r.moduleSlug === filter)
    .map(([id, r]) => ({ located: index.get(id), entry: r }))
    .filter((x): x is { located: LocatedQuestion; entry: (typeof data.review)[string] } => !!x.located);

  if (session) {
    return (
      <div className="page">
        <QuizRunner
          key={attempt}
          mode="review"
          title="Review"
          questions={session}
          passMark={0.8}
          onRetry={() => {
            // retake whatever is still in the queue
            const still = session.filter((q) => progress.get().review[q.question.id]);
            if (still.length) {
              setSession(still);
              setAttempt((a) => a + 1);
            } else setSession(null);
          }}
          doneLinks={[{ to: '/review', label: 'Back to Review' }]}
        />
        <p style={{ textAlign: 'center', marginTop: '1.5rem' }}>
          <button type="button" className="btn btn-quiet" onClick={() => setSession(null)}>
            Leave review
          </button>
        </p>
      </div>
    );
  }

  // group by module + lesson
  const groups = new Map<string, typeof queued>();
  for (const q of queued) {
    const k = `${q.located.moduleSlug}/${q.located.lessonSlug}`;
    groups.set(k, [...(groups.get(k) ?? []), q]);
  }

  return (
    <div className="page prose" style={{ maxWidth: 760 }}>
      <p className="eyebrow">Spaced practice</p>
      <h1>Review queue</h1>
      <p className="lede">
        Every question you miss or mark “Not sure” lands here. Answer it correctly and it leaves the queue. Short, frequent review beats one long
        cram.
      </p>
      {queued.length === 0 ? (
        <div className="card">
          <p style={{ margin: 0 }}>
            Nothing to review{filter ? ' in this module' : ''}. Missed questions from lesson quizzes and final tests will appear here.
          </p>
        </div>
      ) : (
        <>
          <div className="controls" style={{ margin: '1rem 0 1.5rem' }}>
            <button type="button" className="btn btn-primary" onClick={() => setSession(queued.map((q) => q.located).sort(() => Math.random() - 0.5))}>
              Review all {queued.length}
            </button>
            {filter && (
              <Link className="btn" to="/review">
                Show all modules
              </Link>
            )}
          </div>
          {[...groups.entries()].map(([k, items]) => {
            const [mSlug, lSlug] = k.split('/');
            const mod = MODULES.find((m) => m.slug === mSlug);
            const lesson = mod?.content?.lessons.find((l) => l.slug === lSlug);
            return (
              <section key={k} className="card" style={{ marginBottom: '0.8rem' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div className="eyebrow">{mod?.title}</div>
                    <h2 style={{ margin: '0.1rem 0', fontSize: '1.1rem' }}>{lesson?.title ?? lSlug}</h2>
                    <div style={{ fontSize: '0.88rem', color: 'var(--muted)' }}>
                      {items.length} question{items.length === 1 ? '' : 's'} ·{' '}
                      {items.filter((i) => i.entry.reason === 'unsure').length} marked not sure
                    </div>
                  </div>
                  <div className="controls">
                    <Link className="btn btn-small" to={`/m/${mSlug}/l/${lSlug}`}>
                      Reread lesson
                    </Link>
                    <button type="button" className="btn btn-small btn-primary" onClick={() => setSession(items.map((i) => i.located))}>
                      Review these
                    </button>
                  </div>
                </div>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
