"""Actual installer on a disposable GitHub VM; synthetic key, no model request."""
import os
import pty
import select
import signal
import subprocess
import time

if os.environ.get("GITHUB_ACTIONS") != "true" or os.environ.get("RUNNER_OS") != "Linux":
    raise SystemExit("This fixture is only for a disposable GitHub Linux runner.")

# GitHub deliberately makes /opt writable for runner tools. Restore the normal
# root-owned fresh-host parent in this disposable VM, never in the installer.
subprocess.run(["sudo", "-n", "stat", "-c", "%u:%g %a %n", "/", "/opt", "/etc", "/etc/systemd", "/etc/systemd/system", "/var", "/var/lib"], check=True)
subprocess.run(["sudo", "-n", "chown", "root:root", "/opt"], check=True)
subprocess.run(["sudo", "-n", "chmod", "0755", "/opt"], check=True)
subprocess.run(["sudo", "-n", "systemctl", "show", "--property=SystemState", "--value"], check=True)

pid, fd = pty.fork()
if pid == 0:
    os.execvp("sudo", ["sudo", "-n", "bash", "scripts/setup-linux.sh"])

answers = [
    (b"Relay hostname (for example picard.example.com): ", b"picard.localhost"),
    (b"with TCP 80 and 443 allowed? Type yes: ", b"yes"),
    (b"with no paid fallback? Type yes: ", b"yes"),
    (b"A short name for that Groq project: ", b"Synthetic qualification only"),
    (b"Groq organization ID: ", b"org_synthetic_no_provider"),
    (b"Groq project ID: ", b"proj_synthetic_no_provider"),
    (b"Is the key from this same Free project? Type yes: ", b"yes"),
    (b"Groq key (hidden): ", b"gsk_SYNTHETIC_QUALIFICATION_ONLY_NOT_A_KEY"),
    (b"Install on this fresh machine? Type install: ", b"install"),
]
output = b""
index = 0
deadline = time.monotonic() + 180
try:
    while time.monotonic() < deadline:
        readable, _, _ = select.select([fd], [], [], 1)
        if readable:
            try:
                chunk = os.read(fd, 8192)
            except OSError:
                break
            if not chunk:
                break
            output += chunk
            if len(output) > 131072:
                raise RuntimeError("Installer terminal output exceeded fixture bound")
            if index < len(answers) and answers[index][0] in output:
                os.write(fd, answers[index][1] + b"\n")
                index += 1
    else:
        os.kill(pid, signal.SIGTERM)
        raise RuntimeError("Installer did not finish within fixture deadline")
    _, status = os.waitpid(pid, 0)
    safe = output.replace(answers[7][1], b"[SYNTHETIC KEY REDACTED]")
    if os.waitstatus_to_exitcode(status) != 0 or b"Installed. Open https://picard.localhost" not in output:
        raise RuntimeError("Installer failed: " + safe.decode("utf-8", errors="replace")[-5000:])
    if answers[7][1] in output:
        raise RuntimeError("Hidden-key terminal prompt echoed the synthetic key")
    print("Actual guided installer completed; synthetic key stayed hidden; no model request.")
finally:
    os.close(fd)
