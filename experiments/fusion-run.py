#!/usr/bin/env python3
"""Run one prompt through Copilot CLI's HydraFusion research preview and report what it routed to and what it cost.

    python3 experiments/fusion-run.py --dir <git clone to work in> --prompt-file <file> [--prompt-file <next turn>]... --out <dir> [--timeout-sec 2400]

Several --prompt-file options are sent as consecutive turns of one session, each after the previous one has finished.

HydraFusion cannot be reached with `copilot -p` (CLI 1.0.86): `--model hydrafusion` is refused, and as the default
model it silently falls back to another model with no fusion events. So this drives the interactive CLI in a
pseudo-terminal: it selects the model with /model, types the prompt, and reads the routing pattern, the models and
the credits from the session's own event log under ~/.copilot/session-state. It stops without sending the prompt
if the model change is not confirmed in that log, so it never bills another model by mistake.
"""
import fcntl, json, os, pty, re, select, signal, struct, sys, termios, time, uuid


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def main():
    work, out = os.path.abspath(arg('--dir')), os.path.abspath(arg('--out'))
    prompts = [' '.join(open(sys.argv[i + 1]).read().split()) for i, a in enumerate(sys.argv) if a == '--prompt-file']
    timeout, model = float(arg('--timeout-sec', '2400')), arg('--model', 'hydrafusion')
    os.makedirs(out, exist_ok=True)
    session = str(uuid.uuid4())
    events_file = os.path.expanduser(f'~/.copilot/session-state/{session}/events.jsonl')
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(work)
        os.execvp(os.environ.get('LADDER_COPILOT_BIN', 'copilot'),
                  ['copilot', f'--session-id={session}', '--allow-all-tools', '--allow-all-paths', '--experimental'])
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 50, 160, 0, 0))
    screen = open(os.path.join(out, 'screen.log'), 'wb')
    seen = b''

    def pump(seconds):
        nonlocal seen
        end = time.time() + seconds
        while time.time() < end:
            if select.select([fd], [], [], 0.2)[0]:
                try:
                    chunk = os.read(fd, 65536)
                except OSError:
                    return
                screen.write(chunk); screen.flush()
                seen = (seen + chunk)[-20000:]

    def events():
        # The CLI appends to this file while we read it, so the last line can be half written.
        found = []
        try:
            for line in open(events_file):
                try:
                    found.append(json.loads(line))
                except ValueError:
                    pass
        except FileNotFoundError:
            pass
        return found

    def typed(text):
        for ch in text:
            os.write(fd, ch.encode()); time.sleep(0.004)
        time.sleep(1.5); os.write(fd, b'\r')

    def stop(message, code):
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        print(message)
        sys.exit(code)

    pump(12)
    if re.search(rb'trust', seen, re.I):
        os.write(fd, b'\r'); pump(6)
    typed(f'/model {model}'); pump(6)
    # The event log is only written once the first prompt is sent, so before that the screen is the evidence.
    changed = lambda: re.search(rb'Model changed from .{0,80} to HydraFusion', re.sub(rb'\x1b\[[0-9;?]*[A-Za-z]', b'', seen)) \
        or any(e['type'] == 'session.model_change' and e['data'].get('newModel') == model for e in events())
    if not changed():
        stop(f'fusion-run: the model change to {model} was not confirmed; nothing was sent. See {out}/screen.log', 1)

    started = time.time()
    for turn, prompt in enumerate(prompts, 1):
        sent_before = sum(e['type'] == 'user.message' for e in events())
        typed(prompt)
        # A long prompt typed quickly is taken as a paste, and an Enter that follows too closely is swallowed with it.
        # The event log says whether the prompt was really submitted; press Enter again until it was.
        for _ in range(5):
            pump(4)
            if sum(e['type'] == 'user.message' for e in events()) > sent_before:
                break
            os.write(fd, b'\r')
        else:
            stop(f'fusion-run: turn {turn} was typed but never submitted. See {out}/screen.log', 1)
        quiet_since, size = None, -1
        while time.time() - started < timeout:
            pump(3)
            log = events()
            # A turn is over when its own completion is logged and the log has been quiet for a while.
            done = sum(e['type'] == 'session.fusion_completed' for e in log) >= turn
            if len(log) != size:
                size, quiet_since = len(log), time.time()
            if done and time.time() - quiet_since > 25:
                break
    seconds = round(time.time() - started)
    typed('/exit'); pump(5)
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass

    log = events()
    if not any(e['type'] == 'session.fusion_resolved' for e in log):
        print('fusion-run: WARNING, the session log has no fusion events; this run did not go through HydraFusion.')
    with open(os.path.join(out, 'events.jsonl'), 'w') as copy:
        copy.writelines(json.dumps(e) + '\n' for e in log)
    resolved = [e['data'] for e in log if e['type'] == 'session.fusion_resolved']
    phases = [e['data'] for e in log if e['type'] == 'assistant.fusion_phase_completed']
    completed = [e['data'] for e in log if e['type'] == 'session.fusion_completed']
    report = {
        'session': session, 'seconds': seconds, 'finished': bool(completed) and time.time() - started < timeout,
        'turns': [{'pattern': r.get('pattern'), 'policy': r.get('policy'), 'primaryModel': r.get('primaryModel'), 'secondaryModel': r.get('secondaryModel')} for r in resolved],
        'phases': [{'kind': p.get('phaseKind'), 'role': p.get('role'), 'model': p.get('model'), 'status': p.get('status'), 'verdict': p.get('verdict'),
                    'credits': (p.get('usage') or {}).get('totalNanoAiu', 0) / 1e9, 'requests': (p.get('usage') or {}).get('requestCount')} for p in phases],
        'outcomes': [c.get('outcome') for c in completed], 'degraded': [c.get('degradedReason') for c in completed if c.get('degradedReason')],
    }
    report['credits'] = sum(p['credits'] for p in report['phases'])
    # Turns after the first may not be routed again; what actually answered them is in the plain model events.
    report['userTurns'] = sum(e['type'] == 'user.message' for e in log)
    report['modelsSeen'] = sorted({e['data'].get('model') for e in log if e['type'] in ('model.turn_started', 'model.model_call_started') and e['data'].get('model')})
    report['followUpModels'] = [r.get('followUpModel') for r in resolved]
    json.dump(report, open(os.path.join(out, 'fusion-report.json'), 'w'), indent=2)
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
