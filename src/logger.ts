import { destination as pinoDestination, pino } from "pino";
import { prettyFactory } from "pino-pretty";

// Pretty-printed in-process rather than through a pino transport: a transport
// runs in a worker thread, a second JavaScript engine instance with a heap of
// its own, which costs 15 to 30 MB depending on the log volume.
//
// Writes are asynchronous, so a log reader that stops draining stdout cannot
// stall the relay, and buffer at most this much while it does; anything past
// that is dropped rather than held in memory. Each line is formatted and
// handed to the destination directly: piping through pino-pretty's stream
// would queue lines without bound in front of it whenever it falls behind.
const MAX_BUFFERED_LOG_BYTES = 1024 * 1024;

const destination = pinoDestination({
  dest: 1,
  sync: false,
  maxLength: MAX_BUFFERED_LOG_BYTES,
});
// A failing log write must not take the relay down. On a closed pipe nobody is
// reading any more, so stop writing altogether.
destination.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") {
    destination.write = () => true;
    destination.flushSync = () => {};
  }
});
// The relay exits through process.exit, often right after logging why; write
// out what is still buffered so that last line is not lost.
process.on("exit", () => {
  try {
    destination.flushSync();
  } catch {
    // Nothing more can be done about it while exiting.
  }
});

const prettify = prettyFactory({
  colorize: false,
  translateTime: "yyyy-mm-dd HH:MM:ss",
  ignore: "pid,hostname",
});

export const logger = pino(
  { level: process.env.LOG_LEVEL || "info" },
  { write: (line: string) => destination.write(prettify(line)) },
);
