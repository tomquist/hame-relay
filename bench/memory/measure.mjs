// Runs the relay against env.mjs and samples its memory and CPU once a second.
// Usage: node measure.mjs <label> [durationSeconds]
// Env passed through to env.mjs: DEVICES, POLL_MS, OUTAGE_AT_S, OUTAGE_FOR_S
// REPO: checkout whose dist/main.js to run (default: this repository)
// RELAY_NODE_ARGS: extra node flags for that run; LOG_LEVEL for the relay
// RELAY_IMAGE: run this Docker image (with its own CMD) instead of REPO
import { fork, spawn, spawnSync } from "child_process";
import { readFileSync, writeFileSync, createWriteStream, mkdirSync } from "fs";

const dir = new URL(".", import.meta.url).pathname;
const REPO = process.env.REPO ?? new URL("../..", import.meta.url).pathname;
const label = process.argv[2] ?? "run";
const duration = Number(process.argv[3] ?? 120);
mkdirSync(`${dir}results`, { recursive: true });
const work = `${dir}work/`;
mkdirSync(work, { recursive: true });

writeFileSync(
  `${work}brokers.json`,
  readFileSync(`${REPO}/brokers.json`, "utf8")
    .replaceAll("@certs/hame-2024.crt", "@certs/client.crt")
    .replaceAll("@certs/hame-2025.crt", "@certs/client.crt")
    .replaceAll("@certs/hame-2024.key", "@certs/client.key")
    .replaceAll("@certs/hame-2025.key", "@certs/client.key"),
);
writeFileSync(
  `${work}config.json`,
  JSON.stringify({
    broker_url: "mqtt://localhost:1883",
    username: "user@example.com",
    password: "secret",
  }),
);

const env = fork(`${dir}env.mjs`, { stdio: ["ignore", "inherit", "inherit", "ipc"] });
let counters = {};
await new Promise((r) => env.on("message", (m) => (m.ready ? r() : (counters = m.counters))));
env.on("message", (m) => m.counters && (counters = m.counters));

const relayArgs = (process.env.RELAY_NODE_ARGS ?? "").split(" ").filter(Boolean);
const IMAGE = process.env.RELAY_IMAGE;
let relay;
if (IMAGE) {
  // Run the shipped image as is (its own CMD), against the rig.
  spawnSync("docker", ["rm", "-f", "relay-meas"]);
  relay = spawn("docker", [
    "run", "--rm", "--name", "relay-meas", "--network", "host",
    "--add-host", "eu.hamedata.com:127.0.0.1",
    "-v", `${work}:/rig:ro`,
    "-e", "CONFIG_PATH=/rig/config.json", "-e", "BROKERS_PATH=/rig/brokers.json",
    "-e", "NODE_EXTRA_CA_CERTS=/rig/certs/ca.crt",
    "-e", `LOG_LEVEL=${process.env.LOG_LEVEL ?? "info"}`,
    IMAGE,
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let pid = 0;
  while (!pid) {
    await new Promise((r) => setTimeout(r, 100));
    pid = Number(spawnSync("docker", ["inspect", "-f", "{{.State.Pid}}", "relay-meas"]).stdout?.toString().trim() || 0);
  }
  relay.dockerPid = pid;
  console.log("container cmdline:", readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " "));
} else {
  relay = spawn(process.execPath, [...relayArgs, "dist/main.js"], {
    cwd: REPO,
    env: {
      ...process.env,
      CONFIG_PATH: `${work}config.json`,
      BROKERS_PATH: `${work}brokers.json`,
      NODE_EXTRA_CA_CERTS: `${work}certs/ca.crt`,
      LOG_LEVEL: process.env.LOG_LEVEL ?? "info",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}
const relayPid = () => relay.dockerPid ?? relay.pid;
const log = createWriteStream(`${dir}results/${label}.log`);
relay.stdout.pipe(log);
relay.stderr.pipe(log);

function status() {
  const s = readFileSync(`/proc/${relayPid()}/status`, "utf8");
  const kb = (k) => Number(new RegExp(`${k}:\\s+(\\d+)`).exec(s)?.[1] ?? NaN);
  const stat = readFileSync(`/proc/${relayPid()}/stat`, "utf8").split(") ")[1].split(" ");
  const cpu = (Number(stat[11]) + Number(stat[12])) / 100; // utime+stime, seconds
  return { rss: kb("VmRSS") / 1024, hwm: kb("VmHWM") / 1024, threads: kb("Threads"), cpu };
}

const samples = [];
const t0 = Date.now();
let startCounters;
await new Promise((resolve) => {
  const iv = setInterval(() => {
    const t = (Date.now() - t0) / 1000;
    try {
      samples.push({ t, ...status(), ...counters });
    } catch {
      clearInterval(iv);
      resolve();
      return;
    }
    if (!startCounters && t >= 10) startCounters = { ...counters };
    if (t >= duration) {
      clearInterval(iv);
      resolve();
    }
  }, 1000);
});
if (IMAGE) spawnSync("docker", ["kill", "-s", "INT", "relay-meas"]); else relay.kill("SIGINT");
env.kill();

const after = (s) => samples.filter((x) => x.t >= s);
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const steady = after(20);
const last = samples.at(-1);
const result = {
  label,
  duration,
  devices: Number(process.env.DEVICES ?? 6),
  pollMs: Number(process.env.POLL_MS ?? 1000),
  rss_at_10s: samples.find((x) => x.t >= 10)?.rss,
  rss_mean_steady: mean(steady.map((x) => x.rss)),
  rss_end: last.rss,
  rss_peak: last.hwm,
  threads: last.threads,
  cpu_s_after_10s: last.cpu - (samples.find((x) => x.t >= 10)?.cpu ?? 0),
  app_sent: last.appSent - (startCounters?.appSent ?? 0),
  cloud_app_recv: last.cloudAppRecv - (startCounters?.cloudAppRecv ?? 0),
  device_recv: last.deviceRecv - (startCounters?.deviceRecv ?? 0),
};
writeFileSync(`${dir}results/${label}.json`, JSON.stringify({ result, samples }, null, 1));
const fmt = (v) => (typeof v === "number" && !Number.isInteger(v) ? v.toFixed(1) : v);
console.log(Object.entries(result).map(([k, v]) => `${k}=${fmt(v)}`).join(" "));
process.exit(0);
