//go:build !linux

package main

// The escape matrix is Linux-only: openat2, Landlock, seccomp, pidfd and the
// raw syscall numbers below have no equivalent elsewhere. Building on another
// platform gives a stub that says so, instead of a package with no files
// (which would make `go build ./...` fail for anyone developing on macOS).

import (
	"fmt"
	"os"
)

func main() {
	fmt.Fprintln(os.Stderr, "testdata/escape is Linux-only; build it with GOOS=linux")
	os.Exit(2)
}
