import { pino } from "pino";
import pretty from "pino-pretty";

// Pretty-printed in-process rather than through a pino transport: a transport
// runs in a worker thread, which is a second JavaScript engine instance and
// costs more memory than the rest of the relay put together. Writes are
// synchronous so nothing is lost when the process exits right after logging.
export const logger = pino(
  { level: process.env.LOG_LEVEL || "info" },
  pretty({
    colorize: false,
    translateTime: "yyyy-mm-dd HH:MM:ss",
    ignore: "pid,hostname",
    sync: true,
  }),
);
