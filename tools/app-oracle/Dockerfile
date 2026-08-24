# Runs the app-oracle pipeline on any machine with Docker, including hosts that
# have no build toolchain. Nothing from the Marstek app is baked in: the image
# carries only the tooling, and "pull" fetches the app at run time into the
# mounted work directory.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git unzip \
      python3 python3-pip \
      cmake ninja-build build-essential pkg-config \
      libicu-dev libcapstone-dev \
    && rm -rf /var/lib/apt/lists/*

# blutter's helper scripts read the ELF and query the Dart SDK release index.
RUN pip3 install --no-cache-dir --break-system-packages pyelftools requests

# Node runs the CLI itself; it shares the repository's TypeScript sources.
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /repo

# The work directory holds the app archive, the extracted libraries and the
# disassembly. Mount it to keep the multi-gigabyte Dart VM build between runs.
ENV ORACLE_WORK_DIR=/work
VOLUME ["/work"]

ENTRYPOINT ["npx", "tsx", "tools/app-oracle/src/cli.ts"]
CMD ["doctor"]
