import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { AlertDaemonConfig } from "./config.js";

type LogLevel = "debug" | "info" | "warn" | "error";

const levelOrder: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export class DaemonLogger {
  private readonly level: LogLevel;
  private readonly filePath: string;
  private readonly fileEnabled: boolean;

  constructor(config: AlertDaemonConfig["logging"], private readonly projectRoot = process.cwd()) {
    this.level = config.level;
    this.fileEnabled = config.file_enabled;
    this.filePath = path.resolve(projectRoot, config.file_path);
  }

  debug(message: string, meta?: unknown): void {
    this.write("debug", message, meta);
  }

  info(message: string, meta?: unknown): void {
    this.write("info", message, meta);
  }

  warn(message: string, meta?: unknown): void {
    this.write("warn", message, meta);
  }

  error(message: string, meta?: unknown): void {
    this.write("error", message, meta);
  }

  private write(level: LogLevel, message: string, meta?: unknown): void {
    if (levelOrder[level] < levelOrder[this.level]) return;
    const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}${meta === undefined ? "" : ` ${formatMeta(meta)}`}`;
    if (level === "error") {
      console.error(line);
    } else if (level === "warn") {
      console.warn(line);
    } else {
      console.log(line);
    }

    if (this.fileEnabled) {
      void mkdir(path.dirname(this.filePath), { recursive: true })
        .then(() => appendFile(this.filePath, `${line}\n`, "utf8"))
        .catch(() => undefined);
    }
  }
}

function formatMeta(meta: unknown): string {
  if (meta instanceof Error) return meta.stack || meta.message;
  if (typeof meta === "string") return meta;
  try {
    return JSON.stringify(meta);
  } catch {
    return String(meta);
  }
}
