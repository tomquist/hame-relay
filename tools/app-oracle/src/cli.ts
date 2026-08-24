#!/usr/bin/env -S npx tsx
import { existsSync, readFileSync } from "fs";
import { diff } from "./diff.js";
import { type Metadata, paths } from "./env.js";
import { doctor } from "./doctor.js";
import { extract } from "./extract.js";
import { pull } from "./pull.js";
import { report, reportPath } from "./report.js";

const USAGE = `app-oracle — check src/device_matrix.ts against the shipped Marstek app

Optional maintainer tooling, not part of the relay. Whether you may run it
depends on your jurisdiction and the licence you accepted; read
tools/app-oracle/README.md and the interoperability statement first. Run it at
your own risk.

Usage: npx tsx tools/app-oracle/src/cli.ts <command> [options]

Commands:
  doctor                 Check host prerequisites and what is already cached
  pull [--version V]     Download the app and unpack its native libraries
       [--apk PATH]      Use a locally downloaded XAPK/APK instead
  extract                Disassemble libapp.so with blutter
  report                 Read the routing rules out of the disassembly
  diff                   Compare the report against src/device_matrix.ts
  all                    pull + extract + report + diff

Everything derived from the app stays in tools/app-oracle/work (gitignored).
Only the derived table in tools/app-oracle/results is meant to be committed.
`;

/**
 * Which app version to compare. Defaults to the one in the work directory, so
 * `report` followed by `diff` needs no arguments.
 */
function reportVersion(args: string[]): string {
  const explicit = flag(args, "version");
  if (explicit) {
    return explicit;
  }
  if (existsSync(paths.metadata)) {
    return (JSON.parse(readFileSync(paths.metadata, "utf8")) as Metadata)
      .appVersion;
  }
  throw new Error("No app version known; pass --version or --report");
}

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
}

async function main(): Promise<number> {
  const [command = "", ...args] = process.argv.slice(2);
  switch (command) {
    case "doctor": {
      return await doctor();
    }
    case "pull": {
      await pull({ version: flag(args, "version"), apk: flag(args, "apk") });
      return 0;
    }
    case "extract": {
      await extract();
      return 0;
    }
    case "report": {
      report();
      return 0;
    }
    case "diff": {
      const file = flag(args, "report");
      return diff(file ?? reportPath(reportVersion(args)));
    }
    case "all": {
      const metadata = await pull({
        version: flag(args, "version"),
        apk: flag(args, "apk"),
      });
      await extract();
      report();
      return diff(reportPath(metadata.appVersion));
    }
    default: {
      console.log(USAGE);
      return command === "" || command === "help" || command === "--help"
        ? 0
        : 1;
    }
  }
}

process.exitCode = await main();
