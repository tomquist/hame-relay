# Memory measurement rig

Runs the relay, unmodified, against a local stand-in for everything it talks
to, and samples its memory (RSS from `/proc`) and CPU time once a second.

- `env.mjs`: a fake Hame cloud API (`https://eu.hamedata.com`, mapped to
  127.0.0.1), the local MQTT broker (`:1883`) and two cloud MQTT brokers with
  mutual TLS (`:8883`, `:8884`). Simulated apps and devices on both sides are
  driven by what the relay subscribes to, so both forwarding directions carry
  traffic. An outage cuts only the relay off from the cloud brokers.
- `measure.mjs`: starts `env.mjs` and the relay, samples it, and writes
  `results/<label>.json` and the relay's log to `results/<label>.log`. The
  message counters double as a functional check: every poll should reach the
  simulated device, and every reply should come back.
- `suite.sh`: the scenarios below. `summary.mjs`: averages them per tag.

| scenario | devices | poll interval | duration | notes |
|---|---|---|---|---|
| steady | 6 | 1 s | 150 s | |
| heavy | 50 | 200 ms | 120 s | |
| outage | 6 | 1 s | 240 s | cloud unreachable from 30 s to 180 s |
| debug | 6 | 1 s | 90 s | `LOG_LEVEL=debug` |

## Usage

Linux only, as root (it binds port 443 and adds `eu.hamedata.com` to
`/etc/hosts`), so use a throwaway VM or container.

```bash
bench/memory/setup.sh                 # certificates, dependencies, hosts entry
npm run build                         # the relay build to measure
bench/memory/suite.sh mine 2          # every scenario, twice
node bench/memory/summary.mjs mine
```

`REPO=<checkout>` measures another checkout's `dist/` (to compare against a
baseline), `RELAY_IMAGE=<image>` runs a Docker image with its own command
line, and `RELAY_NODE_ARGS` passes extra flags to `node`. A single scenario:

```bash
DEVICES=6 POLL_MS=1000 OUTAGE_AT_S=30 OUTAGE_FOR_S=900 node bench/memory/measure.mjs long-outage 1000
```
