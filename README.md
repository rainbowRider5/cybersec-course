# Groundwork: an interactive cybersecurity course

A self-study course for moving into cybersecurity, aimed at SOC analyst / CompTIA Security+ level and beyond.
Each module has lessons made of a **knowledge base** (explanations, interactive diagrams, a simulated terminal)
followed by a **lesson quiz**, and the module ends with a **final test**.

Module 1, **Linux in Depth**, is complete. The other ten modules are listed as “Coming soon”.

- Vite + React + TypeScript, no backend. Everything runs in the browser.
- Progress and the Review queue are saved in `localStorage` (the app still works if storage is blocked; progress then lasts for the visit).
- Light and dark themes (follows the system by default; toggle in the header), responsive down to 375 px, keyboard accessible, respects `prefers-reduced-motion`.

## Getting started

Requires Node.js 18 or newer (developed on Node 22).

```bash
npm install        # install dependencies
npm run dev        # start the dev server, then open the printed URL (usually http://localhost:5173)
npm run build      # type-check and build a static site into dist/
npm run preview    # serve the built dist/ locally
npm run check      # type-check + validate all course content (see below)
```

The build is fully static and uses hash-based URLs (`#/m/linux/...`), so `dist/` can be opened from any static
host or sub-folder without server configuration.

## What is in Module 1

| # | Lesson | Interactive parts |
| --- | --- | --- |
| 1 | Linux architecture | Layered diagram: follow `cat file.txt` through syscalls to the disk and back |
| 2 | The boot process | Step-through boot timeline with “what can be tampered with here” and the Secure Boot chain |
| 3 | The filesystem hierarchy | Explorable directory tree; hard vs. symbolic link diagram |
| 4 | Users, groups and permissions | Permission calculator (checkboxes ⇄ octal ⇄ symbolic, plus “who can do what”) |
| 5 | Processes and services | Animated process tree with fork/exec, zombie and background jobs; signal demo |
| 6 | Logs and auditing | auth.log viewer with filters and per-field annotations |
| 7 | The shell and Bash scripting | Pipeline diagram for `cat \| grep \| sort \| uniq -c` |
| 8 | Linux hardening and auditing | Server audit exercise: spot the findings across seven checks |

Every lesson also has learning objectives, a “Why this matters for security” section, a “Try it yourself” exercise for a
real VM or WSL, guided tasks in the **simulated terminal**, and a 10-question quiz. The final test draws 25 questions
from all lessons (pass mark 80%).

### Quizzes, progress and review

- Question types: single choice, multiple choice, short answer (with accepted variants), ordering (drag and drop, or
  keyboard: Space to pick up, arrow keys to move, Space to drop), terminal task, and “read this output”.
- Every answer shows whether it was right and an explanation. **Not sure** counts as wrong but simply files the question for review.
- A lesson is complete when its quiz is passed with at least 80%.
- Wrong and “Not sure” answers go to the **Review** queue (header). Answering a question correctly anywhere removes it.
- Results show a score per topic (per lesson in the final test, per section in a lesson quiz) and link to the lesson section for each missed question.

### The simulated terminal

`src/terminal/` is an in-browser fake shell over an in-memory filesystem; nothing executes on your machine. It
supports pipes, redirection (`>`, `>>`, `<`, `2>`, `2>&1`), `;` `&&` `||`, variables, quoting and globbing, and these
commands:

`pwd ls cd cat head tail wc grep find sort uniq cut awk echo touch mkdir rm cp mv ln chmod chown chgrp umask stat file
whoami id groups who w last sudo su ps pstree kill systemctl history clear export env printenv which type uname hostname help`

Permission checks are real: the kernel’s owner → group → others rule, root bypass, directory `x` for traversal, the
sticky bit, SUID-clearing on `chown`. Type `help` in any terminal for the list.

## Project structure

```
src/
  course/
    registry.ts        ← the ONE place modules are registered
    types.ts           ← Lesson, Question, ModuleContent… types
    chunks.ts          ← splits lesson Markdown files into named chunks
    sections.ts
  content/
    module-01-linux/   ← everything specific to Module 1
      index.ts         ← exports the module's ModuleContent
      lessons/         ← one .md (prose) + one .ts (structure, tasks, quiz) per lesson
      visualizations/  ← hand-built SVG/React diagrams used by this module
      data/            ← shared sample data (e.g. the auth.log sample)
      scenarios.ts     ← simulated systems for the terminal
      glossary.ts      ← every term the module introduces
      finalTest.ts     ← final-test settings and final-only questions
  terminal/            ← simulated terminal engine (reusable by any module)
  quiz/                ← quiz engine (reusable by any module)
  components/          ← layout, Markdown renderer, glossary, terminal UI…
  pages/               ← routes
  progress/            ← localStorage-backed progress store
scripts/check-content.ts
```

## Adding a module (e.g. Module 2)

Adding a module only needs a content folder and one line in the registry.

1. **Create the folder** `src/content/module-02-networking/` with an `index.ts` that default-exports a `ModuleContent`:

   ```ts
   import type { ModuleContent } from '../../course/types';
   import osi from './lessons/01-osi';
   import { glossary } from './glossary';

   const networking: ModuleContent = {
     lessons: [osi /*, … */],
     glossary,
     finalTest: { questionCount: 25, passMark: 0.8, extraQuestions: [] },
   };
   export default networking;
   ```

2. **Write each lesson** as a pair of files, copying the shape of `module-01-linux/lessons/01-architecture.*`:
   - `01-osi.md`: the prose, split into chunks with marker lines like `<!-- #intro -->`. Standard Markdown works,
     plus `[[Term]]` or `[[shown text|term-id]]` glossary links and `> [!note|warning|security] Title` callouts.
   - `01-osi.ts`: a `Lesson` object: objectives, sections (Markdown chunks via `t('intro')`, plus
     `{ kind: 'viz' }` diagrams and `{ kind: 'terminal' }` exercises), the security section, “Try it yourself” and the quiz.
   - Question ids must be unique across the whole course (convention: `m2-<lesson>-<name>`).
   - Terminal tasks need a `check(state)` function and a `solution` (list of commands).

3. **Register it** in `src/course/registry.ts`: import the folder and set `content` on the module’s existing entry:

   ```ts
   import networking from '../content/module-02-networking';
   // …
   { number: 2, slug: 'networking', title: 'Networking for Security', description: '…', content: networking },
   ```

That is all: the home page unlocks it, and the module page, lessons, quizzes, final test, Review queue and glossary pick it up automatically.

4. **Validate** with `npm run check`. It verifies unique question ids, valid answer indexes, that quiz section links
   exist, that every `[[glossary link]]` resolves, and that every terminal task is incomplete on a fresh system but
   complete after running its `solution` in the simulator.

## Notes on content

- Linux paths and commands are given for Debian/Ubuntu first, with RHEL/Fedora differences noted where they matter.
- IP addresses in examples come from the documentation ranges (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24);
  password hashes and keys are fake.
- The security material is defensive: it explains why configurations are risky and how to detect and fix them, not how
  to attack systems.
