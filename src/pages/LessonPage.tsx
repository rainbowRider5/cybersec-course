import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { getModule, lessonKey } from '../course/registry';
import { FIXED_SECTIONS } from '../course/sections';
import { LessonBlocks } from '../components/LessonBlocks';
import { Markdown } from '../components/Markdown';
import { progress, useProgress } from '../progress/store';
import { NotFound } from './NotFound';

export function LessonPage() {
  const { moduleSlug, lessonSlug } = useParams();
  const mod = getModule(moduleSlug);
  const lessons = mod?.content?.lessons ?? [];
  const idx = lessons.findIndex((l) => l.slug === lessonSlug);
  const lesson = lessons[idx];
  const data = useProgress();
  const location = useLocation();
  const [active, setActive] = useState<string>('objectives');

  const key = mod && lesson ? lessonKey(mod.slug, lesson.slug) : '';
  useEffect(() => {
    if (key) progress.markVisited(key);
  }, [key]);

  // ?s=section-id scrolls to a section (used by quiz result links)
  useEffect(() => {
    const s = new URLSearchParams(location.search).get('s');
    if (!s) return;
    const t = window.setTimeout(() => {
      const el = document.getElementById(s);
      if (el) {
        el.scrollIntoView({ block: 'start' });
        el.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
      }
    }, 50);
    return () => window.clearTimeout(t);
  }, [location.search, lessonSlug]);

  // scroll-spy for the table of contents
  useEffect(() => {
    if (!lesson) return;
    let obs: IntersectionObserver;
    try {
      obs = new IntersectionObserver(
        (entries) => {
          const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
          if (visible[0]) setActive(visible[0].target.id);
        },
        { rootMargin: '-80px 0px -60% 0px' },
      );
    } catch {
      return;
    }
    document.querySelectorAll('.lesson-section, #objectives').forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [lesson]);

  if (!mod?.content || !lesson) return <NotFound />;
  const lp = data.lessons[key];
  const next = lessons[idx + 1];
  const toc = [{ id: 'objectives', title: 'Objectives' }, ...lesson.sections, ...FIXED_SECTIONS];

  // keyed by lesson so terminals and visualizations start fresh when you move between lessons
  return (
    <div className="lesson-layout" key={`${mod.slug}/${lesson.slug}`}>
      <article className="lesson-main">
        <nav className="breadcrumbs" aria-label="Breadcrumb">
          <Link to="/">Course</Link> <span aria-hidden="true">/</span> <Link to={`/m/${mod.slug}`}>{mod.title}</Link>{' '}
          <span aria-hidden="true">/</span> <span>Lesson {idx + 1}</span>
        </nav>
        <p className="eyebrow" style={{ marginTop: '1.2rem' }}>
          Lesson {idx + 1} of {lessons.length} · {lesson.estimatedMinutes} min{lp?.passed ? ' · completed' : ''}
        </p>
        <h1>{lesson.title}</h1>
        <p className="lede">{lesson.summary}</p>

        <section className="objectives" id="objectives" aria-labelledby="objectives-h">
          <h2 id="objectives-h">By the end of this lesson you can</h2>
          <ul>
            {lesson.objectives.map((o) => (
              <li key={o}>
                <Markdown text={o} inline />
              </li>
            ))}
          </ul>
        </section>

        {lesson.sections.map((s) => (
          <section key={s.id} id={s.id} className="lesson-section" aria-labelledby={`${s.id}-h`}>
            <h2 id={`${s.id}-h`} tabIndex={-1}>
              {s.title}
            </h2>
            <LessonBlocks blocks={s.blocks} scope={key} />
          </section>
        ))}

        <section id="security" className="lesson-section" aria-labelledby="security-h">
          <h2 id="security-h" tabIndex={-1}>
            Why this matters for security
          </h2>
          <div className="prose">
            {lesson.security.map((p, i) => (
              <Markdown key={i} text={p} />
            ))}
          </div>
        </section>

        <section id="try-it" className="lesson-section try-it" aria-labelledby="try-h">
          <h2 id="try-h" tabIndex={-1}>
            Try it yourself
          </h2>
          <div className="prose">
            <Markdown text={lesson.tryIt.intro} />
            <ol>
              {lesson.tryIt.steps.map((st, i) => (
                <li key={i}>
                  <Markdown text={st.instruction} inline />
                  {st.command && (
                    <pre tabIndex={0}>
                      <code>{st.command}</code>
                    </pre>
                  )}
                  {st.note && (
                    <div className="step-note">
                      <Markdown text={st.note} inline />
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </section>

        <div className="card lesson-end">
          <div>
            <strong>Ready for the lesson quiz?</strong>
            <div style={{ fontSize: '0.92rem', color: 'var(--muted)' }}>
              {lesson.quiz.length} questions · pass with 80% to complete this lesson
              {lp ? ` · your best so far: ${lp.best}%` : ''}
            </div>
          </div>
          <div className="controls">
            <Link className="btn btn-primary" to={`/m/${mod.slug}/l/${lesson.slug}/quiz`}>
              {lp?.passed ? 'Retake the quiz' : 'Take the quiz'}
            </Link>
            {next && (
              <Link className="btn" to={`/m/${mod.slug}/l/${next.slug}`}>
                Next: {next.title}
              </Link>
            )}
          </div>
        </div>
      </article>

      <nav className="lesson-toc" aria-label="On this page">
        <h2>On this page</h2>
        <ol>
          {toc.map((t) => (
            <li key={t.id}>
              <a
                href={`#${t.id}`}
                className={active === t.id ? 'active' : ''}
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById(t.id)?.scrollIntoView({ block: 'start' });
                  setActive(t.id);
                }}
              >
                {t.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
    </div>
  );
}
