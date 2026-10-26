import { useSyncExternalStore } from 'react';

/**
 * Learner progress, persisted in localStorage.
 * Every storage access is wrapped in try/catch: in private windows or with storage blocked
 * the app keeps working with in-memory progress for the current visit.
 */

const KEY = 'groundwork-progress-v1';

export interface LessonProgress {
  passed: boolean;
  best: number;
  attempts: number;
  lastAt: string;
}

export interface TestProgress {
  passed: boolean;
  best: number;
  attempts: number;
  lastAt: string;
}

export interface ReviewEntry {
  moduleSlug: string;
  lessonSlug: string;
  reason: 'wrong' | 'unsure';
  addedAt: string;
  misses: number;
}

export interface ProgressData {
  version: 1;
  /** key: "moduleSlug/lessonSlug" */
  lessons: Record<string, LessonProgress>;
  /** key: moduleSlug */
  tests: Record<string, TestProgress>;
  /** key: question id */
  review: Record<string, ReviewEntry>;
  /** key: "scopeId/taskId" for terminal tasks completed inside lessons */
  tasks: Record<string, true>;
  /** key: "moduleSlug/lessonSlug": lesson pages opened at least once */
  visited: Record<string, true>;
}

const empty = (): ProgressData => ({ version: 1, lessons: {}, tests: {}, review: {}, tasks: {}, visited: {} });

function load(): ProgressData {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as Partial<ProgressData>;
    if (parsed.version !== 1) return empty();
    return { ...empty(), ...parsed } as ProgressData;
  } catch {
    return empty();
  }
}

function probeStorage(): boolean {
  try {
    const k = `${KEY}-probe`;
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

let data: ProgressData = load();
let storageOk = probeStorage();
const listeners = new Set<() => void>();

function save() {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(data));
    storageOk = true;
  } catch {
    storageOk = false;
  }
}

function update(fn: (d: ProgressData) => void) {
  const next = structuredClone(data);
  fn(next);
  data = next;
  save();
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

// Keep tabs in sync.
try {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) {
      data = load();
      listeners.forEach((l) => l());
    }
  });
} catch {
  /* no window */
}

export function useProgress(): ProgressData {
  return useSyncExternalStore(subscribe, () => data, () => data);
}

export function isStorageAvailable(): boolean {
  return storageOk;
}

const now = () => new Date().toISOString();

export const progress = {
  get: () => data,

  recordLessonAttempt(key: string, scorePct: number, passMark: number) {
    update((d) => {
      const prev = d.lessons[key];
      d.lessons[key] = {
        passed: (prev?.passed ?? false) || scorePct >= passMark,
        best: Math.max(prev?.best ?? 0, scorePct),
        attempts: (prev?.attempts ?? 0) + 1,
        lastAt: now(),
      };
    });
  },

  recordTestAttempt(moduleSlug: string, scorePct: number, passMark: number) {
    update((d) => {
      const prev = d.tests[moduleSlug];
      d.tests[moduleSlug] = {
        passed: (prev?.passed ?? false) || scorePct >= passMark,
        best: Math.max(prev?.best ?? 0, scorePct),
        attempts: (prev?.attempts ?? 0) + 1,
        lastAt: now(),
      };
    });
  },

  /** A wrong or "not sure" answer puts the question in the Review queue. */
  addToReview(questionId: string, moduleSlug: string, lessonSlug: string, reason: 'wrong' | 'unsure') {
    update((d) => {
      const prev = d.review[questionId];
      d.review[questionId] = {
        moduleSlug,
        lessonSlug,
        reason,
        addedAt: prev?.addedAt ?? now(),
        misses: (prev?.misses ?? 0) + 1,
      };
    });
  },

  /** A correct answer takes the question out of the Review queue. */
  removeFromReview(questionId: string) {
    if (!data.review[questionId]) return;
    update((d) => {
      delete d.review[questionId];
    });
  },

  completeTask(key: string) {
    if (data.tasks[key]) return;
    update((d) => {
      d.tasks[key] = true;
    });
  },

  markVisited(key: string) {
    if (data.visited[key]) return;
    update((d) => {
      d.visited[key] = true;
    });
  },

  resetAll() {
    update((d) => Object.assign(d, empty()));
  },
};
