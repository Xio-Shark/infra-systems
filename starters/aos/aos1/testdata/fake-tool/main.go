// AOS1 test fixture: the misbehaving tool used by the ssh-denied and oom cases.
//
// Build:  go build -o testdata/fake-tool ./testdata/fake-tool
// Usage:  fake-tool hog 512MiB    (allocates and touches the given amount)
//
//	fake-tool read PATH     (reads a file and echoes it)
//
// It is deliberately dumb: it does exactly one thing and reports the kernel's
// error verbatim on stderr, so a sandbox cannot be faked by intercepting it.
package main

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

func main() {
	if len(os.Args) < 3 {
		fmt.Fprintln(os.Stderr, "usage: fake-tool hog 512MiB | fake-tool read PATH")
		os.Exit(2)
	}
	switch os.Args[1] {
	case "hog":
		hog(os.Args[2])
	case "read":
		read(os.Args[2])
	default:
		fmt.Fprintf(os.Stderr, "unknown subcommand %q\n", os.Args[1])
		os.Exit(2)
	}
}

// hog allocates size bytes and touches every page, so memory.max is reached
// for real instead of being satisfied by lazy allocation.
func hog(size string) {
	n, err := parseSize(size)
	if err != nil {
		fmt.Fprintf(os.Stderr, "hog: %v\n", err)
		os.Exit(2)
	}
	buf := make([]byte, n)
	for i := 0; i < len(buf); i += 4096 {
		buf[i] = byte(i)
	}
	fmt.Fprintf(os.Stderr, "hog: allocated %d bytes without being killed\n", n)
	os.Exit(0)
}

func read(path string) {
	data, err := os.ReadFile(path)
	if err != nil {
		// Print the raw kernel error: EACCES vs EXDEV vs EPERM matters for the
		// acceptance check, and wrapping it would hide that.
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	os.Stdout.Write(data)
}

func parseSize(s string) (int, error) {
	s = strings.TrimSpace(s)
	mult := 1
	switch {
	case strings.HasSuffix(s, "GiB"):
		mult, s = 1<<30, strings.TrimSuffix(s, "GiB")
	case strings.HasSuffix(s, "MiB"):
		mult, s = 1<<20, strings.TrimSuffix(s, "MiB")
	case strings.HasSuffix(s, "KiB"):
		mult, s = 1<<10, strings.TrimSuffix(s, "KiB")
	}
	v, err := strconv.Atoi(strings.TrimSpace(s))
	if err != nil {
		return 0, fmt.Errorf("bad size %q", s)
	}
	return v * mult, nil
}
