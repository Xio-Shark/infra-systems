//go:build linux

package main

import (
	"fmt"
	"os"
	"syscall"
)

// doBind tries to bind-mount /etc into /tmp: it needs CAP_SYS_ADMIN, so a
// dropped bounding set or a seccomp filter turns it into EPERM.
func doBind() {
	os.MkdirAll("/tmp/aos3-bind", 0o755)
	if err := syscall.Mount("/etc", "/tmp/aos3-bind", "", syscall.MS_BIND, ""); err != nil {
		reportErr(err, "mount")
		return
	}
	fmt.Println("ESCAPED bind mount succeeded")
}
