#!/bin/sh
set -eu
umask 077
case "${SSH_ORIGINAL_COMMAND-}" in
  picard-compute-identity-v1) action=identity ;;
  picard-compute-execute-v1) action=execute ;;
  picard-compute-lookup-v1) action=lookup ;;
  *) exit 64 ;;
esac
# Install only after reviewing the dedicated account, forced key and memory limit.
# The caller cannot choose a command, executable, filesystem path or environment.
exec /usr/bin/timeout --signal=KILL 10s /usr/bin/prlimit --cpu=3:3 --nofile=64:64 -- \
  /opt/picard-compute-worker/node --jitless --max-old-space-size=32 \
  /opt/picard-compute-worker/src/oracle-worker.mjs "$action" \
  /var/lib/picard-compute-worker/ledger.sqlite /var/lib/picard-compute-worker/policy.json
