// AOS3 test fixture: one binary, one escape case per argv[1].
//
// Every case tries exactly one way to break out of a capability scope and
// prints a single line to stdout:
//
//	DENIED <errno>     the kernel refused (this is what we want)
//	ESCAPED <what>     the operation succeeded (a real escape)
//	ERROR <what>       unexpected error, neither a clean denial nor an escape
//
// `tests/escape.sh` parses that line. Do not wrap the errno: the acceptance
// criterion distinguishes EXDEV (openat2 RESOLVE_BENEATH), EACCES (Landlock)
// and EPERM (seccomp / missing capability).
//
// Build: go build -o testdata/escape ./testdata/escape
// This file is Linux-only; the syscall numbers and syscall.Mount below do not
// exist on other platforms, and the harness only ever runs on Linux.

//go:build linux

package main

import (
	"errors"
	"fmt"
	"os"
	"syscall"
	"unsafe"
)

const (
	sysOpenat2         = 437 // x86_64
	sysProcessVMReadV  = 310 // x86_64
	sysIoUringSetup    = 425 // x86_64
	sysNameToHandleAt  = 303 // x86_64
	sysOpenByHandleAt  = 304 // x86_64
	resolveNoMagiclink = 0x02
	resolveBeneath     = 0x08
)

type openHow struct {
	Flags   uint64
	Mode    uint64
	Resolve uint64
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: escape <case>")
		os.Exit(2)
	}
	switch os.Args[1] {
	case "dotdot":
		viaOpenat2("..")
	case "abs":
		viaOpenat2("/etc/shadow")
	case "symlink":
		// The caller creates "link" in the capability directory pointing outside.
		viaOpenat2("link")
	case "magic":
		viaOpenat2("/proc/self/root/etc/shadow")
	case "procfd":
		viaOpenat2("/proc/self/fd/3/etc/shadow")
	case "fchdir":
		doFchdir()
	case "chroot":
		doChroot()
	case "bind":
		doBind()
	case "ptrace":
		doPtrace()
	case "processvm":
		doProcessVM()
	case "uring":
		doIoUring()
	case "handle":
		doOpenByHandle()
	case "leak":
		doLeakedFD()
	default:
		fmt.Fprintf(os.Stderr, "unknown case %q\n", os.Args[1])
		os.Exit(2)
	}
}

// viaOpenat2 opens path relative to fd 3 (the capability directory passed by the
// broker) with RESOLVE_BENEATH, so anything leaving the subtree fails with EXDEV.
func viaOpenat2(path string) {
	dirfd := uintptr(3)
	p, err := syscall.BytePtrFromString(path)
	if err != nil {
		fmt.Printf("ERROR badpath %v\n", err)
		return
	}
	how := openHow{
		Flags:   uint64(syscall.O_RDONLY | syscall.O_CLOEXEC),
		Resolve: resolveBeneath | resolveNoMagiclink,
	}
	fd, _, errno := syscall.Syscall6(
		sysOpenat2,
		dirfd,
		uintptr(unsafe.Pointer(p)),
		uintptr(unsafe.Pointer(&how)),
		unsafe.Sizeof(how),
		0, 0,
	)
	if errno != 0 {
		report(errno, path)
		return
	}
	syscall.Close(int(fd))
	fmt.Printf("ESCAPED opened %s\n", path)
}

func doFchdir() {
	// A scope that only guards opening is bypassed by fchdir'ing to an
	// already-open directory and then using relative opens.
	fd, err := syscall.Open(".", syscall.O_RDONLY|syscall.O_DIRECTORY, 0)
	if err != nil {
		reportErr(err, "open")
		return
	}
	defer syscall.Close(fd)
	if err := syscall.Fchdir(fd); err != nil {
		reportErr(err, "fchdir")
		return
	}
	fmt.Println("ESCAPED fchdir succeeded")
}

func doChroot() {
	if err := syscall.Chroot("/"); err != nil {
		reportErr(err, "chroot")
		return
	}
	fmt.Println("ESCAPED chroot succeeded")
}

func doPtrace() {
	if err := syscall.PtraceAttach(os.Getpid()); err != nil {
		reportErr(err, "ptrace")
		return
	}
	fmt.Println("ESCAPED ptrace attached")
}

func doProcessVM() {
	buf := make([]byte, 8)
	iov := struct {
		Base uintptr
		Len  uintptr
	}{Base: uintptr(unsafe.Pointer(&buf[0])), Len: uintptr(len(buf))}
	_, _, errno := syscall.Syscall6(
		sysProcessVMReadV,
		uintptr(os.Getpid()), uintptr(unsafe.Pointer(&iov)), 1,
		uintptr(os.Getpid()), uintptr(unsafe.Pointer(&iov)), 0,
	)
	if errno != 0 {
		report(errno, "process_vm_readv")
		return
	}
	fmt.Println("ESCAPED process_vm_readv succeeded")
}

// doOpenByHandle exercises name_to_handle_at + open_by_handle_at, which bypasses
// path-based checks entirely; it needs CAP_DAC_READ_SEARCH, so a container that
// dropped the capability must see EPERM.
func doOpenByHandle() {
	path := "/etc/shadow"
	h := make([]byte, 128)
	hsize := uint32(len(h))
	mountID := int32(0)
	p, err := syscall.BytePtrFromString(path)
	if err != nil {
		fmt.Printf("ERROR badpath %v\n", err)
		return
	}
	if _, _, errno := syscall.Syscall6(sysNameToHandleAt, uintptr(3), uintptr(unsafe.Pointer(p)),
		uintptr(unsafe.Pointer(&h[0])), uintptr(unsafe.Pointer(&hsize)),
		uintptr(unsafe.Pointer(&mountID)), 0); errno != 0 {
		report(errno, "name_to_handle_at")
		return
	}
	fd, _, errno := syscall.Syscall6(sysOpenByHandleAt, uintptr(mountID),
		uintptr(unsafe.Pointer(&h[0])), uintptr(hsize), uintptr(syscall.O_RDONLY), 0, 0)
	if errno != 0 {
		report(errno, "open_by_handle_at")
		return
	}
	syscall.Close(int(fd))
	fmt.Println("ESCAPED open_by_handle_at succeeded")
}

func doIoUring() {
	_, _, errno := syscall.Syscall(sysIoUringSetup, 8, 0, 0)
	if errno != 0 {
		report(errno, "io_uring_setup")
		return
	}
	fmt.Println("ESCAPED io_uring_setup succeeded")
}

// doLeakedFD reads an fd that was inherited without O_CLOEXEC.
func doLeakedFD() {
	buf := make([]byte, 64)
	n, err := syscall.Read(4, buf)
	if err != nil {
		reportErr(err, "read fd 4")
		return
	}
	fmt.Printf("ESCAPED read leaked fd 4 (%d bytes)\n", n)
}

func report(errno syscall.Errno, what string) {
	switch errno {
	case syscall.EACCES, syscall.EPERM, syscall.EXDEV, syscall.ENOENT:
		fmt.Printf("DENIED %s %s\n", errnoName(errno), what)
	default:
		// An unexpected error is not a denial; saying so keeps a broken sandbox
		// from looking like a working one.
		fmt.Printf("ERROR %s %s\n", errnoName(errno), what)
	}
}

func reportErr(err error, what string) {
	var errno syscall.Errno
	if errors.As(err, &errno) {
		report(errno, what)
		return
	}
	fmt.Printf("ERROR %v %s\n", err, what)
}

func errnoName(e syscall.Errno) string {
	switch e {
	case syscall.EACCES:
		return "EACCES"
	case syscall.EPERM:
		return "EPERM"
	case syscall.EXDEV:
		return "EXDEV"
	case syscall.ENOENT:
		return "ENOENT"
	case syscall.EBADF:
		return "EBADF"
	case syscall.EOPNOTSUPP:
		return "EOPNOTSUPP"
	case syscall.ENOSYS:
		return "ENOSYS"
	}
	return e.Error()
}
