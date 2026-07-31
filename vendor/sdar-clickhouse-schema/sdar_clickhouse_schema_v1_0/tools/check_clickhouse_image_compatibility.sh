#!/usr/bin/env bash
set -uo pipefail

IMAGE="${CLICKHOUSE_IMAGE:-clickhouse/clickhouse-server:${CLICKHOUSE_VERSION:-25.3.10.19}}"
HOST_ARCH="$(uname -m)"
DOCKER_ARCH="$(docker info --format '{{.Architecture}}' 2>/dev/null || echo unknown)"
TMP_OUT="$(mktemp)"
trap 'rm -f "$TMP_OUT"' EXIT

echo "Host architecture:   ${HOST_ARCH}"
echo "Docker architecture: ${DOCKER_ARCH}"
echo "ClickHouse image:    ${IMAGE}"
echo

echo "[1/2] Testing the native image selected by Docker..."
set +e
docker run --rm --entrypoint clickhouse "$IMAGE" \
  local --query "SELECT 1" >"$TMP_OUT" 2>&1
STATUS=$?
set -e

if [[ $STATUS -eq 0 ]]; then
  echo "PASS: native ClickHouse image is executable on this CPU."
  cat "$TMP_OUT"
  exit 0
fi

cat "$TMP_OUT" >&2

echo >&2
if [[ $STATUS -eq 132 ]] || grep -qiE 'illegal instruction|signal 4|SIGILL' "$TMP_OUT"; then
  echo "FAIL: ClickHouse terminated with an unsupported CPU instruction (SIGILL)." >&2
else
  echo "FAIL: native image test failed with exit code ${STATUS}." >&2
fi

case "$HOST_ARCH" in
  aarch64|arm64)
    cat >&2 <<'EOF'
The official arm64 image requires ARMv8.2-A plus RCpc support. Some ARM boards
and VMs do not expose those instructions. For development or schema validation,
try the amd64 image under emulation:

  docker run --rm --platform linux/amd64 --entrypoint clickhouse \
    clickhouse/clickhouse-server:25.3.10.19 \
    local --query "SELECT 1"

If that succeeds, start this package with:

  docker compose -f compose.yaml -f compose.amd64-emulation.yaml up -d

If Docker reports "exec format error", install binfmt/QEMU support first, for
example on Ubuntu:

  sudo apt-get update
  sudo apt-get install -y qemu-user-static binfmt-support
  sudo systemctl restart docker

CPU emulation is intended for development/testing only. Use a supported native
ARM host or an amd64 host for production.
EOF
    ;;
  x86_64|amd64)
    if grep -qw pni /proc/cpuinfo 2>/dev/null; then
      echo "SSE3 (Linux flag: pni) is visible; check whether a nested VM or emulator is masking other CPU behavior." >&2
    else
      cat >&2 <<'EOF'
The official amd64 image requires SSE3. Linux reports SSE3 as the `pni` flag,
and it is not visible to this host. On a VM, configure the virtual CPU as
`host`/`host-passthrough`; otherwise use newer hardware.
EOF
    fi
    ;;
  *)
    echo "Unsupported or unexpected host architecture: ${HOST_ARCH}" >&2
    ;;
esac

exit 1
