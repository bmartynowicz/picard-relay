"""One disposable native Oracle Linux VM, no cloud account or provider secrets.

Only standard public GitHub CI. Localhost-only SSH; the guest uses Oracle's own
kernel and enforcing SELinux, rather than borrowing the container host kernel.
Local test CA and synthetic model transport do not prove public ACME/real keys.
"""
import hashlib
import json
import os
import pathlib
import subprocess
import tempfile
import time

assert os.environ.get("GITHUB_ACTIONS") == "true"
assert os.uname().sysname == "Linux"
assert os.access("/dev/kvm", os.R_OK | os.W_OK), "Native VM needs accessible KVM"
runner_temp = pathlib.Path(os.environ["RUNNER_TEMP"]).resolve(strict=True)
state = pathlib.Path(tempfile.mkdtemp(prefix="picard-oracle-native-", dir=runner_temp))
assert state.parent == runner_temp
image = state / "oracle.qcow2"
source = pathlib.Path.cwd()
IMAGE_URL = "https://yum.oracle.com/templates/OracleLinux/OL9/u8/x86_64/OL9U8_x86_64-kvm-b293.qcow2"
IMAGE_SHA256 = "b12103391327abee8090686759c0d62dac9a7af2bf0f45fdf6b0d085a0fbb52b"
vm = None


def run(args, timeout=60, **kwargs):
    return subprocess.run(args, check=True, timeout=timeout, **kwargs)


ssh = ["ssh", "-i", str(state / "key"), "-p", "22666", "-o", "BatchMode=yes",
       "-o", "ConnectTimeout=3", "-o", "StrictHostKeyChecking=accept-new",
       "-o", "UserKnownHostsFile=" + str(state / "known_hosts"), "picard-ci@127.0.0.1"]


def guest(command, timeout=60):
    return run(ssh + [command], timeout=timeout)


try:
    run(["curl", "--fail", "--location", "--silent", "--show-error", "--proto", "=https",
         "--proto-redir", "=https", "--connect-timeout", "15", "--max-time", "240",
         "--max-filesize", "3221225472", "--output", str(image), IMAGE_URL], timeout=250)
    with image.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    assert digest == IMAGE_SHA256, "Official Oracle image digest mismatch"
    run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(state / "key")])
    public_key = (state / "key.pub").read_text().strip()
    user_data = """#cloud-config
users:
  - name: picard-ci
    groups: [wheel]
    sudo: ['ALL=(ALL) NOPASSWD:ALL']
    shell: /bin/bash
    lock_passwd: true
    ssh_authorized_keys:
      - %s
ssh_pwauth: false
disable_root: true
""" % public_key
    (state / "user-data").write_text(user_data)
    (state / "meta-data").write_text("instance-id: picard-native-oracle-test\nlocal-hostname: picard-native-oracle-test\n")
    run(["cloud-localds", str(state / "seed.img"), str(state / "user-data"), str(state / "meta-data")])
    # The source image remains immutable; only this ephemeral overlay is written.
    run(["qemu-img", "create", "-f", "qcow2", "-F", "qcow2", "-b", str(image), str(state / "overlay.qcow2")])
    vm = subprocess.Popen([
        "qemu-system-x86_64", "-accel", "kvm", "-cpu", "host", "-smp", "2", "-m", "1024",
        "-machine", "q35", "-drive", "file=" + str(state / "overlay.qcow2") + ",if=virtio,format=qcow2",
        "-drive", "file=" + str(state / "seed.img") + ",if=virtio,format=raw,readonly=on",
        "-netdev", "user,id=n0,hostfwd=tcp:127.0.0.1:22666-:22", "-device", "virtio-net-pci,netdev=n0",
        "-display", "none", "-serial", "file:" + str(state / "serial.log"), "-no-reboot",
    ])
    # Only read-only boot readiness probes repeat. Installation is attempted once.
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        assert vm.poll() is None, "Oracle VM exited before readiness"
        ready = subprocess.run(ssh + ["true"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=6)
        if ready.returncode == 0:
            break
        time.sleep(2)
    else:
        raise RuntimeError("Native Oracle SSH did not become ready")
    # No passwords, production keys, cloud API access, shared folders or network
    # listener outside localhost are supplied to this disposable guest.
    guest("sudo cloud-init status --wait", timeout=180)
    guest("test \"$(getenforce)\" = Enforcing && uname -r && systemd-detect-virt && cat /etc/oracle-release")
    # Log otherwise-suppressed denials in this disposable guest. This grants no
    # permissions and does not turn enforcement off.
    guest("sudo semodule -DB && test \"$(getenforce)\" = Enforcing", timeout=90)
    archive = state / "source.tar"
    with archive.open("wb") as stream:
        run(["git", "archive", "--format=tar", "HEAD"], stdout=stream)
    run(["scp", "-i", str(state / "key"), "-P", "22666", "-o", "BatchMode=yes",
         "-o", "StrictHostKeyChecking=yes", "-o", "UserKnownHostsFile=" + str(state / "known_hosts"),
         str(archive), "picard-ci@127.0.0.1:/tmp/picard-source.tar"], timeout=60)
    guest("sudo mkdir /workspace && sudo tar --no-same-owner -xf /tmp/picard-source.tar -C /workspace")
    browser=os.environ.get('PICARD_NATIVE_BROWSER')=='true'
    terminal='browser-setup-terminal.py' if browser else 'setup-linux-terminal.py'
    installed='browser-setup-installed.mjs' if browser else 'setup-linux-installed.mjs'
    guest("cd /workspace && sudo env GITHUB_ACTIONS=true RUNNER_OS=Linux python3 test/fixtures/"+terminal, timeout=450)
    guest("sudo ps -eo label,pid,comm | grep -E 'node|caddy' || true")
    # Restore the vendor's ordinary audit configuration before exercising the
    # authenticated maintenance flow. Enforcement was never disabled.
    guest("sudo semodule -B && test \"$(getenforce)\" = Enforcing", timeout=90)
    guest("cd /workspace && sudo env GITHUB_ACTIONS=true PICARD_QUALIFICATION_ENV=oraclelinux9-native-kvm /usr/local/lib/board-event-relay/node --jitless test/fixtures/"+installed, timeout=240)
    guest("test \"$(getenforce)\" = Enforcing && uname -r")
    print(json.dumps({"state": "native_oracle_setup_passed", "imageSha256": IMAGE_SHA256,
                      "guestRamMb": 1024, "selinux": "Enforcing", "container": False,
                      "cloudProvisioning": False, "externalModelCalls": 0, "publicAcmeQualified": False}))
finally:
    if vm is not None and vm.poll() is None:
        try:
            guest("sudo journalctl --no-pager -n 45 -u picard-first-run.service -u picard-first-run-activate.service -u board-event-relay.service -u picard-relay-web.service -u picard-updater.service -u 'picard-groq-replacement@*'", timeout=15)
            guest("sudo ls -ldZ /usr/local/lib/board-event-relay /usr/local/lib/board-event-relay/node /etc/board-event-relay /var/lib/board-event-relay; id board-event-relay; sudo systemctl show board-event-relay --property=User,Group,ReadWritePaths,SELinuxContext; sudo ausearch -m AVC,USER_AVC -ts boot | tail -n 70", timeout=15)
        except (subprocess.SubprocessError, OSError):
            pass
        vm.terminate()
        try:
            vm.wait(timeout=10)
        except subprocess.TimeoutExpired:
            vm.kill()
            vm.wait(timeout=5)
    serial = state / "serial.log"
    if serial.exists():
        print("Bounded native VM boot diagnostics:")
        print(serial.read_bytes()[-16000:].decode("utf-8", errors="replace"))
    # The runner deletes its own temporary workspace at job completion. No
    # configured host paths, existing databases, credentials or shared VMs touched.
