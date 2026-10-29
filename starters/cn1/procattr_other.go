//go:build !linux

package main

import "syscall"

// 非 Linux 平台没有 namespace，留空只是为了能在 macOS 上 go build 通过。
// INFRA 02 的内核实验必须在 Linux 或 WSL2 里跑，见 content/setup.md。
func newSysProcAttr() *syscall.SysProcAttr { return nil }
