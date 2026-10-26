import { useState } from 'react';
import { GlossaryList } from '../components/Glossary';

export function GlossaryPage() {
  const [q, setQ] = useState('');
  return (
    <div className="page prose" style={{ maxWidth: 760 }}>
      <p className="eyebrow">Reference</p>
      <h1>Glossary</h1>
      <p className="lede">Every term introduced in the released modules.</p>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search terms and definitions" aria-label="Search the glossary" style={{ width: '100%', margin: '0.5rem 0 1rem' }} />
      <GlossaryList query={q} />
    </div>
  );
}
