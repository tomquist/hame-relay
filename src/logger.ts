import { pino } from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: {
    targets: [
      {
        target: "pino-pretty",
        options: {
          colorize: false,
          translateTime: "yyyy-mm-dd HH:MM:ss",
          ignore: "pid,hostname",
        },
      },
    ],
  },
});
