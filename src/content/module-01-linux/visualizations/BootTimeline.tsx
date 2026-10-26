import { useRef, useState, type KeyboardEvent } from 'react';
import { Markdown } from '../../../components/Markdown';

interface Stage {
  short: string;
  title: string;
  where: string;
  happens: string[];
  risks: string[];
  defend: string[];
  check?: string;
  /** Which links of the Secure Boot chain are being verified at this stage. */
  chain: number;
}

const STAGES: Stage[] = [
  {
    short: 'Firmware',
    title: 'Firmware: UEFI (or legacy BIOS)',
    where: 'Code stored in a flash chip on the motherboard',
    happens: [
      'Power on. The firmware runs the **POST** (power-on self-test) and initialises CPU, RAM and devices.',
      'It picks a boot device using the boot order stored in its settings (NVRAM).',
      '**UEFI** reads the **EFI System Partition** (a small FAT32 partition, mounted at `/boot/efi` once Linux is running) and runs a boot program from it. Legacy **BIOS** instead runs the 512-byte boot sector (MBR) of the disk.',
      'With **Secure Boot** on, UEFI only runs boot programs whose signature matches keys stored in the firmware.',
    ],
    risks: [
      'Firmware implants survive reinstalling the OS and even replacing the disk, because they live on the motherboard. They are rare and usually state-sponsored; LoJax (2018) was the first UEFI rootkit seen in the wild.',
      'Someone with physical access can change the boot order and boot their own OS from USB, then read an unencrypted disk.',
    ],
    defend: [
      'Keep firmware updated and set a firmware (setup) password.',
      'Keep Secure Boot enabled.',
      'A **TPM** can record a measurement (hash) of every boot component (“measured boot”), so tampering can be detected.',
    ],
    check: 'mokutil --sb-state        # is Secure Boot enabled?\nls /sys/firmware/efi       # exists only on UEFI boots',
    chain: 0,
  },
  {
    short: 'Bootloader',
    title: 'Bootloader: shim + GRUB 2',
    where: 'On the EFI System Partition and in /boot',
    happens: [
      'On Secure Boot systems the firmware first runs **shim**, a tiny loader signed by Microsoft’s UEFI key. shim verifies **GRUB**, which is signed by the distribution.',
      'GRUB reads `/boot/grub/grub.cfg`, shows the boot menu, and loads two files into memory: the compressed kernel (`/boot/vmlinuz-…`) and the **initramfs** (`/boot/initrd.img-…`).',
      'It passes the **kernel command line**, for example `root=UUID=… ro quiet splash`, and jumps into the kernel.',
    ],
    risks: [
      '**Bootkits** replace or patch the bootloader so malicious code runs before the operating system and can hide from it.',
      'With physical access and no GRUB password, anyone can edit the kernel command line at the boot menu, for example to boot into a root shell without knowing any password. Disk encryption is what stops this from exposing the data.',
    ],
    defend: [
      'Secure Boot makes a modified bootloader fail signature checks.',
      'Set a GRUB password for editing entries, and use full-disk encryption (LUKS).',
      'Watch for unexpected changes to files in `/boot` and the EFI partition.',
    ],
    check: 'cat /proc/cmdline          # the command line this kernel booted with\nls -l /boot',
    chain: 2,
  },
  {
    short: 'Kernel',
    title: 'Kernel + initramfs',
    where: 'Loaded into RAM from /boot',
    happens: [
      'The kernel decompresses itself, sets up memory management and the scheduler, and starts its built-in drivers.',
      'It unpacks the **initramfs**: a small temporary root filesystem in RAM with just enough drivers and tools to reach the real root filesystem (for example storage drivers, LVM, or the prompt that unlocks an encrypted disk).',
      'Once the real root filesystem is found and mounted, the initramfs hands over (`switch_root`) and the kernel starts **`/sbin/init`**.',
    ],
    risks: [
      'Malicious **kernel modules** (LKM rootkits) run with full kernel privileges and can hide files, processes and network connections from every tool in user space.',
      'A tampered initramfs could capture the disk encryption passphrase as it is typed (an “evil maid” attack, needing physical access).',
    ],
    defend: [
      'Secure Boot plus kernel **lockdown** means only signed kernel modules can load.',
      'Review loaded modules and kernel messages. Compare against a known-good baseline.',
    ],
    check: 'uname -r                   # running kernel version\nlsmod | head               # loaded kernel modules\nsudo dmesg | less          # kernel messages from this boot',
    chain: 3,
  },
  {
    short: 'systemd',
    title: 'init: systemd, PID 1',
    where: 'The first user-space process',
    happens: [
      'The kernel starts one program in user space, `/sbin/init`. On almost all modern distributions this is **systemd**, and it gets **PID 1**.',
      'Every other user-space process descends from PID 1. If it ever exits, the kernel panics.',
      'systemd reads its **unit files**, mounts the filesystems listed in `/etc/fstab`, and works towards the default **target**: `multi-user.target` on servers, `graphical.target` on desktops.',
    ],
    risks: [
      'Attackers create or modify systemd services and timers so their program starts on every boot. This persistence technique is MITRE ATT&CK T1543.002 (“Systemd Service”).',
      'Older mechanisms such as `/etc/rc.local` or cron `@reboot` entries serve the same purpose.',
    ],
    defend: [
      'Review enabled units and look for recently changed unit files in `/etc/systemd/system` and `~/.config/systemd/user`.',
      'File integrity monitoring (for example AIDE) alerts on new or changed unit files.',
    ],
    check: 'systemctl get-default\nsystemctl list-unit-files --state=enabled\nsystemd-analyze blame | head',
    chain: 4,
  },
  {
    short: 'Services',
    title: 'Services start',
    where: 'Daemons started by systemd',
    happens: [
      'systemd starts **services** (long-running background programs called **daemons**) in parallel, respecting their dependencies: logging (`systemd-journald`, `rsyslog`), networking, `cron`, `sshd`, a web server, and so on.',
      'Each service runs as the user its unit file specifies. Many run as root, so a vulnerable service can be a direct path to full control.',
    ],
    risks: [
      'Every running network service is attack surface. Services you never use are pure risk.',
      'Attackers who gain root often stop or reconfigure logging so their activity is not recorded.',
    ],
    defend: [
      'Disable services you do not need, and run the rest with the least privilege possible.',
      'Alert when logging services stop or log files shrink unexpectedly.',
    ],
    check: 'systemctl list-units --type=service --state=running\nsudo ss -tlnp              # which services listen on TCP ports',
    chain: 4,
  },
  {
    short: 'Login',
    title: 'Login',
    where: 'getty / display manager / sshd, then PAM',
    happens: [
      'On a console, `getty` shows the login prompt (desktops show a graphical display manager instead). Remote users arrive through `sshd`.',
      'The password or key is checked through **PAM** (Pluggable Authentication Modules), which for local passwords compares a hash with `/etc/shadow`.',
      'On success, a session is opened, your shell starts with your UID, and login scripts such as `/etc/profile` and `~/.bashrc` run.',
    ],
    risks: [
      'Password guessing (brute force) against SSH.',
      'A malicious PAM module can log every password or accept a secret “master” password.',
      'Lines added to `~/.bashrc` or `/etc/profile` run every time someone logs in (ATT&CK T1546.004).',
    ],
    defend: [
      'Use SSH keys, disable password and root login over SSH, and add MFA where possible.',
      'Watch `/var/log/auth.log` for failed logins and monitor `/etc/pam.d` and shell startup files for changes.',
    ],
    check: 'last | head                # recent logins\nsudo grep "Failed password" /var/log/auth.log | tail',
    chain: 4,
  },
];

const CHAIN = ['UEFI firmware', 'shim', 'GRUB', 'kernel', 'signed modules'];

export default function BootTimeline() {
  const [i, setI] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const s = STAGES[i];

  const onKey = (e: KeyboardEvent) => {
    let n = i;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = Math.min(STAGES.length - 1, i + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = Math.max(0, i - 1);
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = STAGES.length - 1;
    else return;
    e.preventDefault();
    setI(n);
    tabs.current[n]?.focus();
  };

  return (
    <div className="boot-viz">
      <div className="boot-track" role="tablist" aria-label="Boot stages" onKeyDown={onKey}>
        {STAGES.map((st, idx) => (
          <button
            key={st.short}
            ref={(el) => {
              tabs.current[idx] = el;
            }}
            role="tab"
            id={`boot-tab-${idx}`}
            aria-selected={idx === i}
            aria-controls="boot-panel"
            tabIndex={idx === i ? 0 : -1}
            className={`boot-node${idx === i ? ' current' : ''}${idx < i ? ' past' : ''}`}
            onClick={() => setI(idx)}
          >
            <span className="boot-dot" aria-hidden="true">
              {idx + 1}
            </span>
            <span className="boot-label">{st.short}</span>
          </button>
        ))}
      </div>

      <div className="controls" style={{ justifyContent: 'space-between', margin: '0.6rem 0 0.4rem' }}>
        <button type="button" className="btn btn-small" onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0}>
          ← Previous stage
        </button>
        <span className="mono" style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>
          {i + 1} / {STAGES.length}
        </span>
        <button type="button" className="btn btn-small btn-primary" onClick={() => setI(Math.min(STAGES.length - 1, i + 1))} disabled={i === STAGES.length - 1}>
          Next stage →
        </button>
      </div>

      <div id="boot-panel" role="tabpanel" aria-labelledby={`boot-tab-${i}`} className="boot-panel">
        <h4 style={{ margin: '0.2rem 0 0' }}>{s.title}</h4>
        <p className="boot-where">{s.where}</p>
        <div className="boot-cols">
          <div className="boot-col">
            <h5>What happens here</h5>
            <ul>
              {s.happens.map((h) => (
                <li key={h}>
                  <Markdown text={h} inline />
                </li>
              ))}
            </ul>
          </div>
          <div className="boot-col risk">
            <h5>What can go wrong or be tampered with</h5>
            <ul>
              {s.risks.map((h) => (
                <li key={h}>
                  <Markdown text={h} inline />
                </li>
              ))}
            </ul>
          </div>
          <div className="boot-col defend">
            <h5>How defenders protect and check</h5>
            <ul>
              {s.defend.map((h) => (
                <li key={h}>
                  <Markdown text={h} inline />
                </li>
              ))}
            </ul>
            {s.check && (
              <pre>
                <code>{s.check}</code>
              </pre>
            )}
          </div>
        </div>

        <div className="chain" aria-label="Secure Boot chain of trust">
          <span className="chain-title">Secure Boot chain of trust: each link checks the signature of the next</span>
          <div className="viz-scroll">
            <svg viewBox="0 0 700 56" role="img" aria-label={`Verified so far: ${CHAIN.slice(0, s.chain + 1).join(', ')}`}>
              {CHAIN.map((c, idx) => {
                const x = 10 + idx * 140;
                const on = idx <= s.chain;
                return (
                  <g key={c}>
                    <rect x={x} y="10" width="116" height="36" rx="6" fill={on ? 'var(--accent-soft)' : 'var(--surface)'} stroke={on ? 'var(--accent)' : 'var(--d-stroke)'} strokeWidth={on ? 2 : 1} />
                    <text x={x + 58} y="33" textAnchor="middle" style={{ fontSize: 13 }}>
                      {c}
                    </text>
                    {idx < CHAIN.length - 1 && (
                      <path d={`M${x + 118} 28 h18 m-6 -5 l6 5 l-6 5`} fill="none" stroke={idx < s.chain ? 'var(--accent)' : 'var(--d-stroke)'} strokeWidth="1.6" />
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
