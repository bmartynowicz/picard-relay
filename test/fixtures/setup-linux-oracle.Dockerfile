# Official Oracle Linux multi-architecture image, pinned from its public registry.
# Disposable CI qualification only; Docker is not installed on relay hosts.
FROM ghcr.io/oracle/oraclelinux:9@sha256:c9f4ddc5f618a4ede6a11c17702fba1183dbafc56eb181a1ba4d68335e11cec1
RUN dnf -y install --allowerasing systemd sudo shadow-utils util-linux curl tar xz python3 ca-certificates procps-ng iproute && dnf clean all
ENV container=docker GITHUB_ACTIONS=true RUNNER_OS=Linux
STOPSIGNAL SIGRTMIN+3
WORKDIR /workspace
CMD ["/sbin/init"]
