/**
 * Content checks for every released module. Run with `npm run check`.
 *
 * - question ids are unique across the course
 * - answer indexes point at real options; ordering questions have at least 2 items
 * - every question's `section` exists in its lesson
 * - every [[glossary link]] in lesson text resolves to a glossary entry
 * - every terminal task is NOT already complete on a fresh system,
 *   and IS complete after running its `solution` commands in the simulator
 * - the final test can draw `questionCount` questions
 */
import { MODULES } from '../src/course/registry';
import type { Lesson, Question } from '../src/course/types';
import { createState, run } from '../src/terminal/shell';
import type { TerminalScenario, TerminalTask } from '../src/terminal/types';
import { FIXED_SECTIONS } from '../src/course/sections';

let problems = 0;
const problem = (msg: string) => {
  problems++;
  console.log('  ✗ ' + msg);
};

const ids = new Set<string>();
const sectionIds = (l: Lesson) => [...l.sections.map((s) => s.id), ...FIXED_SECTIONS.map((s) => s.id)];

function checkQuestion(q: Question, lesson: Lesson | undefined, where: string) {
  if (ids.has(q.id)) problem(`${where}: duplicate question id ${q.id}`);
  ids.add(q.id);
  if (q.section && lesson && !sectionIds(lesson).includes(q.section)) problem(`${where}: ${q.id} links to missing section "${q.section}"`);
  if (q.type === 'single' && (q.answer < 0 || q.answer >= q.options.length)) problem(`${where}: ${q.id} answer out of range`);
  if (q.type === 'multi' && (q.answers.length === 0 || q.answers.some((a) => a < 0 || a >= q.options.length))) problem(`${where}: ${q.id} answers out of range`);
  if (q.type === 'output') {
    if (q.options && (q.answer === undefined || q.answer < 0 || q.answer >= q.options.length)) problem(`${where}: ${q.id} answer out of range`);
    if (!q.options && !q.accepted?.length) problem(`${where}: ${q.id} needs options or accepted answers`);
  }
  if (q.type === 'text' && q.accepted.length === 0) problem(`${where}: ${q.id} has no accepted answers`);
  if (q.type === 'order' && q.items.length < 2) problem(`${where}: ${q.id} needs at least 2 items`);
  if (q.type === 'terminal') checkTasks(q.scenario, [q.task], `${where} ${q.id}`, false);
}

function checkTasks(scenario: TerminalScenario, tasks: TerminalTask[], where: string, sequential: boolean) {
  const shared = createState(scenario);
  for (const t of tasks) {
    if (t.check(createState(scenario))) problem(`${where}: task "${t.id}" is already complete on a fresh system`);
    if (!t.solution) {
      problem(`${where}: task "${t.id}" has no solution`);
      continue;
    }
    const s = sequential ? shared : createState(scenario);
    for (const cmd of t.solution) run(s, cmd);
    if (!t.check(s)) problem(`${where}: task "${t.id}" is not complete after its solution: ${t.solution.join(' ; ')}`);
  }
}

for (const m of MODULES) {
  if (!m.content) continue;
  console.log(`Module ${m.number}: ${m.title}`);
  const { lessons, glossary, finalTest } = m.content;
  const termKeys = new Set<string>();
  for (const t of glossary) [t.id, t.term, ...(t.aliases ?? [])].forEach((k) => termKeys.add(k.toLowerCase()));
  for (const t of glossary) if (!lessons.some((l) => l.slug === t.lesson)) problem(`glossary "${t.id}" points to unknown lesson ${t.lesson}`);

  let questions = 0;
  for (const l of lessons) {
    if (l.quiz.length < 6 || l.quiz.length > 11) problem(`${l.slug}: quiz has ${l.quiz.length} questions`);
    for (const q of l.quiz) checkQuestion(q, l, l.slug);
    questions += l.quiz.length;
    for (const sec of l.sections)
      for (const b of sec.blocks) {
        const text = typeof b === 'string' ? b : b.kind === 'callout' ? b.body : '';
        for (const match of text.replace(/```[\s\S]*?```/g, '').matchAll(/\[\[([^\]]+)\]\]/g)) {
          const id = match[1].includes('|') ? match[1].split('|')[1] : match[1];
          if (!termKeys.has(id.toLowerCase())) problem(`${l.slug}/${sec.id}: glossary link [[${match[1]}]] has no entry`);
        }
        if (typeof b !== 'string' && b.kind === 'terminal') checkTasks(b.scenario, b.tasks, `${l.slug}/${sec.id}`, true);
      }
  }
  for (const { lesson, question } of finalTest.extraQuestions) {
    const l = lessons.find((x) => x.slug === lesson);
    if (!l) problem(`final test: ${question.id} tagged with unknown lesson ${lesson}`);
    checkQuestion(question, l, 'final test');
  }
  const pool = questions + finalTest.extraQuestions.length;
  if (pool < finalTest.questionCount) problem(`final test needs ${finalTest.questionCount} questions but only ${pool} exist`);
  console.log(`  ${lessons.length} lessons, ${questions} lesson questions, ${finalTest.extraQuestions.length} final-only questions, ${glossary.length} glossary terms`);
}

// Lesson Markdown chunks are resolved when the modules are imported (chunks() throws on a missing
// one), so reaching this point also means every chunk of lesson text exists.

if (problems) {
  console.log(`\n${problems} problem(s) found.`);
  // no @types/node in this project; reach process through globalThis
  (globalThis as unknown as { process: { exit(code: number): never } }).process.exit(1);
}
console.log('\nAll content checks passed.');
