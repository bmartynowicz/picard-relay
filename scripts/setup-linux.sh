#!/usr/bin/env bash
# Run from a reviewed checkout, not curl | sudo sh. No provider call is made.
set -euo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
if [[ ${1:-} == --help ]]; then
  printf '%s\n' 'Fresh Linux setup: sudo bash scripts/setup-linux.sh' 'Ubuntu 22.04/24.04 or Oracle Linux 9, x86-64/ARM64, systemd.' 'Requires your hostname, inbound TCP 80/443, and an owner-verified Groq Free key.'
  exit 0
fi
check_assets=false
if [[ $# == 1 && $1 == --check-assets ]]; then check_assets=true; fi
if ! $check_assets; then
  [[ $# == 0 && $EUID == 0 && -t 0 && -t 1 ]] || { printf '%s\n' 'Run with sudo from your private interactive terminal.' >&2; exit 1; }
  [[ -d /run/systemd/system ]] || { printf '%s\n' 'A systemd Linux host is required.' >&2; exit 1; }
  if ! { grep -Eq '^ID="?ubuntu"?$' /etc/os-release && grep -Eq '^VERSION_ID="(22\.04|24\.04)"$' /etc/os-release; } && ! { grep -Eq '^ID="?ol"?$' /etc/os-release && grep -Eq '^VERSION_ID="9(\.[0-9]+)?"$' /etc/os-release; }; then
    printf '%s\n' 'Supported hosts: Ubuntu 22.04/24.04 or Oracle Linux 9. Nothing installed.' >&2
    exit 1
  fi
fi
for cmd in curl tar xz sha256sum mktemp install; do command -v "$cmd" >/dev/null || { printf 'Missing prerequisite: %s\n' "$cmd" >&2; exit 1; }; done
for target in /opt/picard-relay /etc/picard-relay /var/lib/picard-relay /var/lib/picard-relay-web /etc/systemd/system/picard-relay.service /etc/systemd/system/picard-relay-web.service; do
  $check_assets && break
  [[ ! -e $target && ! -L $target ]] || { printf '%s\n' 'Existing or partial Picard installation found. Nothing changed.' >&2; exit 1; }
done
case $(uname -m) in
  x86_64) node_arch=x64; caddy_arch=amd64; node_sha=6c172a9ab6718f7b801fb5a7bd486af2ee5e32758086a04b84fcce2aa77095e6; caddy_sha=5b8cb7faf8726a2028ad96a66e54e6e81e8f361bc6175e5d22bbd997cc5177fb ;;
  aarch64) node_arch=arm64; caddy_arch=arm64; node_sha=dbabf7a1cbf947e6059ffad2c27b80041db97dea1e553b62afdee7f13fca336e; caddy_sha=5e377cff994fc9362a6fcf695c53f226cfca3a3ef85bd3a3687cf252d6310165 ;;
  *) printf '%s\n' 'Supported architectures: x86-64 and ARM64.' >&2; exit 1 ;;
esac
setup_source=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
setup_tmp=$(mktemp -d /tmp/picard-setup.XXXXXXXX)
chmod 700 "$setup_tmp"
# Only this mktemp-owned directory is removed; installation/state is never removed.
trap 'rm -rf -- "$setup_tmp"' EXIT
download() { curl --fail --location --silent --show-error --proto '=https' --proto-redir '=https' --tlsv1.2 --connect-timeout 15 --max-time 180 --max-filesize 150000000 --output "$2" "$1"; }
printf '%s\n' 'Fetching pinned official Node.js and Caddy binaries. No AI call or cloud resource is created.'
download "https://nodejs.org/download/release/v24.22.1/node-v24.22.1-linux-${node_arch}.tar.xz" "$setup_tmp/node.tar.xz"
download "https://github.com/caddyserver/caddy/releases/download/v2.11.9/caddy_2.11.9_linux_${caddy_arch}.tar.gz" "$setup_tmp/caddy.tar.gz"
printf '%s  %s\n' "$node_sha" "$setup_tmp/node.tar.xz" "$caddy_sha" "$setup_tmp/caddy.tar.gz" | sha256sum --check --status
# Extract only the named executable from checksum-pinned archives.
tar --extract --xz --file "$setup_tmp/node.tar.xz" --directory "$setup_tmp" --no-same-owner --no-same-permissions "node-v24.22.1-linux-${node_arch}/bin/node"
tar --extract --gzip --file "$setup_tmp/caddy.tar.gz" --directory "$setup_tmp" --no-same-owner --no-same-permissions caddy
if $check_assets; then
  "$setup_tmp/node-v24.22.1-linux-${node_arch}/bin/node" --version
  "$setup_tmp/caddy" version
  "$setup_tmp/caddy" adapt --config "$setup_source/../deploy/Caddyfile.workspace.example" --adapter caddyfile >/dev/null
  printf '%s\n' 'Pinned official assets and proxy syntax checked. No services or provider calls.'
  exit 0
fi
"$setup_tmp/node-v24.22.1-linux-${node_arch}/bin/node" "$setup_source/setup-linux.mjs" "$setup_tmp/node-v24.22.1-linux-${node_arch}/bin/node" "$setup_tmp/caddy"
