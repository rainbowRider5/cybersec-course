import type { ComponentType } from 'react';
import type { TerminalScenario, TerminalTask } from '../terminal/types';

/* ------------------------------------------------------------------ */
/* Lesson content                                                      */
/* ------------------------------------------------------------------ */

/**
 * A content block inside a lesson section.
 * - a plain string is rendered as lightweight Markdown (see components/Markdown.tsx)
 * - the object forms embed richer things
 */
export type Block =
  | string
  | { kind: 'viz'; component: ComponentType; title: string; caption?: string }
  | { kind: 'terminal'; title: string; scenario: TerminalScenario; tasks: TerminalTask[]; intro?: string; tall?: boolean }
  | { kind: 'callout'; tone: 'note' | 'warning' | 'security'; title?: string; body: string }
  | { kind: 'code'; code: string; caption?: string }
  | { kind: 'table'; head: string[]; rows: string[][]; caption?: string };

export interface Section {
  /** Stable id, used for anchors and for "go back to this section" links from quizzes. */
  id: string;
  title: string;
  blocks: Block[];
}

export interface Lesson {
  /** URL slug, unique within the module. */
  slug: string;
  title: string;
  /** One-sentence summary shown on the module page. */
  summary: string;
  estimatedMinutes: number;
  objectives: string[];
  /** Explanation sections. Rendered in order before the fixed sections below. */
  sections: Section[];
  /** "Why this matters for security" (Markdown). */
  security: string[];
  /** "Try it yourself" exercise for a real Linux VM / WSL. */
  tryIt: {
    intro: string;
    steps: { instruction: string; command?: string; note?: string }[];
  };
  quiz: Question[];
}

export interface GlossaryTerm {
  /** Lower-case id used in [[Display|id]] links. */
  id: string;
  term: string;
  definition: string;
  /** Lesson slug where it is introduced. */
  lesson: string;
  aliases?: string[];
}

export interface ModuleContent {
  lessons: Lesson[];
  glossary: GlossaryTerm[];
  finalTest: {
    questionCount: number;
    passMark: number;
    /** Questions that only appear in the final test (on top of the lesson question pools). */
    extraQuestions: { lesson: string; question: Question }[];
  };
}

export interface ModuleInfo {
  /** Display number, e.g. 1 */
  number: number;
  /** URL slug, e.g. "linux" */
  slug: string;
  title: string;
  description: string;
  /** Present only for released modules. Modules without content show as "Coming soon". */
  content?: ModuleContent;
}

/* ------------------------------------------------------------------ */
/* Questions                                                           */
/* ------------------------------------------------------------------ */

interface QuestionBase {
  /** Globally unique, e.g. "m1-l4-octal-754". Used as the key in the Review queue. */
  id: string;
  prompt: string;
  /** Shown after answering, right or wrong. Markdown. */
  explanation: string;
  /** Section id in the owning lesson, for "review this section" links. */
  section?: string;
  /** Optional exhibit shown above the prompt (command output, log lines, file contents). */
  exhibit?: { label?: string; text: string };
}

export interface SingleChoiceQuestion extends QuestionBase {
  type: 'single';
  options: string[];
  answer: number;
}

export interface MultipleChoiceQuestion extends QuestionBase {
  type: 'multi';
  options: string[];
  answers: number[];
}

export interface ShortAnswerQuestion extends QuestionBase {
  type: 'text';
  /** Accepted answers, compared after trimming and collapsing whitespace. */
  accepted: string[];
  caseSensitive?: boolean;
  placeholder?: string;
}

export interface OrderingQuestion extends QuestionBase {
  type: 'order';
  /** Items in the CORRECT order. They are shuffled for display. */
  items: string[];
}

export interface TerminalQuestion extends QuestionBase {
  type: 'terminal';
  scenario: TerminalScenario;
  task: TerminalTask;
}

/**
 * "Read this output": the exhibit is mandatory and the question is answered
 * either by picking an option or by typing a short answer.
 */
export interface OutputQuestion extends QuestionBase {
  type: 'output';
  exhibit: { label?: string; text: string };
  options?: string[];
  answer?: number;
  accepted?: string[];
  caseSensitive?: boolean;
}

export type Question =
  | SingleChoiceQuestion
  | MultipleChoiceQuestion
  | ShortAnswerQuestion
  | OrderingQuestion
  | TerminalQuestion
  | OutputQuestion;

/** A question together with where it lives in the course. */
export interface LocatedQuestion {
  question: Question;
  moduleSlug: string;
  /** Lesson slug, used as the "topic" in result breakdowns. */
  lessonSlug: string;
}
