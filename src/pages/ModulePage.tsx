import { Link, useParams } from 'react-router-dom';
import { getModule, lessonKey } from '../course/registry';
import { useGlossary } from '../components/Glossary';
import { useProgress } from '../progress/store';
import { moduleProgress } from './Home';
import { NotFound } from './NotFound';

export function ModulePage() {
  const { moduleSlug } = useParams();
  const mod = getModule(moduleSlug);
  const data = useProgress();
  const { open } = useGlossary();
  if (!mod?.content) return <NotFound />;
  const p = moduleProgress(mod, data);
  const test = data.tests[mod.slug];
  const reviewHere = Object.values(data.review).filter((r) => r.moduleSlug === mod.slug).length;
  const totalMinutes = mod.content.lessons.reduce((s, l) => s + l.estimatedMinutes, 0);

  return (
    <div className="page">
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link to="/">Course</Link> <span aria-hidden="true">/</span> <span>Module {mod.number}</span>
      </nav>
      <p className="eyebrow" style={{ marginTop: '1.2rem' }}>
        Module {String(mod.number).padStart(2, '0')}
      </p>
      <h1>{mod.title}</h1>
      <p className="lede">{mod.description}</p>
      <div className="controls" style={{ marginTop: '1rem' }}>
        <span className="pill">{mod.content.lessons.length} lessons</span>
        <span className="pill">about {Math.round(totalMinutes / 60)} hours</span>
        <span className={`pill ${p.pct === 100 ? 'pill-ok' : 'pill-accent'}`}>{p.pct}% complete</span>
        <button type="button" className="btn btn-small" onClick={() => open()}>
          Module glossary ({mod.content.glossary.length} terms)
        </button>
        {reviewHere > 0 && (
          <Link className="btn btn-small" to={`/review?m=${mod.slug}`}>
            Review {reviewHere} missed
          </Link>
        )}
      </div>

      <ol className="lesson-list">
        {mod.content.lessons.map((l, i) => {
          const lp = data.lessons[lessonKey(mod.slug, l.slug)];
          const visited = data.visited[lessonKey(mod.slug, l.slug)];
          return (
            <li key={l.slug} className="lesson-row">
              <span className={`lesson-index ${lp?.passed ? 'done' : ''}`} aria-hidden="true">
                {lp?.passed ? '✓' : i + 1}
              </span>
              <div>
                <h3>
                  <Link to={`/m/${mod.slug}/l/${l.slug}`}>
                    <span className="visually-hidden">Lesson {i + 1}: </span>
                    {l.title}
                  </Link>
                </h3>
                <p>{l.summary}</p>
                <p style={{ marginTop: '0.35rem', fontSize: '0.82rem' }}>
                  <span className="mono">{l.estimatedMinutes} min</span>
                  {lp && (
                    <>
                      {' · '}
                      {lp.passed ? <span style={{ color: 'var(--ok)' }}>completed</span> : 'quiz not passed yet'} · best {lp.best}%
                    </>
                  )}
                  {!lp && visited && ' · started'}
                </p>
              </div>
              <div className="lesson-actions">
                <Link className="btn btn-small" to={`/m/${mod.slug}/l/${l.slug}`}>
                  {visited ? 'Read again' : 'Start'}
                </Link>
                <Link className="btn btn-small" to={`/m/${mod.slug}/l/${l.slug}/quiz`}>
                  Quiz
                </Link>
              </div>
            </li>
          );
        })}
      </ol>

      <section className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ maxWidth: '60ch' }}>
          <h2 style={{ margin: '0 0 0.3rem', fontSize: '1.25rem' }}>Final module test</h2>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.95rem' }}>
            {mod.content.finalTest.questionCount} questions drawn from every lesson. Pass mark {Math.round(mod.content.finalTest.passMark * 100)}%.
            {p.passed < p.total && ' You can take it any time, but it is best after finishing all lessons.'}
          </p>
          {test && (
            <p style={{ margin: '0.4rem 0 0', fontSize: '0.88rem' }}>
              Best score <span className="mono">{test.best}%</span> · {test.passed ? <span style={{ color: 'var(--ok)' }}>passed</span> : 'not passed yet'}
            </p>
          )}
        </div>
        <Link className={`btn ${p.passed === p.total ? 'btn-primary' : ''}`} to={`/m/${mod.slug}/test`}>
          {test ? 'Retake the test' : 'Take the test'}
        </Link>
      </section>
    </div>
  );
}
