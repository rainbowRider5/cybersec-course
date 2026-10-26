import type { GlossaryTerm, LocatedQuestion, ModuleInfo } from './types';
import linux from '../content/module-01-linux';

/**
 * THE place where modules are registered.
 *
 * To release a module: create its folder under src/content/, import its default export
 * above, and set `content` on its entry below. Everything else (home page, module page,
 * lessons, quizzes, final test, review queue, glossary) picks it up automatically.
 */
export const MODULES: ModuleInfo[] = [
  {
    number: 0,
    slug: 'core-concepts',
    title: 'Core Concepts',
    description: 'The CIA triad, risk, threat actors, authentication, and the vocabulary the rest of the course builds on.',
  },
  {
    number: 1,
    slug: 'linux',
    title: 'Linux in Depth',
    description: 'How Linux really works: kernel, boot, filesystem, permissions, processes, logs, the shell, and defensive hardening.',
    content: linux,
  },
  {
    number: 2,
    slug: 'networking',
    title: 'Networking for Security',
    description: 'OSI and TCP/IP in practice, ports and protocols, packet captures, firewalls, and what normal versus suspicious traffic looks like.',
  },
  {
    number: 3,
    slug: 'windows',
    title: 'Windows Essentials',
    description: 'Processes, services, the registry, event logs, PowerShell, and Windows permissions from a defender’s point of view.',
  },
  {
    number: 4,
    slug: 'cryptography',
    title: 'Cryptography',
    description: 'Symmetric and asymmetric crypto, hashing, signatures, PKI and TLS, and the classic ways crypto gets misused.',
  },
  {
    number: 5,
    slug: 'web-security',
    title: 'Web Security & OWASP Top 10',
    description: 'HTTP, sessions and cookies, and the most common web vulnerability classes with their defenses.',
  },
  {
    number: 6,
    slug: 'identity',
    title: 'Identity & Active Directory',
    description: 'Authentication protocols, Kerberos, Active Directory structure, and identity-based attacks to detect.',
  },
  {
    number: 7,
    slug: 'threats',
    title: 'Threats & MITRE ATT&CK',
    description: 'Malware families, attacker lifecycle, and mapping behavior to ATT&CK tactics and techniques.',
  },
  {
    number: 8,
    slug: 'defense',
    title: 'Defense & Detection',
    description: 'SIEM, EDR, detection rules, alert triage, and building visibility into an environment.',
  },
  {
    number: 9,
    slug: 'incident-response',
    title: 'Incident Response',
    description: 'The IR lifecycle, evidence handling, triage on Linux and Windows hosts, and writing it up.',
  },
  {
    number: 10,
    slug: 'cloud',
    title: 'Cloud & Specialization',
    description: 'Cloud shared responsibility, IAM, logging in AWS/Azure, and choosing where to specialise next.',
  },
];

export function getModule(slug: string | undefined): ModuleInfo | undefined {
  return MODULES.find((m) => m.slug === slug);
}

export const lessonKey = (moduleSlug: string, lessonSlug: string) => `${moduleSlug}/${lessonSlug}`;

let questionIndex: Map<string, LocatedQuestion> | null = null;

/** Every question in every released module (lesson quizzes + final-test extras), by id. */
export function questionById(): Map<string, LocatedQuestion> {
  if (questionIndex) return questionIndex;
  questionIndex = new Map();
  for (const m of MODULES) {
    if (!m.content) continue;
    for (const l of m.content.lessons) {
      for (const q of l.quiz) questionIndex.set(q.id, { question: q, moduleSlug: m.slug, lessonSlug: l.slug });
    }
    for (const { lesson, question } of m.content.finalTest.extraQuestions) {
      questionIndex.set(question.id, { question, moduleSlug: m.slug, lessonSlug: lesson });
    }
  }
  if (import.meta.env.DEV) {
    const ids = new Set<string>();
    for (const m of MODULES)
      for (const l of m.content?.lessons ?? [])
        for (const q of l.quiz) {
          if (ids.has(q.id)) console.warn(`Duplicate question id: ${q.id}`);
          ids.add(q.id);
        }
    for (const m of MODULES)
      for (const { question: q } of m.content?.finalTest.extraQuestions ?? []) {
        if (ids.has(q.id)) console.warn(`Duplicate question id: ${q.id}`);
        ids.add(q.id);
      }
  }
  return questionIndex;
}

export function allGlossary(): (GlossaryTerm & { moduleSlug: string })[] {
  return MODULES.flatMap((m) => (m.content?.glossary ?? []).map((t) => ({ ...t, moduleSlug: m.slug })));
}

export function findTerm(id: string): (GlossaryTerm & { moduleSlug: string }) | undefined {
  const key = id.toLowerCase();
  return allGlossary().find((t) => t.id === key || t.term.toLowerCase() === key || t.aliases?.some((a) => a.toLowerCase() === key));
}
