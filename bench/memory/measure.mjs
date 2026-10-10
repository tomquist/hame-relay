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

function fail(message) {
  console.error(`${label}: ${message}`);
  env?.kill();
  if (IMAGE) spawnSync("docker", ["rm", "-f", "relay-meas"]);
  else relay?.kill();
  process.exit(1);
}

const STARTUP_TIMEOUT_MS = 60_000;
let finishing = false;
const IMAGE = process.env.RELAY_IMAGE;
let relay;
const env = fork(`${dir}env.mjs`, { stdio: ["ignore", "inherit", "inherit", "ipc"] });
let counters = {};
env.on("message", (m) => m.counters && (counters = m.counters));
await new Promise((resolve) => {
  const timer = setTimeout(() => fail("environment did not become ready"), STARTUP_TIMEOUT_MS);
  env.on("message", (m) => m.ready && (clearTimeout(timer), resolve()));
  env.on("error", (error) => fail(`environment failed: ${error.message}`));
  env.on("exit", (code) => finishing || fail(`environment exited (code ${code})`));
});

const relayArgs = (process.env.RELAY_NODE_ARGS ?? "").split(" ").filter(Boolean);
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
  let exited = false;
  relay.on("exit", () => (exited = true));
  relay.on("error", (error) => fail(`docker failed: ${error.message}`));
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  let pid = 0;
  while (!pid) {
    if (exited) fail("container exited before it started");
    if (Date.now() > deadline) fail("container did not start");
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
finishing = true;
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
// A run that carried no traffic did not measure the workload: whatever its
// memory looks like, it is not a result. The log is kept for diagnosis.
if (!(result.app_sent > 0 && result.cloud_app_recv > 0 && result.device_recv > 0)) {
  fail(
    `no traffic forwarded (sent ${result.app_sent}, delivered ${result.cloud_app_recv}, replies ${result.device_recv}); see results/${label}.log`,
  );
}
// Traffic from before an outage says nothing about whether the relay came
// back: replies must flow again once the cloud is reachable. The grace period
// covers reconnecting and the clocks of this script and env.mjs being offset.
const OUTAGE_AT_S = Number(process.env.OUTAGE_AT_S ?? 0);
const OUTAGE_FOR_S = Number(process.env.OUTAGE_FOR_S ?? 0);
if (OUTAGE_FOR_S > 0) {
  const recoveredBy = OUTAGE_AT_S + OUTAGE_FOR_S + 10;
  const recovered = samples.find((x) => x.t >= recoveredBy);
  if (!recovered || recovered === last) {
    fail(`run ends before the relay could recover from the outage (needs > ${recoveredBy} s)`);
  }
  if (!(last.deviceRecv > recovered.deviceRecv)) {
    fail(`no replies forwarded after the outage ended; see results/${label}.log`);
  }
}
writeFileSync(`${dir}results/${label}.json`, JSON.stringify({ result, samples }, null, 1));
const fmt = (v) => (typeof v === "number" && !Number.isInteger(v) ? v.toFixed(1) : v);
console.log(Object.entries(result).map(([k, v]) => `${k}=${fmt(v)}`).join(" "));
process.exit(0);
