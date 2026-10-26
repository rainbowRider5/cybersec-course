import type { Lesson } from '../../../course/types';
import { chunks } from '../../../course/chunks';
import raw from './02-boot.md?raw';
import BootTimeline from '../visualizations/BootTimeline';
import { architectureScenario, lastOut, ran } from '../scenarios';

const t = chunks(raw);

const lesson: Lesson = {
  slug: 'boot',
  title: 'The boot process',
  summary: 'From firmware to login prompt: UEFI, GRUB, the kernel and initramfs, systemd as PID 1, and where each stage can be attacked.',
  estimatedMinutes: 30,
  objectives: [
    'Put the stages of the Linux boot process in order and say what each does.',
    'Explain the role of UEFI, Secure Boot, GRUB and the initramfs.',
    'Explain why PID 1 (systemd) is special.',
    'Recognise the security risks at each stage and the matching defences.',
  ],
  sections: [
    { id: 'overview', title: 'The boot chain at a glance', blocks: [t('intro')] },
    { id: 'firmware', title: '1. Firmware: BIOS and UEFI', blocks: [t('firmware')] },
    { id: 'bootloader', title: '2. The bootloader: GRUB', blocks: [t('bootloader')] },
    { id: 'kernel-initramfs', title: '3. Kernel and initramfs', blocks: [t('kernel')] },
    { id: 'systemd', title: '4. init: systemd as PID 1', blocks: [t('systemd')] },
    { id: 'services-login', title: '5–6. Services and login', blocks: [t('services'), t('login')] },
    {
      id: 'timeline',
      title: 'Step through the boot',
      blocks: [
        t('viz-intro'),
        { kind: 'viz', title: 'Boot timeline: what happens, what can go wrong', component: BootTimeline, caption: 'Use the arrow keys on the stage list, or the Previous and Next buttons.' },
      ],
    },
    {
      id: 'practice',
      title: 'Practice: traces of the boot',
      blocks: [
        t('practice'),
        {
          kind: 'terminal',
          title: 'web01: analyst',
          scenario: architectureScenario(),
          tasks: [
            {
              id: 'boot-files',
              solution: ['ls -l /boot'],
              instruction: 'List `/boot` in long format and find the kernel and initramfs files.',
              hint: '`ls -l /boot`',
              check: (s) => ran(s, /^ls\s+(-\w*l\w*\s+)+\/boot\/?$|^ls\s+\/boot\/?\s+-\w*l/) && lastOut(s).includes('vmlinuz'),
              success: '`vmlinuz-6.8.0-45-generic` is the kernel and `initrd.img-6.8.0-45-generic` its initramfs. The short names are symlinks to the current version.',
            },
            {
              id: 'cmdline',
              solution: ['cat /proc/cmdline'],
              instruction: 'Read the kernel command line that GRUB passed to the running kernel.',
              hint: 'It is in `/proc/cmdline`.',
              check: (s) => ran(s, /cat\s+\/proc\/cmdline/),
              success: '`root=UUID=…` says where the root filesystem is; `ro` means it is mounted read-only at first (systemd remounts it read-write later).',
            },
            {
              id: 'pid1',
              solution: ['ps -p 1'],
              instruction: 'Confirm which program is PID 1. Try `ps -p 1` or `pstree -p`.',
              check: (s) => ran(s, /^(ps\b.*-p\s*1\b|pstree)/),
              success: 'PID 1 is systemd (started as `/sbin/init`). Every other process descends from it.',
            },
            {
              id: 'ssh-enabled',
              solution: ['systemctl is-enabled ssh'],
              instruction: 'Check whether the SSH service is enabled to start at boot.',
              hint: '`systemctl is-enabled ssh` or `systemctl status ssh`',
              check: (s) => ran(s, /^systemctl\s+(is-enabled|status)\s+ssh/),
              success: '“enabled” means systemd starts it automatically at boot, through a symlink in `multi-user.target.wants/`.',
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
      { instruction: 'Were you booted with UEFI, and is Secure Boot on?', command: 'ls /sys/firmware/efi && echo "UEFI boot"\nmokutil --sb-state', note: '`mokutil` may need installing (`sudo apt install mokutil`). VMs often have Secure Boot off.' },
      { instruction: 'Look at the kernel command line and the boot files.', command: 'cat /proc/cmdline\nls -l /boot' },
      { instruction: 'See how long each boot stage and service took.', command: 'systemd-analyze\nsystemd-analyze blame | head -15' },
      { instruction: 'Read the kernel’s own messages from this boot, then the full journal for this boot.', command: 'sudo dmesg | head -30\njournalctl -b | head -40' },
      { instruction: 'Check the default target and list enabled units.', command: 'systemctl get-default\nsystemctl list-unit-files --state=enabled | head -30' },
      { instruction: 'Look for recently changed unit files, as an investigator would.', command: 'ls -lt /etc/systemd/system | head', note: 'Anything you did not install yourself, with a recent date, deserves a closer look.' },
    ],
  },
  quiz: [
    {
      id: 'm1-boot-order',
      type: 'order',
      section: 'overview',
      prompt: 'Put the boot stages in the order they happen.',
      items: ['Firmware (UEFI/BIOS) runs POST', 'Bootloader (GRUB) loads kernel and initramfs', 'Kernel starts and uses the initramfs to mount the real root', 'systemd starts as PID 1', 'Services such as sshd start', 'Login prompt / user logs in'],
      explanation: 'Firmware → bootloader → kernel + initramfs → init (systemd) → services → login. Each stage verifies or prepares the next.',
    },
    {
      id: 'm1-boot-initramfs',
      type: 'single',
      section: 'kernel-initramfs',
      prompt: 'What is the purpose of the initramfs?',
      options: [
        'It stores the user’s home directory during boot',
        'It is a temporary root filesystem in RAM with the drivers and tools needed to find and mount the real root filesystem',
        'It is the firmware’s configuration',
        'It encrypts the disk',
      ],
      answer: 1,
      explanation: 'The initramfs gives the kernel what it needs (storage drivers, LVM tools, the LUKS unlock prompt) before the real root filesystem is available. Then it hands over with switch_root.',
    },
    {
      id: 'm1-boot-pid1',
      type: 'text',
      section: 'systemd',
      prompt: 'On most modern distributions, which program runs as PID 1?',
      accepted: ['systemd', '/sbin/init', 'init', '/lib/systemd/systemd', '/usr/lib/systemd/systemd'],
      explanation: '**systemd**. `/sbin/init` is a symlink to it, which is why `ps` may show `/sbin/init` as the command line of PID 1.',
    },
    {
      id: 'm1-boot-secureboot',
      type: 'single',
      section: 'firmware',
      prompt: 'What does Secure Boot do?',
      options: ['Encrypts the disk', 'Only runs boot components whose digital signature matches trusted keys', 'Requires a password at the GRUB menu', 'Blocks network access during boot'],
      answer: 1,
      explanation: 'Secure Boot is about **integrity**: the firmware checks shim, shim checks GRUB, GRUB checks the kernel. It does not encrypt anything; that is the job of LUKS.',
    },
    {
      id: 'm1-boot-physical',
      type: 'multi',
      section: 'security',
      prompt: 'An attacker has physical access to a server with **no** disk encryption, no firmware password and no GRUB password. What can they realistically do? Select all that apply.',
      options: [
        'Boot their own OS from a USB stick and read every file on the disk',
        'Edit the kernel command line at the GRUB menu to get a root shell',
        'Read data from a LUKS-encrypted disk without the passphrase',
        'Modify system files, for example to add a backdoor account',
      ],
      answers: [0, 1, 3],
      explanation: 'Without encryption the data on disk is only protected by the running OS, which the attacker can simply bypass. A LUKS-encrypted disk, by contrast, cannot be read without the key.',
    },
    {
      id: 'm1-boot-target',
      type: 'text',
      section: 'systemd',
      prompt: 'What is the name of the systemd target a server normally boots into (everything running, text logins, no graphical desktop)?',
      accepted: ['multi-user.target', 'multi-user', 'multi user target', 'multi-user target'],
      placeholder: 'something.target',
      explanation: '`multi-user.target`. Desktops use `graphical.target`. Check with `systemctl get-default`.',
    },
    {
      id: 'm1-boot-cmdline',
      type: 'output',
      section: 'bootloader',
      prompt: 'You run `cat /proc/cmdline` and see the line below. Which boot stage passed it to the kernel?',
      exhibit: { label: '$ cat /proc/cmdline', text: 'BOOT_IMAGE=/boot/vmlinuz-6.8.0-45-generic root=UUID=3f2a9c1e-5b7d-4e8a-9c21-6d0f4b2a7e11 ro quiet splash' },
      options: ['The firmware', 'The bootloader (GRUB)', 'systemd', 'sshd'],
      answer: 1,
      explanation: 'GRUB builds the kernel command line from its configuration and passes it when it starts the kernel. That is also why someone at the GRUB menu can tamper with it.',
    },
    {
      id: 'm1-boot-persistence',
      type: 'single',
      section: 'security',
      prompt: 'During an investigation you suspect an attacker set up a program to start at every boot. Which location is most worth checking first?',
      options: ['`/etc/systemd/system/` for new or changed unit files', '`/boot/efi/` for new fonts', '`/proc/cpuinfo`', '`/dev/null`'],
      answer: 0,
      explanation: 'Malicious systemd services and timers (ATT&CK T1543.002) are a common Linux persistence method. Also check cron, `/etc/rc.local` and shell startup files.',
    },
    {
      id: 'm1-boot-esp',
      type: 'single',
      section: 'firmware',
      prompt: 'Where does UEFI firmware look for the boot program?',
      options: ['The first 512 bytes of the disk (MBR)', 'A FAT32 partition called the EFI System Partition', '/etc/fstab', 'The initramfs'],
      answer: 1,
      explanation: 'UEFI reads boot programs as files from the EFI System Partition, mounted at `/boot/efi` on a running system. Reading the MBR is what legacy BIOS does.',
    },
    {
      id: 'm1-boot-pid1-dies',
      type: 'single',
      section: 'systemd',
      prompt: 'What happens if PID 1 exits?',
      options: ['systemd restarts automatically from cron', 'The kernel panics', 'The oldest remaining process becomes PID 1', 'Nothing; PID 1 is only used at boot'],
      answer: 1,
      explanation: 'The kernel cannot run user space without init, so it panics. This is also why the kernel shields PID 1 from signals it does not handle.',
    },
  ],
};

export default lesson;
