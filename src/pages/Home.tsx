import { Link } from 'react-router-dom';
import { MODULES, lessonKey } from '../course/registry';
import type { ModuleInfo } from '../course/types';
import { useProgress, type ProgressData } from '../progress/store';

export function moduleProgress(m: ModuleInfo, data: ProgressData) {
  const lessons = m.content?.lessons ?? [];
  const passed = lessons.filter((l) => data.lessons[lessonKey(m.slug, l.slug)]?.passed).length;
  const testPassed = data.tests[m.slug]?.passed ?? false;
  // the final test counts as one more step
  const steps = lessons.length + (m.content ? 1 : 0);
  const pct = steps ? Math.round(((passed + (testPassed ? 1 : 0)) / steps) * 100) : 0;
  return { passed, total: lessons.length, testPassed, pct };
}

export function Home() {
  const data = useProgress();
  const released = MODULES.filter((m) => m.content);
  const reviewCount = Object.keys(data.review).length;

  return (
    <div className="page">
      <p className="eyebrow">Self-study course</p>
      <h1>Groundwork: job-ready security fundamentals</h1>
      <p className="lede">
        Eleven modules from core concepts to cloud, aimed at SOC analyst and Security+ level and beyond. Each lesson is a knowledge base with
        interactive diagrams, then a short quiz. Pass a lesson quiz with 80% to complete it. Anything you miss goes to your Review queue.
      </p>
      {reviewCount > 0 && (
        <p>
          <Link to="/review" className="btn">
            {reviewCount} question{reviewCount === 1 ? '' : 's'} waiting in Review
          </Link>
        </p>
      )}

      <div className="module-grid">
        {MODULES.map((m) => {
          if (!m.content) {
            return (
              <div key={m.slug} className="card module-card locked" aria-label={`Module ${m.number}: ${m.title}, coming soon`}>
                <span className="module-num">Module {String(m.number).padStart(2, '0')}</span>
                <h2>{m.title}</h2>
                <p>{m.description}</p>
                <div>
                  <span className="pill">Coming soon</span>
                </div>
              </div>
            );
          }
          const p = moduleProgress(m, data);
          return (
            <Link key={m.slug} to={`/m/${m.slug}`} className="card module-card">
              <span className="module-num">Module {String(m.number).padStart(2, '0')}</span>
              <h2>{m.title}</h2>
              <p>{m.description}</p>
              <div style={{ display: 'grid', gap: '0.4rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: 'var(--muted)' }}>
                  <span>
                    {p.passed}/{p.total} lessons{p.testPassed ? ' · test passed' : ''}
                  </span>
                  <span className="mono">{p.pct}%</span>
                </div>
                <div className="progress-bar" role="progressbar" aria-label={`${m.title} progress`} aria-valuenow={p.pct} aria-valuemin={0} aria-valuemax={100}>
                  <span style={{ width: `${p.pct}%` }} />
                </div>
              </div>
            </Link>
          );
        })}
      </div>
      <p style={{ marginTop: '2rem', color: 'var(--muted)', fontSize: '0.9rem' }}>
        {released.length} of {MODULES.length} modules available. New modules unlock as they are written.
      </p>
    </div>
  );
}
