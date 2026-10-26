import type { Lesson } from '../../../course/types';
import { chunks } from '../../../course/chunks';
import raw from './03-filesystem.md?raw';
import FsTree from '../visualizations/FsTree';
import LinksViz from '../visualizations/LinksViz';
import { filesystemScenario, lastOut, node, ran } from '../scenarios';

const t = chunks(raw);

const lesson: Lesson = {
  slug: 'filesystem',
  title: 'The filesystem hierarchy',
  summary: 'One tree from /, what lives in /etc, /var/log, /tmp and friends, mount points, “everything is a file”, inodes, and hard versus soft links.',
  estimatedMinutes: 40,
  objectives: [
    'Navigate the Linux directory tree with absolute and relative paths.',
    'Say what the main FHS directories contain and why each matters for security.',
    'Explain mounting, mount points and the noexec / nosuid / nodev options.',
    'Explain what an inode stores and how hard links and symbolic links differ.',
    'Recognise device files and virtual files in /dev and /proc.',
  ],
  sections: [
    { id: 'one-tree', title: 'One tree, starting at /', blocks: [t('one-tree')] },
    {
      id: 'fhs',
      title: 'The standard directories',
      blocks: [
        t('fhs'),
        { kind: 'viz', title: 'Explore the directory tree', component: FsTree, caption: 'Keyboard: ↑/↓ to move, → to expand, ← to collapse, Enter to open or close a folder.' },
      ],
    },
    { id: 'mounts', title: 'Mount points', blocks: [t('mounts')] },
    { id: 'everything-file', title: '“Everything is a file”', blocks: [t('everything-file')] },
    { id: 'inodes', title: 'Inodes: what a file really is', blocks: [t('inodes')] },
    {
      id: 'links',
      title: 'Hard links and symbolic links',
      blocks: [t('links'), { kind: 'viz', title: 'Names, inodes and links', component: LinksViz, caption: 'Create the links, then delete the original name and see which link survives.' }],
    },
    {
      id: 'practice',
      title: 'Practice: find your way around',
      blocks: [
        t('practice'),
        {
          kind: 'terminal',
          title: 'web01: analyst',
          scenario: filesystemScenario(),
          tasks: [
            {
              id: 'cd-log',
              solution: ['cd /var/log', 'pwd'],
              instruction: 'Go to the directory that holds the log files, and confirm where you are with `pwd`.',
              hint: '`cd /var/log` then `pwd`',
              check: (s) => s.cwd === '/var/log' && ran(s, /^pwd$/),
              success: 'Absolute paths like `/var/log` work from anywhere. From `/var/log`, `cd ..` would take you to `/var`.',
            },
            {
              id: 'hidden',
              solution: ['cd', 'ls -la'],
              instruction: 'Go back to your home directory and list **all** files there, including hidden ones, in long format.',
              hint: '`cd` with no argument goes home. Then `ls -la`.',
              check: (s) => s.cwd === '/home/analyst' && ran(s, /^ls\s+(-[a-zA-Z]*a[a-zA-Z]*|-[a-zA-Z]*A[a-zA-Z]*)/) && lastOut(s).includes('.bash_history'),
              success: 'Dotfiles such as `.bash_history`, `.bashrc` and the `.ssh/` directory only show up with `-a`.',
            },
            {
              id: 'inode',
              solution: ['ls -i /etc/passwd'],
              instruction: 'Find the inode number of `/etc/passwd`.',
              hint: '`ls -i /etc/passwd` or `stat /etc/passwd`',
              check: (s) => ran(s, /^(ls\s+-\w*i\w*.*\/etc\/passwd|stat\s+\/etc\/passwd)/),
              success: 'That number identifies the file’s inode. The name “passwd” is stored in the `/etc` directory, not in the inode.',
            },
            {
              id: 'symlink',
              solution: ['ln -s /var/log ~/logs', 'ls -l'],
              instruction: 'In your home directory, create a symbolic link called `logs` that points to `/var/log`.',
              hint: '`ln -s /var/log ~/logs` (target first, then the link name). Check with `ls -l`.',
              check: (s) => {
                const n = node(s, '/home/analyst/logs');
                return !!n && n.type === 'link' && /^\/var\/log\/?$/.test(n.target ?? '');
              },
              success: '`ls -l` shows `logs -> /var/log`. `cd ~/logs` now takes you to the log directory.',
            },
            {
              id: 'device',
              solution: ['ls -l /dev/sda /dev/null'],
              instruction: 'Look at `/dev/sda` and `/dev/null` with `ls -l`. Which one is a block device?',
              hint: '`ls -l /dev/sda /dev/null`: look at the first character.',
              check: (s) => ran(s, /^ls\s+-\w*l.*\/dev/),
              success: '`b` = block device (the disk), `c` = character device (`/dev/null`). Note `/dev/sda` is `root:disk` with mode 660, so normal users cannot read the raw disk.',
            },
          ],
        },
      ],
    },
  ],
  security: [t('security')],
  tryIt: {
    intro: t('try-intro'),
    steps: [
      { instruction: 'See how the top level is laid out, and which entries are symlinks.', command: 'ls -l /' },
      { instruction: 'List disks and partitions, then what is mounted where and with which options.', command: 'lsblk\nfindmnt -t ext4,xfs,vfat,tmpfs\ndf -h' },
      { instruction: 'Look at the permissions of the key account files.', command: 'ls -l /etc/passwd /etc/shadow /etc/group' },
      {
        instruction: 'Create a file, a hard link and a symlink, and compare inode numbers and link counts.',
        command: 'cd /tmp\necho hello > original.txt\nln original.txt hard.txt\nln -s original.txt soft.txt\nls -li original.txt hard.txt soft.txt',
      },
      { instruction: 'Delete the original and see which link still works.', command: 'rm original.txt\ncat hard.txt\ncat soft.txt\nls -l soft.txt' },
      { instruction: 'Check the kernel’s link protections and look for hidden items in temp directories.', command: 'sysctl fs.protected_symlinks fs.protected_hardlinks\nls -la /tmp /var/tmp /dev/shm' },
      {
        instruction: 'See a process’s binary through /proc.',
        command: 'ls -l /proc/self/exe\nls -l /proc/1/exe   # needs sudo',
        note: '`/proc/self` always refers to the process reading it, here `ls` itself.',
      },
    ],
  },
  quiz: [
    {
      id: 'm1-fs-etc',
      type: 'single',
      section: 'fhs',
      prompt: 'Where do you find system-wide configuration files such as `sshd_config` and `sudoers`?',
      options: ['`/var`', '`/etc`', '`/usr/bin`', '`/opt`'],
      answer: 1,
      explanation: '`/etc` holds system configuration, almost all as plain text: `/etc/ssh/sshd_config`, `/etc/sudoers`, `/etc/passwd` and so on.',
    },
    {
      id: 'm1-fs-tmp',
      type: 'output',
      section: 'fhs',
      prompt: 'This is the listing of a standard directory. Which directory is it, most likely?',
      exhibit: { label: '$ ls -ld ????', text: 'drwxrwxrwt 14 root root 4096 Oct 26 09:10 ????' },
      options: ['`/etc`', '`/root`', '`/tmp`', '`/home`'],
      answer: 2,
      explanation: '`rwxrwxrwt`: writable by everyone, with the sticky bit (`t`) so users cannot delete each other’s files. That is `/tmp` (and `/var/tmp`).',
    },
    {
      id: 'm1-fs-inode',
      type: 'multi',
      section: 'inodes',
      prompt: 'Which of these are stored in a file’s inode? Select all that apply.',
      options: ['The file’s name', 'The owner (UID) and group (GID)', 'The permission bits', 'The size and timestamps', 'Pointers to the data blocks'],
      answers: [1, 2, 3, 4],
      explanation: 'Everything except the name. Names live in directory entries, which is exactly what makes hard links possible.',
    },
    {
      id: 'm1-fs-hardlink-delete',
      type: 'single',
      section: 'links',
      prompt: '`report.txt` has a hard link `backup.txt` and a symbolic link `latest -> report.txt`. You run `rm report.txt`. What happens?',
      options: [
        'Both links stop working',
        '`backup.txt` still shows the contents; `latest` is now a broken link',
        '`latest` still works; `backup.txt` is broken',
        'Both still work',
      ],
      answer: 1,
      explanation: 'The hard link is another name for the same inode, so the data survives (link count drops from 2 to 1). The symlink only stores the path “report.txt”, which no longer exists.',
    },
    {
      id: 'm1-fs-ls-i',
      type: 'output',
      section: 'links',
      prompt: 'What is the relationship between these two files?',
      exhibit: {
        label: '$ ls -li',
        text: '524611 -rw-r--r-- 2 analyst analyst 412 Oct 26 09:12 data.csv\n524611 -rw-r--r-- 2 analyst analyst 412 Oct 26 09:12 data-copy.csv',
      },
      options: [
        'They are independent copies with the same contents',
        'They are hard links: two names for the same inode',
        '`data-copy.csv` is a symbolic link',
        'One of them is corrupted',
      ],
      answer: 1,
      explanation: 'Same inode number (524611) and a link count of 2: two directory entries pointing at one inode. A copy would have its own inode number; a symlink would start with `l` and show `->`.',
    },
    {
      id: 'm1-fs-root-home',
      type: 'text',
      section: 'fhs',
      prompt: 'What is the absolute path of the root **user’s** home directory?',
      accepted: ['/root', '/root/'],
      placeholder: '/…',
      explanation: '`/root`. Not to be confused with `/`, the root *directory* of the filesystem.',
    },
    {
      id: 'm1-fs-proc',
      type: 'single',
      section: 'everything-file',
      prompt: 'What is `/proc`?',
      options: [
        'A directory where programs are installed',
        'A virtual filesystem generated by the kernel, with a directory per running process',
        'The swap partition',
        'A backup of `/etc`',
      ],
      answer: 1,
      explanation: '`/proc` is procfs: nothing in it is on disk. Reading `/proc/<PID>/cmdline` or `/proc/meminfo` asks the kernel for live information.',
    },
    {
      id: 'm1-fs-blockdev',
      type: 'output',
      section: 'everything-file',
      prompt: 'What kind of file is this?',
      exhibit: { label: '$ ls -l /dev/sda', text: 'brw-rw---- 1 root disk 8, 0 Oct 26 08:01 /dev/sda' },
      options: ['A directory', 'A block device (a disk)', 'A broken symbolic link', 'A character device'],
      answer: 1,
      explanation: 'The leading `b` marks a block device. `8, 0` are the device’s major and minor numbers, shown in place of a size.',
    },
    {
      id: 'm1-fs-noexec',
      type: 'text',
      section: 'mounts',
      prompt: 'Which mount option stops programs on a filesystem (such as `/tmp`) from being executed directly?',
      accepted: ['noexec'],
      placeholder: 'mount option',
      explanation: '`noexec`. Usually combined with `nosuid` and `nodev` for `/tmp`, `/var/tmp` and `/dev/shm`.',
    },
    {
      id: 'm1-fs-term-symlink',
      type: 'terminal',
      section: 'links',
      prompt: 'In the terminal, create a symbolic link in `/home/analyst` called `cfg` that points to `/etc/ssh`.',
      scenario: filesystemScenario(),
      task: {
        id: 'cfg-link',
        solution: ['ln -s /etc/ssh ~/cfg'],
        instruction: 'Create `~/cfg` as a symlink to `/etc/ssh`.',
        hint: '`ln -s /etc/ssh ~/cfg`',
        check: (s) => {
          const n = node(s, '/home/analyst/cfg');
          return !!n && n.type === 'link' && /^\/etc\/ssh\/?$/.test(n.target ?? '');
        },
      },
      explanation: '`ln -s /etc/ssh ~/cfg`. The order is always *target* first, then the name of the new link, just like `cp source destination`.',
    },
  ],
};

export default lesson;
