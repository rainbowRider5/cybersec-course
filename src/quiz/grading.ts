import type { LocatedQuestion, ModuleContent, Question } from '../course/types';

export function normalise(s: string, caseSensitive = false): string {
  const t = s.trim().replace(/\s+/g, ' ');
  return caseSensitive ? t : t.toLowerCase();
}

export function textMatches(answer: string, accepted: string[], caseSensitive = false): boolean {
  const a = normalise(answer, caseSensitive);
  return accepted.some((acc) => normalise(acc, caseSensitive) === a);
}

export function sameSet(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

export function typeLabel(q: Question): string {
  switch (q.type) {
    case 'single':
      return 'Single choice';
    case 'multi':
      return 'Select all that apply';
    case 'text':
      return 'Short answer';
    case 'order':
      return 'Put in order';
    case 'terminal':
      return 'Terminal task';
    case 'output':
      return 'Read the output';
  }
}

/** Fisher–Yates with an optional seeded RNG. */
export function shuffle<T>(arr: T[], rand: () => number = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Builds a final test: questions are drawn evenly from every lesson (lesson quiz + final-only
 * extras tagged with that lesson), then topped up at random to reach `questionCount`.
 */
export function buildFinalTest(moduleSlug: string, content: ModuleContent): LocatedQuestion[] {
  const { lessons, finalTest } = content;
  const pools = lessons.map((l) =>
    shuffle([
      ...l.quiz.map((q) => ({ question: q, moduleSlug, lessonSlug: l.slug })),
      ...finalTest.extraQuestions.filter((e) => e.lesson === l.slug).map((e) => ({ question: e.question, moduleSlug, lessonSlug: l.slug })),
    ]),
  );
  // Prefer the final-only extras a little, so the test is not just a replay of lesson quizzes.
  pools.forEach((p) => p.sort((a, b) => Number(isExtra(b, content)) - Number(isExtra(a, content))));
  const perLesson = Math.floor(finalTest.questionCount / lessons.length);
  const picked: LocatedQuestion[] = [];
  pools.forEach((p) => picked.push(...p.splice(0, perLesson)));
  const leftovers = shuffle(pools.flat());
  while (picked.length < finalTest.questionCount && leftovers.length) picked.push(leftovers.pop()!);
  return shuffle(picked);
}

function isExtra(q: LocatedQuestion, content: ModuleContent) {
  return content.finalTest.extraQuestions.some((e) => e.question.id === q.question.id);
}
