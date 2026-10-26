<!-- #linux-intro -->
Strictly speaking, **Linux** is just the [[kernel]]: the core program that Linus Torvalds started in 1991 and that thousands of developers maintain today. What people install and call “Linux” is a [[distribution]]: the kernel plus a large set of user programs (most from the GNU project), a package manager to install software, and sensible defaults. Ubuntu, Debian, Red Hat Enterprise Linux (RHEL), Fedora and Kali are all distributions. They share the same kernel design, so almost everything in this module applies to all of them; where file paths or tools differ, the lesson says so.

Linux runs most of the world’s servers, nearly all cloud workloads, containers, network appliances and Android phones. As a security analyst you will read Linux logs, investigate Linux hosts and harden Linux servers, even if your own laptop runs Windows.

<!-- #layers -->
A running Linux system is easiest to understand as four layers stacked on top of each other. Each layer only talks to the layer directly below it.

| Layer | What lives there | Examples |
| --- | --- | --- |
| **User space** | Every program you run, plus the libraries they use | `bash`, `ls`, `sshd`, `nginx`, Python, the C library `glibc` |
| **System call interface** | The narrow, controlled doorway from user space into the kernel | `openat`, `read`, `write`, `execve`, `clone` |
| **Kernel space** | The kernel: one large privileged program that manages everything | process scheduler, memory manager, filesystems, drivers, network stack |
| **Hardware** | The physical machine (or virtual hardware in a VM) | CPU, RAM, disks, network card |

The key idea: programs never touch hardware directly. When `cat` wants bytes from a disk, it asks the kernel, and the kernel decides whether to allow it and does the work.

<!-- #modes -->
Modern CPUs have privilege levels. On x86 processors they are called **rings**: the kernel runs in **ring 0** (often just called *kernel mode*) and ordinary programs run in **ring 3** (*user mode*). That gives us two worlds:

- [[Kernel space|kernel-space]]: code running in kernel mode. It can execute any CPU instruction, access all memory and talk to every device. There is exactly one kernel per running system.
- [[User space|user-space]]: everything else. Each program runs as a [[process]] with its own private view of memory. A process cannot read another process’s memory, cannot touch hardware, and cannot run privileged CPU instructions. If it tries, the CPU traps and the kernel steps in, usually killing the offending process.

This split is the foundation of security on Linux. A buggy or malicious program in user space can only do what the kernel lets it do. If a user program crashes, only that process dies. If the kernel itself crashes, the whole machine stops; this is a [[kernel panic]].

> [!warning] Root is not the kernel
> A common misconception is that programs running as root “run in the kernel”. They do not. A root process is still an ordinary user-space process. The difference is that when it makes a request, the kernel’s permission checks say yes much more often. Root and the kernel are separate ideas: root is an *identity*, kernel mode is a *CPU privilege level*.

<!-- #jobs -->
The kernel is one large program, but it does a handful of clearly separate jobs:

- **Process scheduling.** There are usually far more processes than CPU cores. The scheduler decides which process runs on which core and for how long, switching between them hundreds of times per second so that everything appears to run at once.
- **Memory management.** It gives every process its own *virtual* address space, maps it to physical RAM, keeps processes isolated from each other, and swaps to disk when RAM runs short.
- **Device drivers.** Drivers are the parts of the kernel that know how to talk to specific hardware: disk controllers, network cards, USB devices, GPUs. Many are [[kernel modules|kernel-module]], pieces of kernel code that can be loaded and unloaded while the system runs (`lsmod` lists them).
- **Filesystems.** The kernel’s *virtual filesystem* layer (VFS) presents one consistent tree of files and directories, whatever the storage underneath: ext4 or XFS on a disk, a USB stick, a network share, or virtual filesystems the kernel generates on the fly, like `/proc`.
- **Networking.** The TCP/IP stack, sockets, routing and the firewall (netfilter, configured by tools like `ufw`, `iptables` or `nftables`) are all in the kernel.
- **Security enforcement.** Every permission check you will learn about in this module is done by the kernel: file permissions, user IDs, and extra layers like SELinux or AppArmor.

<!-- #syscalls -->
A [[system call|syscall]] (*syscall*) is how a user-space program asks the kernel to do something it cannot do itself: open a file, read from it, start a program, send network data, create a process. Linux has a few hundred of them, each with a name and a number. Making one switches the CPU into kernel mode at a fixed, controlled entry point; the kernel checks the request, does the work, and switches back.

Programmers rarely make syscalls by hand. They call ordinary functions in the C library, [[glibc]], such as `open()` or `fork()`, and the library makes the actual syscall. That is why the visualization below shows glibc as a thin layer at the bottom of user space.

Some syscalls you will meet again and again:

| Syscall | What it asks the kernel | Typical caller |
| --- | --- | --- |
| `openat` | Open a file, return a file descriptor | any program reading a file |
| `read` / `write` | Move bytes from / to a file descriptor | `cat`, editors, servers |
| `close` | Finished with this descriptor | everything |
| `clone` (behind `fork`) | Create a new process | the shell, servers |
| `execve` | Replace this process’s program with another | the shell starting a command |
| `socket`, `connect`, `accept` | Network communication | `ssh`, web servers, malware |
| `kill` | Send a signal to a process | the `kill` command |

When `open` succeeds, the kernel returns a small integer called a [[file descriptor]] (*fd*). The program uses that number in later `read` and `write` calls. Every process starts with three already open: **0** is standard input, **1** is standard output and **2** is standard error. You will use these numbers for redirection in the shell lesson.

<!-- #viz-intro -->
Here is what really happens when you type one simple command. Step through it and watch which layer is involved at each moment.

<!-- #after-viz -->
You can watch this on a real system with [[strace]], which prints every system call a program makes. On your VM, `strace cat /etc/hostname` shows a few dozen lines; most are the program loading its libraries, and near the end you will find the `openat`, `read`, `write` and `close` calls from the diagram.

<!-- #practice -->
The terminal below is a simulation of an Ubuntu server called `web01`. It is not running a real kernel, but it follows the same rules, including permission checks. You are logged in as the user `analyst`.

<!-- #security -->
**Every action is a system call, so system calls are what defenders watch.** Tools such as `auditd`, Sysmon for Linux and commercial EDR (endpoint detection and response) products record syscalls like `execve` (a program started), `connect` (an outbound connection) and `openat` on sensitive files. When an alert says “process `bash` executed `/tmp/x` and connected to 203.0.113.45”, that story was assembled from syscalls.

**Privilege escalation means crossing a boundary the kernel enforces.** An attacker who gets a foothold as an ordinary user wants root, and from root they may want the kernel itself. Misconfigurations (covered in the permissions and hardening lessons) are the most common route. The other route is a kernel bug: vulnerabilities like Dirty COW (CVE-2016-5195) and Dirty Pipe (CVE-2022-0847) let unprivileged users overwrite files they should only be able to read. That is why kernel updates matter and why you should know how to check the running version with `uname -r`.

**Where malware hides depends on which layer it reaches.** A user-space [[rootkit]] tampers with programs or libraries, which careful tools can spot. A kernel rootkit, usually a malicious kernel module, runs in ring 0 and can change what system calls return. If the kernel lies, every tool asking it (`ps`, `ls`, `netstat`) is fooled. Defences include Secure Boot with signed kernel modules (next lesson) and checking systems from outside, for example by analysing a memory image.

**Containers share the host kernel.** A Docker container is a group of isolated processes, not a separate machine. A kernel vulnerability exploited inside a container can affect the host. Features like *seccomp* reduce risk by limiting which syscalls a container may make.

<!-- #try-intro -->
Use a Linux VM (Ubuntu Server is a good choice) or WSL on Windows. WSL 2 runs a real Linux kernel, so everything here works. Install `strace` first if it is missing: `sudo apt install strace`.
