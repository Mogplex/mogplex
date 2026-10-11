/** Linux subreaper owns only this command's descendants, including children
 * which start new sessions or outlive their immediate parent. Killing a shell
 * or a process group alone misses both cases. Stop freezes the owned tree
 * before terminating it, then waits for every adopted child to be reaped.
 * Successful commands may intentionally leave background services running.
 */
const COMMAND_SUPERVISOR = String.raw`
import ctypes, os, signal, subprocess, sys

if ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) != 0:
    raise OSError(ctypes.get_errno(), "Could not own command descendants")

class Cancelled(BaseException):
    pass

def cancel(signum, frame):
    raise Cancelled()

def processes():
    result = {}
    for name in os.listdir("/proc"):
        if not name.isdigit():
            continue
        try:
            with open("/proc/" + name + "/stat") as file:
                value = file.read()
            fields = value[value.rfind(")") + 2:].split()
            result[int(name)] = (int(fields[1]), fields[19])
        except (FileNotFoundError, ProcessLookupError):
            pass
    return result

def send(pid, birth, sig):
    # A PID reused after discovery is not part of this command.
    if processes().get(pid, (None, None))[1] == birth:
        try:
            os.kill(pid, sig)
        except ProcessLookupError:
            pass

def stop_children():
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    stopped = {}
    while True:
        table = processes()
        owned = {os.getpid()}
        frontier = [os.getpid()]
        while frontier:
            parent = frontier.pop()
            for pid, (ppid, birth) in table.items():
                if ppid == parent and pid not in owned:
                    owned.add(pid)
                    frontier.append(pid)
        fresh = [(pid, table[pid][1]) for pid in owned if pid != os.getpid()
                 and stopped.get(pid) != table[pid][1]]
        if not fresh:
            break
        # A further discovery pass captures forks made before their parent
        # was frozen and orphans adopted during that pass. No timer or retry.
        for pid, birth in fresh:
            send(pid, birth, signal.SIGSTOP)
            stopped[pid] = birth
    for pid, birth in stopped.items():
        send(pid, birth, signal.SIGKILL)
    while True:
        try:
            os.wait()
        except ChildProcessError:
            break

signal.signal(signal.SIGTERM, cancel)
signal.signal(signal.SIGINT, cancel)
try:
    child = subprocess.Popen(sys.argv[1:], start_new_session=True)
    code = child.wait()
except Cancelled:
    stop_children()
    sys.exit(143)
except BaseException:
    stop_children()
    raise
if code != 0:
    stop_children()
sys.exit(code if code >= 0 else 128 - code)
`;

export function superviseSandboxCommand(cmd: string, args: string[]) {
  return {
    cmd: "python3",
    args: ["-u", "-c", COMMAND_SUPERVISOR, cmd, ...args],
  };
}
