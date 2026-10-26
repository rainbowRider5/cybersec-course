/** Sections every lesson has after its own content. Quiz questions may link to them too. */
export const FIXED_SECTIONS = [
  { id: 'security', title: 'Why this matters for security' },
  { id: 'try-it', title: 'Try it yourself' },
];

export function sectionTitle(lesson: { sections: { id: string; title: string }[] }, id?: string) {
  return [...lesson.sections, ...FIXED_SECTIONS].find((s) => s.id === id)?.title;
}
