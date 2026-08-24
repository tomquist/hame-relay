import { spawn, type SpawnOptions } from "child_process";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs a command, streaming to the console while also capturing the output.
 * Long steps (a Dart VM build, an APK download) must show progress, and the
 * captured text is what the steps parse afterwards.
 */
export async function run(
  cmd: string,
  args: string[],
  options: SpawnOptions & { quiet?: boolean } = {},
): Promise<RunResult> {
  const { quiet, ...spawnOptions } = options;
  return await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...spawnOptions, stdio: "pipe" });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (!quiet) {
        process.stdout.write(chunk);
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (!quiet) {
        process.stderr.write(chunk);
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

export async function runOrThrow(
  cmd: string,
  args: string[],
  options: SpawnOptions & { quiet?: boolean } = {},
): Promise<RunResult> {
  const result = await run(cmd, args, options);
  if (result.code !== 0) {
    throw new Error(
      `${cmd} ${args.join(" ")} exited with ${result.code}\n${result.stderr.slice(-2000)}`,
    );
  }
  return result;
}

export async function which(cmd: string): Promise<string | null> {
  const result = await run("sh", ["-c", `command -v ${cmd}`], { quiet: true });
  return result.code === 0 ? result.stdout.trim() : null;
}
