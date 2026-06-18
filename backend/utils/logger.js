const { createLogger, format, transports, addColors } = require("winston");
const path = require("path");
const fs   = require("fs");

const logsDir = path.join(__dirname, "../logs");
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

// ─── Add custom 'http' level between warn(3) and info(2) ─────────────────────
const customLevels = {
  levels: { error: 0, warn: 1, http: 2, info: 3, debug: 4 },
  colors: { error: "red", warn: "yellow", http: "magenta", info: "green", debug: "white" },
};
addColors(customLevels.colors);

const { combine, timestamp, printf, colorize, errors } = format;

const logFormat = printf(({ level, message, timestamp, stack }) =>
  `${timestamp} [${level}]: ${stack || message}`
);

const logger = createLogger({
  levels: customLevels.levels,
  level: process.env.NODE_ENV === "production" ? "warn" : "debug",
  format: combine(timestamp({ format: "YYYY-MM-DD HH:mm:ss" }), errors({ stack: true }), logFormat),
  transports: [
    new transports.Console({
      format: combine(colorize({ all: true }), timestamp({ format: "HH:mm:ss" }), logFormat),
      silent: process.env.NODE_ENV === "test",
    }),
    new transports.File({ filename: path.join(logsDir, "error.log"),    level: "error" }),
    new transports.File({ filename: path.join(logsDir, "combined.log"), level: "debug" }),
  ],
});

module.exports = logger;
