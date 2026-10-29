//go:build linux

package main

import "syscall"

// newSysProcAttr 声明容器需要的 namespace。
// PID namespace 只能在这里建：进入之后再 unshare 不会影响调用者自己，
// 子进程也就拿不到 PID 1 的身份。
func newSysProcAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{
		Cloneflags: syscall.CLONE_NEWPID | syscall.CLONE_NEWNS |
			syscall.CLONE_NEWUTS | syscall.CLONE_NEWIPC | syscall.CLONE_NEWNET,
	}
}
