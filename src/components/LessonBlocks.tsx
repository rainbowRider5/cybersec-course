import type { Block } from '../course/types';
import { progress, useProgress } from '../progress/store';
import { Markdown } from './Markdown';
import { Terminal } from './Terminal';
import { VizFrame } from './VizFrame';

/** Renders the content blocks of one lesson section. */
export function LessonBlocks({ blocks, scope }: { blocks: Block[]; scope: string }) {
  const data = useProgress();
  return (
    <>
      {blocks.map((b, i) => {
        if (typeof b === 'string')
          return (
            <div className="prose" key={i}>
              <Markdown text={b} />
            </div>
          );
        switch (b.kind) {
          case 'viz': {
            const C = b.component;
            return (
              <VizFrame key={i} title={b.title} caption={b.caption}>
                <C />
              </VizFrame>
            );
          }
          case 'terminal': {
            const prefix = `${scope}/${b.title}`;
            const completed = Object.fromEntries(b.tasks.filter((t) => data.tasks[`${prefix}/${t.id}`]).map((t) => [t.id, true]));
            return (
              <Terminal
                key={i}
                title={b.title}
                scenario={b.scenario}
                tasks={b.tasks}
                intro={b.intro}
                tall={b.tall}
                completed={completed}
                onTaskComplete={(id) => progress.completeTask(`${prefix}/${id}`)}
              />
            );
          }
          case 'callout': {
            const label = b.tone === 'security' ? 'Security' : b.tone === 'warning' ? 'Careful' : 'Note';
            return (
              <aside key={i} className={`callout callout-${b.tone}`}>
                <div className="callout-title">
                  <span className="callout-tag">{label}</span>
                  {b.title && <span>{b.title}</span>}
                </div>
                <Markdown text={b.body} />
              </aside>
            );
          }
          case 'code':
            return (
              <figure key={i} className="code-block prose">
                <pre tabIndex={0}>
                  <code>{b.code}</code>
                </pre>
                {b.caption && (
                  <figcaption>
                    <Markdown text={b.caption} inline />
                  </figcaption>
                )}
              </figure>
            );
          case 'table':
            return (
              <div key={i} className="table-wrap">
                <table className="data">
                  {b.caption && (
                    <caption>
                      <Markdown text={b.caption} inline />
                    </caption>
                  )}
                  <thead>
                    <tr>
                      {b.head.map((h) => (
                        <th key={h} scope="col">
                          <Markdown text={h} inline />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, ri) => (
                      <tr key={ri}>
                        {r.map((c, ci) => (
                          <td key={ci}>
                            <Markdown text={c} inline />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </>
  );
}
