import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EffectiveDaemonConfig } from "./config.js";
import type { DaemonLogger } from "./logger.js";

const CHANNEL_VERSION = "2.4.6";
const ILINK_APP_CLIENT_VERSION = "132102";
const SESSION_EXPIRED = -14;
const RATE_LIMITED = -2;

interface TokenData {
  token: string;
  baseUrl: string;
  accountId: string;
}

interface WeixinState {
  syncBuf: string;
  targetUserId?: string;
  contextToken?: string;
}

interface WeixinMessage {
  message_id?: number;
  from_user_id?: string;
  context_token?: string;
  item_list?: Array<{ type?: number; text_item?: { text?: string } }>;
}

interface ApiResponse {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
}

export class WeixinNotifier {
  private credentials: TokenData | null = null;
  private state: WeixinState = { syncBuf: "" };
  private running = false;
  private pollPromise: Promise<void> | null = null;
  private readonly abortController = new AbortController();
  private readonly credentialPath: string;
  private readonly statePath: string;
  private readonly seenMessages = new Map<number, number>();

  constructor(
    private readonly config: EffectiveDaemonConfig["weixin"],
    private readonly logger: DaemonLogger,
    projectRoot = process.cwd(),
  ) {
    this.credentialPath = path.resolve(projectRoot, config.credential_path);
    this.statePath = path.resolve(projectRoot, config.state_path);
  }

  get enabled(): boolean {
    return this.running && Boolean(this.credentials);
  }

  get canSend(): boolean {
    return this.enabled && Boolean(this.state.targetUserId);
  }

  async start(onText?: (text: string) => Promise<string | null> | string | null): Promise<void> {
    if (!this.config.enabled) return;
    this.credentials = await loadJson<TokenData>(this.credentialPath);
    this.state = await loadJson<WeixinState>(this.statePath) ?? { syncBuf: "" };
    if (!this.credentials?.token || !this.credentials.accountId || !this.credentials.baseUrl) {
      this.logger.warn("Weixin disabled: run npm run demo:weixin first to complete QR login");
      this.credentials = null;
      return;
    }

    this.running = true;
    this.pollPromise = this.pollLoop(onText);
    this.logger.info("Weixin iLink connected", {
      target_ready: Boolean(this.state.targetUserId),
      proxy: "disabled",
    });
  }

  async stop(): Promise<void> {
    this.running = false;
    this.abortController.abort();
    await this.pollPromise;
  }

  async send(text: string): Promise<boolean> {
    const target = this.state.targetUserId;
    if (!this.credentials || !target || !text.trim()) return false;
    try {
      for (const chunk of splitText(text, 1800)) {
        await this.sendChunk(target, chunk, this.state.contextToken);
        await delay(300);
      }
      return true;
    } catch (error) {
      this.logger.warn("Weixin send failed", error);
      return false;
    }
  }

  private async pollLoop(onText?: (text: string) => Promise<string | null> | string | null): Promise<void> {
    let timeoutMs = 35_000;
    while (this.running && this.credentials) {
      try {
        const response = await this.request(
          "ilink/bot/getupdates",
          { get_updates_buf: this.state.syncBuf },
          timeoutMs + 3_000,
        );
        if (isErrorCode(response, SESSION_EXPIRED)) {
          this.logger.warn("Weixin session expired; QR login is required again");
          this.running = false;
          break;
        }
        assertApiSuccess(response, "getupdates");

        if (response.get_updates_buf !== undefined) this.state.syncBuf = response.get_updates_buf;
        if (typeof response.longpolling_timeout_ms === "number" && response.longpolling_timeout_ms > 0) {
          timeoutMs = response.longpolling_timeout_ms;
        }

        pruneSeen(this.seenMessages);
        for (const message of response.msgs ?? []) {
          await this.handleMessage(message, onText);
        }
        await saveJson(this.statePath, this.state);
      } catch (error) {
        if (!this.running || isAbortError(error)) break;
        this.logger.warn("Weixin polling failed", error);
        await delay(3_000);
      }
    }
  }

  private async handleMessage(
    message: WeixinMessage,
    onText?: (text: string) => Promise<string | null> | string | null,
  ): Promise<void> {
    if (!this.credentials || !message.from_user_id || message.from_user_id === this.credentials.accountId) return;
    if (message.message_id && this.seenMessages.has(message.message_id)) return;
    if (message.message_id) this.seenMessages.set(message.message_id, Date.now());
    if (this.state.targetUserId && message.from_user_id !== this.state.targetUserId) {
      this.logger.warn("Ignored Weixin message from an unpaired user");
      return;
    }

    const text = message.item_list
      ?.filter(item => item.type === 1)
      .map(item => item.text_item?.text ?? "")
      .join("\n")
      .trim();
    if (!text) return;

    this.state.targetUserId = message.from_user_id;
    if (message.context_token) this.state.contextToken = message.context_token;
    await saveJson(this.statePath, this.state);
    this.logger.info("Weixin command received");

    if (!this.config.command_polling_enabled || !onText) return;
    const response = await onText(text);
    if (response) await this.send(response);
  }

  private async sendChunk(to: string, text: string, contextToken?: string): Promise<void> {
    const payload = {
      msg: {
        from_user_id: "",
        to_user_id: to,
        client_id: crypto.randomUUID(),
        message_type: 2,
        message_state: 2,
        item_list: [{ type: 1, text_item: { text } }],
        ...(contextToken ? { context_token: contextToken } : {}),
      },
    };
    let response = await this.request("ilink/bot/sendmessage", payload, 15_000);
    if (isErrorCode(response, SESSION_EXPIRED) && contextToken) {
      this.state.contextToken = undefined;
      await saveJson(this.statePath, this.state);
      response = await this.request("ilink/bot/sendmessage", {
        msg: { ...payload.msg, context_token: undefined },
      }, 15_000);
    } else if (isErrorCode(response, RATE_LIMITED)) {
      await delay(3_000);
      response = await this.request("ilink/bot/sendmessage", payload, 15_000);
    }
    assertApiSuccess(response, "sendmessage");
  }

  private async request(endpoint: string, body: Record<string, unknown>, timeoutMs: number): Promise<ApiResponse> {
    if (!this.credentials) throw new Error("Weixin credentials are not loaded");
    const signal = AbortSignal.any([this.abortController.signal, AbortSignal.timeout(timeoutMs)]);
    const response = await fetch(`${this.credentials.baseUrl.replace(/\/$/, "")}/${endpoint}`, {
      method: "POST",
      headers: buildHeaders(this.credentials.token),
      body: JSON.stringify({ ...body, base_info: { channel_version: CHANNEL_VERSION } }),
      signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text) as ApiResponse;
  }
}

function buildHeaders(token: string): Record<string, string> {
  const randomUin = Buffer.from(String(crypto.randomBytes(4).readUInt32BE(0)), "utf8").toString("base64");
  return {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "iLink-App-Id": "bot",
    "iLink-App-ClientVersion": ILINK_APP_CLIENT_VERSION,
    Authorization: `Bearer ${token}`,
    "X-WECHAT-UIN": randomUin,
  };
}

function assertApiSuccess(response: ApiResponse, operation: string): void {
  if ((response.ret ?? 0) !== 0 || (response.errcode ?? 0) !== 0) {
    throw new Error(`${operation} failed: ret=${response.ret ?? 0} errcode=${response.errcode ?? 0} ${response.errmsg ?? ""}`);
  }
}

function isErrorCode(response: ApiResponse, code: number): boolean {
  return response.ret === code || response.errcode === code;
}

function splitText(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > maxLength) {
    const window = remaining.slice(0, maxLength);
    const boundary = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\n"), window.lastIndexOf(" "));
    const cut = boundary > maxLength * 0.5 ? boundary : maxLength;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

async function loadJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

async function saveJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function pruneSeen(seen: Map<number, number>): void {
  const cutoff = Date.now() - 5 * 60_000;
  for (const [id, at] of seen) if (at < cutoff) seen.delete(id);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
