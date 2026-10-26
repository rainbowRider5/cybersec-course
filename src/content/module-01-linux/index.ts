import type { ModuleContent } from '../../course/types';
import architecture from './lessons/01-architecture';
import boot from './lessons/02-boot';
import filesystem from './lessons/03-filesystem';
import permissions from './lessons/04-permissions';
import processes from './lessons/05-processes';
import logs from './lessons/06-logs';
import shell from './lessons/07-shell';
import hardening from './lessons/08-hardening';
import { glossary } from './glossary';
import { finalTest } from './finalTest';

/** Module 1: Linux in Depth. Registered in src/course/registry.ts. */
const linux: ModuleContent = {
  lessons: [architecture, boot, filesystem, permissions, processes, logs, shell, hardening],
  glossary,
  finalTest,
};

export default linux;
