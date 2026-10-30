// CN1 起步骨架：一个最小的容器运行时。
//
// 这个骨架把“命令行解析 + 父子进程切换 + 退出码透传”这一段已经搭好并验证可编译，
// 剩下 7 处标着 TODO 的地方正是实验的核心，需要你自己实现：
//
//  2. cgroup：建 cgroup v2 子组并设上限（Start 之前）
//  3. cgroup：Start 之后把子进程迁进 cgroup.procs
//  4. childStage：把 / 的 mount propagation 设成 private
//  5. childStage：bind mount rootfs 到自己，使其成为挂载点
//  6. childStage：在新 PID namespace 里挂容器本地 /proc
//  7. childStage：pivot_root 到 rootfs 并卸掉旧根
//  8. childStage：在 UTS namespace 里 sethostname
//
// 完整验收标准见 judge/contracts/infra02.md，检查项见 content/cn1.md 的“验收与测试”。
//
// 构建：
//
//	go build -o cn1 .
//
// 运行：
//
//	sudo ./cn1 run --rootfs ~/labs/cn1-rootfs -- /bin/sh -c 'echo hi'
package main

import (
	"fmt"
	"os"
	"os/exec"
	"syscall"
)

const stageEnv = "CN1_STAGE"

func main() {
	if os.Getenv(stageEnv) == "child" {
		// 第二阶段的自己：此时已经在新的 PID/mount/UTS namespace 里。
		childStage()
		return
	}

	if len(os.Args) < 2 || os.Args[1] != "run" {
		fmt.Fprintln(os.Stderr, "usage: cn1 run --rootfs DIR [--memory 64M] -- CMD [ARG...]")
		os.Exit(2)
	}

	opts, cmd, err := parseArgs(os.Args[2:])
	if err != nil {
		fmt.Fprintf(os.Stderr, "cn1: %v\n", err)
		os.Exit(2)
	}
	if err := runContainer(opts, cmd); err != nil {
		fmt.Fprintf(os.Stderr, "cn1: %v\n", err)
		os.Exit(1)
	}
}

type options struct {
	rootfs string
	memory string // 空表示不限
}

// parseArgs 只认 run 之后的参数。`--` 之后一律当作容器里的命令。
func parseArgs(args []string) (options, []string, error) {
	var o options
	i := 0
	for ; i < len(args); i++ {
		switch args[i] {
		case "--":
			i++
			goto done
		case "--rootfs":
			if i+1 >= len(args) {
				return o, nil, fmt.Errorf("--rootfs 需要一个参数")
			}
			o.rootfs = args[i+1]
			i++
		case "--memory":
			if i+1 >= len(args) {
				return o, nil, fmt.Errorf("--memory 需要一个参数")
			}
			o.memory = args[i+1]
			i++
		default:
			return o, nil, fmt.Errorf("未知参数 %q", args[i])
		}
	}
done:
	if o.rootfs == "" {
		return o, nil, fmt.Errorf("缺少 --rootfs")
	}
	if i >= len(args) {
		return o, nil, fmt.Errorf("-- 之后缺少要执行的命令")
	}
	return o, args[i:], nil
}

// runContainer 启动子进程，等它结束，把退出码原样返回给调用者。
// 关键点：所有“必须在 fork 之前完成”的准备工作（打开 netns、准备 cgroup）
// 都要在这里做，因为进入新 namespace 之后就再也看不到宿主路径了。
func runContainer(o options, cmd []string) error {
	// 用 /proc/self/exe 重新执行自己，第二阶段在子进程里跑。
	self, err := os.Executable()
	if err != nil {
		return fmt.Errorf("找不到自己的可执行文件: %w", err)
	}

	c := exec.Command(self, append([]string{"run", "--rootfs", o.rootfs, "--"}, cmd...)...)
	c.Env = append(os.Environ(), stageEnv+"=child",
		"CN1_ROOTFS="+o.rootfs, "CN1_MEMORY="+o.memory)
	// 容器内的 stdout/stderr 直接连到本进程，judge 检查它们是否被吞掉。
	c.Stdin, c.Stdout, c.Stderr = os.Stdin, os.Stdout, os.Stderr

	// 在 fork 之前声明需要的 namespace（按平台定义在 procattr_*.go）。
	c.SysProcAttr = newSysProcAttr()

	// TODO(2)：如果 o.memory 非空，在这里创建 cgroup v2 子组。
	//           顺序很重要：先建组和设上限，再 Start，再写 cgroup.procs，
	//           否则子进程可能在限制生效前就 fork 出孙进程。

	if err := c.Start(); err != nil {
		return fmt.Errorf("启动子进程失败: %w", err)
	}

	// TODO(3)：c.Start() 之后立刻把 c.Process.Pid 写进 cgroup.procs。

	err = c.Wait()
	// 清理 cgroup 目录（即使失败也要尝试）。
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			os.Exit(ee.ExitCode()) // 透传容器内命令的退出码
		}
		return err
	}
	return nil
}

// childStage 在已经建好的 namespace 里运行。
// 它要按顺序完成：private mount → bind rootfs → 挂 /proc → pivot_root →
// sethostname → execve 目标命令。顺序错一步，报错通常不会指向真正的原因。
func childStage() {
	// TODO(4)：把 / 的 mount propagation 设成 MS_PRIVATE|MS_REC。
	// TODO(5)：bind mount rootfs 到它自己，让它成为挂载点（pivot_root 要求）。
	// TODO(6)：在新 PID namespace 里挂一个新的 procfs 到 rootfs/proc。
	//           直接挂宿主 /proc 会让容器里的 ps 看到宿主进程，judge 会失败。
	// TODO(7)：pivot_root 到 rootfs，并把旧根 umount 掉。
	// TODO(8)：在 UTS namespace 里 sethostname（新 UTS 会继承宿主 hostname，
	//           不显式设置就通不过 judge 的 hostname 检查）。

	// 父进程用 `run --rootfs DIR -- CMD ARG...` 重新执行了自己，
	// 所以这里的命令就在 "--" 之后。
	cmd := afterDashDash(os.Args)
	if len(cmd) == 0 {
		fmt.Fprintln(os.Stderr, "cn1: 没有要执行的命令")
		os.Exit(2)
	}

	// 用 syscall.Exec 替换当前进程：这样 PID 1 就是目标命令本身，
	// 信号才能正常转发，退出码也自然成为容器的退出码。
	if err := syscall.Exec(cmd[0], cmd, os.Environ()); err != nil {
		fmt.Fprintf(os.Stderr, "cn1: exec %s: %v\n", cmd[0], err)
		os.Exit(127)
	}
}

func afterDashDash(args []string) []string {
	for i, a := range args {
		if a == "--" {
			return args[i+1:]
		}
	}
	return nil
}
