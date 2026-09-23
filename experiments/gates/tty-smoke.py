#!/usr/bin/env python3
"""Gate step for terminal programs: start the command in a real pseudo-terminal and fail if it does not stay up.

    python3 experiments/gates/tty-smoke.py [--seconds 4] [--keys wws] -- python3 -m pong

Unit tests that inject a fake terminal cannot see a program that dies on its first real write. This can: it fails
when the command exits before the time is up or prints a traceback. It spends no credits.
"""
import fcntl, os, pty, select, signal, struct, sys, termios, time


def main(argv):
    if '--' not in argv:
        sys.exit(__doc__)
    options, command = argv[:argv.index('--')], argv[argv.index('--') + 1:]
    value = lambda name, default: options[options.index(name) + 1] if name in options else default
    seconds, keys = float(value('--seconds', '4')), value('--keys', '')
    pid, fd = pty.fork()
    if pid == 0:
        os.environ.setdefault('TERM', 'xterm-256color')
        os.execvp(command[0], command)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 120, 0, 0))
    output, started, typed, status = b'', time.time(), False, None
    while time.time() - started < seconds and status is None:
        if select.select([fd], [], [], 0.1)[0]:
            try:
                output += os.read(fd, 65536)
            except OSError:
                pass
        if keys and not typed and time.time() - started > seconds / 2:
            typed = True
            try:
                os.write(fd, keys.encode())
            except OSError:
                pass
        done, code = os.waitpid(pid, os.WNOHANG)
        status = code if done else None
    if status is None:
        os.kill(pid, signal.SIGKILL)
        os.waitpid(pid, 0)
    text = output.decode(errors='replace')
    if status is not None or 'Traceback (most recent call last)' in text:
        print(f"tty-smoke: FAILED, {'exited early' if status is not None else 'printed a traceback'}: {' '.join(command)}")
        print(text[-1500:])
        return 1
    print(f"tty-smoke: still running after {seconds:g}s: {' '.join(command)}")
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
