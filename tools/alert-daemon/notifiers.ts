import { spawn } from "node:child_process";
import https, { type Agent } from "node:https";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import type { DaemonAlert } from "./alertRules.js";
import type { EffectiveDaemonConfig, Severity } from "./config.js";
import type { DaemonLogger } from "./logger.js";

type FloatingMessageKind = "alert" | "scheduled";
export interface FloatingAlertFields {
  schema_version: 1;
  type: DaemonAlert["type"];
  symbol: string;
  period: string;
  direction: "up" | "down";
  change_percent: number;
  threshold_percent: number;
  triggered_at: string;
}

type FloatingMessageMetadata = {
  id?: string;
  timestamp?: string;
  alert?: FloatingAlertFields;
};

export interface TelegramMessage {
  chat: { id: number | string };
  text?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export class TelegramNotifier {
  private readonly token: string;
  private readonly chatId: string;

  constructor(config: EffectiveDaemonConfig["telegram"], private readonly logger: DaemonLogger) {
    this.token = config.effective_bot_token;
    this.chatId = config.effective_chat_id;
  }

  get enabled(): boolean {
    return Boolean(this.token && this.chatId);
  }

  isAllowedChat(chatId: number | string): boolean {
    return String(chatId) === String(this.chatId);
  }

  async send(text: string): Promise<void> {
    if (!this.enabled) return;
    await this.sendToChat(this.chatId, text);
  }

  async sendRich(markdown: string, fallbackText: string): Promise<void> {
    if (!this.enabled) return;
    try {
      await this.request("sendRichMessage", {
        chat_id: this.chatId,
        rich_message: {
          markdown,
          skip_entity_detection: true,
        },
        link_preview_options: { is_disabled: true },
      });
    } catch (err) {
      if (!isRichFallbackError(err)) {
        this.logger.warn("Telegram rich send failed; plain fallback skipped to avoid a duplicate", err);
        return;
      }
      this.logger.warn("Telegram rich message rejected; falling back to plain text", err);
      await this.send(fallbackText);
    }
  }

  async sendToChat(chatId: string | number, text: string): Promise<void> {
    if (!this.token) return;
    try {
      await this.request("sendMessage", {
        chat_id: chatId,
        text: text.slice(0, 3900),
        disable_web_page_preview: true,
      });
    } catch (err) {
      this.logger.warn("Telegram send failed", err);
    }
  }

  async getUpdates(offset: number, longPollSeconds = 0, signal?: AbortSignal): Promise<TelegramUpdate[]> {
    if (!this.token) return [];
    const timeoutSeconds = Math.max(0, Math.min(50, Math.floor(longPollSeconds)));
    const httpTimeoutMs = (timeoutSeconds + 15) * 1000;
    const result = await this.request("getUpdates", {
      offset,
      timeout: timeoutSeconds,
      allowed_updates: ["message"],
    }, httpTimeoutMs, signal) as { result?: TelegramUpdate[] };
    return Array.isArray(result.result) ? result.result : [];
  }

  private async request(
    method: string,
    payload: Record<string, unknown>,
    timeoutMs = 15_000,
    externalSignal?: AbortSignal,
  ): Promise<unknown> {
    const url = `https://api.telegram.org/bot${this.token}/${method}`;
    const body = JSON.stringify(payload);
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = externalSignal ? AbortSignal.any([externalSignal, timeoutSignal]) : timeoutSignal;
    const agent = getProxyAgent();
    if (!agent) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal,
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 160)}`);
      return JSON.parse(text) as unknown;
    }

    return new Promise((resolve, reject) => {
      const req = https.request(url, {
        method: "POST",
        agent,
        signal,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      }, res => {
        const chunks: Buffer[] = [];
        res.on("data", chunk => chunks.push(chunk as Buffer));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if ((res.statusCode ?? 500) >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 160)}`));
            return;
          }
          try {
            resolve(JSON.parse(text) as unknown);
          } catch (err) {
            reject(err);
          }
        });
      });
      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }
}

export class NtfyNotifier {
  private readonly baseUrl: string;
  private readonly topic: string;
  private readonly token: string;

  constructor(private readonly config: EffectiveDaemonConfig["ntfy"], private readonly logger: DaemonLogger) {
    this.baseUrl = (config.base_url || "").trim().replace(/\/+$/, "");
    this.topic = (config.topic || "").trim();
    this.token = (config.token || "").trim();
  }

  get enabled(): boolean {
    return Boolean(this.config.enabled && this.baseUrl && this.topic);
  }

  async send(
    title: string,
    message: string,
    options: { priority?: number; tags?: string[] } = {},
  ): Promise<boolean> {
    if (!this.enabled) return false;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    try {
      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          topic: this.topic,
          title: title.slice(0, 120),
          message: message.slice(0, 3900),
          priority: options.priority ?? 3,
          tags: options.tags ?? [],
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 160)}`);
      }
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Ntfy send failed: ${msg}`);
      return false;
    }
  }
}

export class FloatingReceiverNotifier {
  private readonly url = (process.env.FLOATING_RECEIVER_URL ?? "").trim();
  private readonly token = (process.env.RECEIVER_TOKEN ?? "").trim();

  constructor(private readonly logger: DaemonLogger) {}

  get enabled(): boolean {
    return Boolean(this.url && this.token);
  }

  async send(
    title: string,
    body: string,
    severity: Severity,
    kind: FloatingMessageKind = "alert",
    metadata: FloatingMessageMetadata = {},
  ): Promise<void> {
    if (!this.enabled) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(this.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...metadata,
          title,
          body,
          level: severity === "critical" ? "error" : severity,
          kind,
        }),
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 160)}`);
      this.logger.info("Floating receiver notification sent", { title });
    } catch (err) {
      this.logger.warn("Floating receiver notification failed", err);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class DesktopNotifier {
  constructor(private readonly config: EffectiveDaemonConfig["desktop_notify"], private readonly logger: DaemonLogger) {}

  notify(title: string, body: string, severity: Severity): void {
    if (!this.config.enabled || severityRank(severity) < severityRank(this.config.min_severity)) return;
    this.dispatch(title, body);
  }

  notifyForced(title: string, body: string): void {
    if (!this.config.enabled) return;
    this.dispatch(title, body);
  }

  private dispatch(title: string, body: string): void {
    const script = `
$ErrorActionPreference = "Stop"
$title = $env:QM_TOAST_TITLE
$body = $env:QM_TOAST_BODY
$sound = $env:QM_TOAST_SOUND
try {
  if (Get-Module -ListAvailable -Name BurntToast) {
    Import-Module BurntToast -ErrorAction Stop
    New-BurntToastNotification -Text @($title, $body) -ErrorAction Stop | Out-Null
    exit 0
  }

  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $notify = New-Object System.Windows.Forms.NotifyIcon
  $notify.Icon = [System.Drawing.SystemIcons]::Information
  $notify.BalloonTipTitle = $title
  $notify.BalloonTipText = $body
  $notify.Visible = $true
  $notify.ShowBalloonTip(5000)
  Start-Sleep -Seconds 6
  $notify.Dispose()
  exit 0
} catch {
  Write-Error $_
  exit 1
}
`;
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    this.logger.info("Desktop notification requested", { title });
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        QM_TOAST_TITLE: title,
        QM_TOAST_BODY: body.slice(0, 600),
        QM_TOAST_SOUND: String(this.config.sound),
      },
    });
    let stderr = "";
    child.stderr?.on("data", chunk => {
      stderr += String(chunk);
    });
    child.on("error", err => this.logger.warn("Desktop notification failed", err));
    child.on("close", code => {
      if (code && code !== 0) {
        this.logger.warn("Desktop notification exited with error", { code, stderr: stderr.slice(0, 800) });
      }
    });
  }
}

export function buildAlertText(title: string, message: string): string {
  return `${title}\n\n${message}`;
}

export function buildNtfyAlertTitle(alert: DaemonAlert): string {
  const arrow = alert.value >= 0 ? "📈" : "📉";
  return `${arrow} ${alert.symbol} ${formatAlertPercent(alert.value)} (${alert.period})`;
}

export function buildFloatingAlertTitle(alert: DaemonAlert): string {
  return `${alert.symbol} · ${alert.period} · ${formatAlertPercent(alert.value)}`;
}

export function buildFloatingAlertFields(alert: DaemonAlert): FloatingAlertFields {
  return {
    schema_version: 1,
    type: alert.type,
    symbol: alert.symbol,
    period: alert.period,
    direction: alert.value >= 0 ? "up" : "down",
    change_percent: alert.value,
    threshold_percent: alert.threshold,
    triggered_at: alert.created_at,
  };
}

export function buildFloatingAlertMarkdown(alert: DaemonAlert): string {
  const summary = [
    "| 品种 | 周期 | 涨跌幅 |",
    "|---|---:|---:|",
    `| ${escapeRichCell(alert.symbol)} | ${escapeRichCell(alert.period)} | ${formatAlertPercent(alert.value)} |`,
  ].join("\n");
  const detailLabels = alert.type === "instant_move"
    ? ["当前价", "窗口低点", "窗口高点", "24H涨跌", "1m涨幅", "15m涨幅"]
    : ["当前价", "MA60", "偏离", "24H涨跌", "1m涨幅", "15m涨幅"];
  const detailRows = extractFloatingAlertRows(alert.message, detailLabels);
  if (detailRows.length === 0) return summary;
  return [
    summary,
    [
      "| 指标 | 数值 |",
      "|---|---:|",
      ...detailRows.map(([label, value]) => `| ${escapeRichCell(label)} | ${escapeRichCell(value)} |`),
    ].join("\n"),
  ].join("\n\n");
}

function extractFloatingAlertRows(message: string, labels: string[]): Array<[string, string]> {
  const aliases: Record<string, string> = {
    "当前价格": "当前价",
    "今日涨幅": "24H涨跌",
    "24H涨跌": "24H涨跌",
    "1m 涨幅": "1m涨幅",
    "15m 涨幅": "15m涨幅",
  };
  const wanted = new Set(labels);
  const values = new Map<string, string>();
  for (const line of message.split("\n")) {
    const separator = line.indexOf("：") >= 0 ? line.indexOf("：") : line.indexOf(":");
    if (separator < 1) continue;
    const rawLabel = line.slice(0, separator).trim();
    const label = aliases[rawLabel] ?? rawLabel;
    if (wanted.has(label) && !values.has(label)) values.set(label, line.slice(separator + 1).trim());
  }
  return labels.flatMap(label => {
    const value = values.get(label);
    return value ? [[label, value] as [string, string]] : [];
  });
}

export function buildTelegramAlertMarkdown(alert: DaemonAlert): string {
  const icon = alert.type === "instant_move" ? "🚨" : "📐";
  const title = alert.title.replace(/^\[|\]$/g, "").replace("] ", " · ");
  const summary = [
    "| 品种 | 周期 | 涨跌幅 |",
    "|---|---:|---:|",
    `| ${escapeRichCell(alert.symbol)} | ${escapeRichCell(alert.period)} | ${formatAlertPercent(alert.value)} |`,
  ].join("\n");
  const blocks = alert.message.split(/\n\n+/).filter(Boolean);
  const rendered = blocks.map((block, index) => renderAlertBlock(block, index === 0 ? "告警数据" : "行情快照"));
  return [`# ${icon} ${title}`, summary, ...rendered, "> ⚠️ 自动预警，请结合市场流动性判断"].join("\n\n");
}

function renderAlertBlock(block: string, heading: string): string {
  const rows: Array<[string, string]> = [];
  const prose: string[] = [];
  for (const line of block.split("\n").filter(Boolean)) {
    const separator = line.indexOf("：");
    if (separator < 1) {
      prose.push(line);
      continue;
    }
    rows.push([line.slice(0, separator), line.slice(separator + 1)]);
  }
  const parts = [`## ${heading}`];
  if (rows.length > 0) {
    parts.push([
      "| 项目 | 数值 |",
      "|---|---:|",
      ...rows.map(([label, value]) => `| ${escapeRichCell(label)} | ${escapeRichCell(value)} |`),
    ].join("\n"));
  }
  if (prose.length > 0) parts.push(prose.join("  \n"));
  return parts.join("\n\n");
}

function escapeRichCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function formatAlertPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function isRichFallbackError(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err);
  return /HTTP (400|404):/i.test(text) || /unsupported|not implemented|method.*not found/i.test(text);
}

function getProxyAgent(): Agent | undefined {
  const socksProxy = process.env.SOCKS_PROXY || process.env.socks_proxy;
  if (socksProxy) return new SocksProxyAgent(socksProxy);
  const httpProxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (httpProxy) return new HttpsProxyAgent(httpProxy);
  return undefined;
}

function severityRank(value: Severity): number {
  if (value === "critical") return 3;
  if (value === "warning") return 2;
  return 1;
}
