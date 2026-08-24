import { existsSync } from "fs";
import { join } from "path";
import { run, which } from "./exec.js";
import { paths } from "./env.js";

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const APT_PACKAGES = [
  "git",
  "curl",
  "unzip",
  "python3",
  "python3-pip",
  "cmake",
  "ninja-build",
  "build-essential",
  "pkg-config",
  "libicu-dev",
  "libcapstone-dev",
];

async function checkCommand(cmd: string): Promise<Check> {
  const path = await which(cmd);
  return { name: cmd, ok: path !== null, detail: path ?? "not found" };
}

async function checkPkgConfig(lib: string): Promise<Check> {
  const result = await run("pkg-config", ["--modversion", lib], {
    quiet: true,
  });
  return {
    name: `${lib} (dev headers)`,
    ok: result.code === 0,
    detail: result.code === 0 ? result.stdout.trim() : "not found",
  };
}

async function checkPythonModule(module: string): Promise<Check> {
  const result = await run("python3", ["-c", `import ${module}`], {
    quiet: true,
  });
  return {
    name: `python3 -m ${module}`,
    ok: result.code === 0,
    detail: result.code === 0 ? "ok" : `pip install ${module}`,
  };
}

/**
 * Reports whether this machine can run the pipeline. Everything here is
 * ordinary build tooling: the oracle reads the app's compiled code, so it needs
 * no emulator, no Android, and no device.
 */
export async function doctor(): Promise<number> {
  const checks: Check[] = [
    ...(await Promise.all(
      ["git", "curl", "unzip", "python3", "cmake", "ninja", "g++"].map((cmd) =>
        checkCommand(cmd),
      ),
    )),
    await checkPkgConfig("icu-uc"),
    await checkPkgConfig("capstone"),
    ...(await Promise.all(
      ["elftools", "requests"].map((module) => checkPythonModule(module)),
    )),
  ];

  const { stdout: dfOut } = await run("sh", ["-c", "df -Pk . | tail -1"], {
    quiet: true,
  });
  const freeGb = Number(dfOut.trim().split(/\s+/u)[3] ?? 0) / 1024 / 1024;
  checks.push(
    {
      name: "free disk",
      ok: freeGb >= 12,
      detail: `${freeGb.toFixed(1)} GiB (need ~12 GiB for the Dart VM build and disassembly)`,
    },
    {
      name: "host arch",
      ok: true,
      detail: `${process.arch} — the app ships arm64 only, but nothing here executes it`,
    },
  );

  for (const check of checks) {
    console.log(
      `${check.ok ? "ok  " : "MISS"}  ${check.name.padEnd(22)} ${check.detail}`,
    );
  }

  const cached = [
    ["app libraries", join(paths.libs, "libapp.so")],
    ["blutter checkout", join(paths.blutter, "blutter.py")],
    ["disassembly", join(paths.asm, "pp.txt")],
  ] as const;
  console.log("");
  for (const [label, path] of cached) {
    console.log(
      `${existsSync(path) ? "have" : "----"}  ${label.padEnd(22)} ${path}`,
    );
  }

  const missing = checks.filter((check) => !check.ok);
  if (missing.length > 0) {
    console.log(`\nMissing: ${missing.map((m) => m.name).join(", ")}`);
    console.log(
      `On Debian/Ubuntu: apt-get install -y ${APT_PACKAGES.join(" ")}`,
    );
    console.log("and: pip install pyelftools requests");
    return 1;
  }
  console.log("\nAll prerequisites present.");
  return 0;
}
