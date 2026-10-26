import { useId, type ReactNode } from 'react';
import { Markdown } from './Markdown';

export function VizFrame({ title, caption, children }: { title: string; caption?: string; children: ReactNode }) {
  const id = useId();
  return (
    <figure className="viz" aria-labelledby={id} style={{ marginInline: 0 }}>
      <div className="viz-head">
        <p className="eyebrow">Interactive</p>
        <h3 id={id}>
          <Markdown text={title} inline />
        </h3>
      </div>
      <div className="viz-body">{children}</div>
      {caption && (
        <figcaption className="viz-caption">
          <Markdown text={caption} inline />
        </figcaption>
      )}
    </figure>
  );
}
