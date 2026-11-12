# Set up your Picard Relay

Run Picard on a Linux machine you already have. The guided setup installs the
runtime and HTTPS services, creates private storage, and connects your Groq Free
project. Then you create your sign-in and send a useful first request.

![Choose a host, run guided setup, create your sign-in, then save your first answer](images/setup-path.svg)

## 1. Have these ready

- A **fresh Ubuntu 22.04/24.04 or Oracle Linux 9 machine**, x86-64 or ARM64,
  running systemd. You need terminal access with `sudo`, Git, curl, tar and xz.
  This path uses the machine you already own; it does not create a cloud account
  or machine. Check that your existing host and network are free to use.
- A **hostname pointing to that machine**. Your DNS provider's A record points
  to its public IPv4 address. If you publish an AAAA record, IPv6 must also reach
  this machine. Allow inbound **TCP 80 and 443** in its existing cloud and host
  firewall. Keep SSH restricted to your own addresses. The installer does not
  edit network rules or disable SELinux.
- A **Groq Free project and a key from that same project**. In
  [Groq Console](https://console.groq.com/), check the project's plan, copy its
  organization/project IDs, and create or select its API key. Do not upgrade
  the plan or enable paid usage. Keep the key in your private terminal; never
  put it in chat, a command, a screenshot or a Git commit.

This is fresh-host setup. If Picard, a web server, or a previous setup attempt
already uses the target paths, users or ports, it stops. Use
[existing-host operations](OPERATIONS.md) for an existing relay.

## 2. Run guided setup

In the Linux machine's terminal:

```sh
git clone https://github.com/bmartynowicz/picard-relay.git
cd picard-relay
sudo bash scripts/setup-linux.sh
```

Use a reviewed checkout from this repository. The script downloads pinned
official Node.js 24.22.1 and Caddy 2.11.9 binaries, checks their SHA-256 hashes,
and asks for your hostname and Free-project details. **The key is hidden while
you enter it.** Review the destination and type `install` to continue.

It creates the `picard-relay` and `picard-relay-web` service users, the two
systemd services, and these directories:

| Location | Contains |
| --- | --- |
| `/opt/picard-relay` | Read-only runtime, private copies of Node/Caddy, proxy configuration and source-file hashes |
| `/etc/picard-relay` | Protected key, Free-project confirmation and admission policy |
| `/var/lib/picard-relay` | Private owner sign-in, SQLite workspace and consumed-call markers |
| `/var/lib/picard-relay-web` | HTTPS certificates and Caddy state |

There is no npm install, container, extra browser library, or setup polling
service on the host. Setup makes **no AI call**. A Free-plan confirmation is
recorded evidence from you, not a live billing guarantee.

## 3. Create your sign-in

Open the printed **HTTPS address**. In the terminal, read your private setup code:

```sh
sudo cat /etc/picard-relay/first-sign-in.txt
```

Enter the code and choose your owner password in Picard. The code expires after
one hour and cannot create another owner after it has been used. Keep the code
private. When sign-in is complete you can remove only that note:

```sh
sudo rm -- /etc/picard-relay/first-sign-in.txt
```

If the browser shows a certificate warning, stop and check the hostname/DNS and
TCP 80/443. Caddy obtains its certificate automatically when those are reachable.
Never enter the key or owner password through an HTTP page or bypass a warning.

## 4. Save your first useful answer

Choose **New request**, paste a short rough note, and ask Picard to turn it into
a checklist. Review the exact brief and approve it yourself. Open the saved
answer, copy what is useful, and record your review. Follow the
[first-request walkthrough](QUICKSTART.md#run-your-first-useful-request) for a
ready-to-use example. **Rank guide** explains the unlocks; **Settings → Replay
walkthrough** brings the steps back later.

## If setup stops

Setup preserves partial files and identities instead of deleting or replacing
them. A rerun refuses them. Do not wipe the database, markers, policy or owner
state to make the error disappear.

For a service problem, inspect `sudo systemctl status picard-relay
picard-relay-web` and the corresponding journal privately. Share only a
sanitized error, never credential files or owner state. If startup fails after
this attempt starts services, it stops/disables both; partial installation stays
available for investigation. A public HTTPS check can remain pending after the
services start, usually requiring DNS/network diagnosis rather than reinstalling.

If the one-hour code expires before owner setup, the bootstrap must be reviewed
and renewed by an operator **only after confirming no owner was created**.
There is no automatic owner reset or destructive retry path.

## Qualification and limits

This is a **fresh-host setup candidate**, separate from the already deployed
relay. Its generated configuration is checked against the production validators.
The Linux fixture uses real ownership and file modes, runs as an unprivileged
service UID, and exercises first sign-in, exact approval, one synthetic answer
and saved-result recovery after restart. That fixture does not obtain a public
certificate, install host services, prove a real Free key, or qualify every
distribution/architecture. Full fresh-machine/systemd/HTTPS acceptance remains a
separate target check; do not describe this candidate as a universally qualified
installer.

The first version installs reviewed source. It does **not** enroll the signed
host updater, the **Update** button, or the **Replace key** host socket. Runtime
version may show unknown until release identity is enrolled. See
[updates](OWNER-UPDATES.md) and [operations](OPERATIONS.md) for those separate
host capabilities. Existing relay upgrades, migrations and credential replacement
are outside this command. It refuses existing users, paths and occupied ports.

Model work remains fixed to Groq `openai/gpt-oss-20b`, one exact approval per
call, at most 4096 output tokens, no model tools, retries, code execution or paid
fallback. Keep your host's own billing controls in place.
