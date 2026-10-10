// Prints a table of averaged results per tag and scenario.
// Usage: node summary.mjs <tag> [<tag>...]
import { readdirSync, readFileSync } from "fs";

const dir = new URL("results/", import.meta.url).pathname;
const tags = process.argv.slice(2);
const fields = ["rss_mean_steady", "rss_peak", "rss_end", "cpu_s_after_10s"];
const rows = {};
for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
  const m = /^(.+)-([a-z0-9]+)-(\d+)\.json$/.exec(f);
  if (!m || !tags.includes(m[1])) continue;
  const { result } = JSON.parse(readFileSync(dir + f, "utf8"));
  (rows[`${m[2]}|${m[1]}`] ??= []).push(result);
}
console.log(["scenario", "tag", "runs", ...fields, "sent", "to_device", "replies"].join("\t"));
for (const key of Object.keys(rows).sort()) {
  const runs = rows[key];
  const avg = (k) => (runs.reduce((a, r) => a + (r[k] ?? NaN), 0) / runs.length).toFixed(1);
  const sum = (k) => runs.reduce((a, r) => a + r[k], 0);
  console.log([...key.split("|"), runs.length, ...fields.map(avg), sum("app_sent"), sum("cloud_app_recv"), sum("device_recv")].join("\t"));
}
