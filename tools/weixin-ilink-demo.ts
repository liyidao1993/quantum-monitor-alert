import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";
import qrcodeTerminal from "qrcode-terminal";

const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
const STORAGE_DIR = path.resolve(process.cwd(), ".runtime/weixin-demo");
const TOKEN_PATH = path.join(STORAGE_DIR, "token.json");
const STATE_PATH = path.join(STORAGE_DIR, "state.json");
const CHANNEL_VERSION = "2.4.6";
const ILINK_APP_CLIENT_VERSION = "132102";

interface TokenData {
  token: string;
  baseUrl: string;
  accountId: string;
  savedAt: string;
}

interface DemoState {
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

interface UpdatesResponse {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
}

disableProxyEnvironment();

let stopping = false;
let qrSequence = 0;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

await main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main(): Promise<void> {
  console.log("Weixin iLink local demo (direct connection, proxy disabled)");
  console.log(`Storage: ${STORAGE_DIR}`);

  const forceLogin = process.argv.includes("--relogin");
  const tokenData = forceLogin ? await login() : await loadJson<TokenData>(TOKEN_PATH) ?? await login();
  const state = await loadJson<DemoState>(STATE_PATH) ?? { syncBuf: "" };

  console.log("Connected credentials loaded. Waiting for a WeChat direct message...");
  console.log("Send any text to the iLink bot. This demo will reply once per received text message.");

  const seen = new Map<number, number>();
  let pollTimeoutMs = 35_000;

  while (!stopping) {
    try {
      const response = await apiPost<UpdatesResponse>(
        tokenData.baseUrl,
        "ilink/bot/getupdates",
        { get_updates_buf: state.syncBuf },
        tokenData.token,
        pollTimeoutMs + 3_000,
      );

      if (response.errcode === -14 || response.ret === -14) {
        throw new Error("WeChat session expired. Run again with --relogin.");
      }
      if ((response.ret ?? 0) !== 0 || (response.errcode ?? 0) !== 0) {
        throw new Error(`getupdates failed: ret=${response.ret ?? 0} errcode=${response.errcode ?? 0} ${response.errmsg ?? ""}`);
      }

      if (response.get_updates_buf !== undefined) {
        state.syncBuf = response.get_updates_buf;
      }
      if (typeof response.longpolling_timeout_ms === "number" && response.longpolling_timeout_ms > 0) {
        pollTimeoutMs = response.longpolling_timeout_ms;
      }

      pruneSeen(seen);
      for (const message of response.msgs ?? []) {
        if (!message.from_user_id || message.from_user_id === tokenData.accountId) continue;
        if (message.message_id && seen.has(message.message_id)) continue;
        if (message.message_id) seen.set(message.message_id, Date.now());

        const text = message.item_list
          ?.filter(item => item.type === 1)
          .map(item => item.text_item?.text ?? "")
          .join("\n")
          .trim();
        if (!text) continue;

        state.targetUserId = message.from_user_id;
        if (message.context_token) state.contextToken = message.context_token;
        await saveJson(STATE_PATH, state);

        console.log(`[received ${maskId(message.from_user_id)}] ${text}`);
        await sendText(tokenData, message.from_user_id, state.contextToken, `本地微信机器人连接成功。\n\n收到：${text}`);
        console.log("Reply sent. You can keep sending messages; press Ctrl+C to stop.");
      }

      await saveJson(STATE_PATH, state);
    } catch (error) {
      if (stopping || isAbortError(error)) break;
      console.error(error instanceof Error ? error.message : String(error));
      await delay(3_000);
    }
  }

  console.log("Demo stopped.");
}

async function login(): Promise<TokenData> {
  console.log("Requesting a WeChat login QR code...");
  let qr = await apiGet<{ qrcode: string; qrcode_img_content: string }>(
    DEFAULT_BASE_URL,
    "ilink/bot/get_bot_qrcode?bot_type=3",
  );
  await renderQr(qr.qrcode_img_content);

  const deadline = Date.now() + 5 * 60_000;
  let refreshes = 0;
  let scanLogged = false;

  while (Date.now() < deadline) {
    const status = await apiGet<{
      status: string;
      bot_token?: string;
      baseurl?: string;
      ilink_bot_id?: string;
    }>(DEFAULT_BASE_URL, `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qr.qrcode)}`);

    if (status.status === "scaned" && !scanLogged) {
      scanLogged = true;
      console.log("QR scanned. Confirm the login in WeChat...");
    } else if (status.status === "expired") {
      if (++refreshes > 3) throw new Error("QR code expired too many times.");
      qr = await apiGet(DEFAULT_BASE_URL, "ilink/bot/get_bot_qrcode?bot_type=3");
      scanLogged = false;
      await renderQr(qr.qrcode_img_content);
    } else if (status.status === "confirmed") {
      if (!status.bot_token || !status.ilink_bot_id) throw new Error("Login response did not contain credentials.");
      const tokenData: TokenData = {
        token: status.bot_token,
        baseUrl: status.baseurl || DEFAULT_BASE_URL,
        accountId: status.ilink_bot_id,
        savedAt: new Date().toISOString(),
      };
      await saveJson(TOKEN_PATH, tokenData);
      console.log(`Login confirmed. Bot: ${maskId(tokenData.accountId)}`);
      return tokenData;
    }

    await delay(1_500);
  }

  throw new Error("WeChat QR login timed out.");
}

async function sendText(tokenData: TokenData, to: string, contextToken: string | undefined, text: string): Promise<void> {
  const response = await apiPost<{ ret?: number; errcode?: number; errmsg?: string }>(
    tokenData.baseUrl,
    "ilink/bot/sendmessage",
    {
      msg: {
        from_user_id: "",
        to_user_id: to,
        client_id: crypto.randomUUID(),
        message_type: 2,
        message_state: 2,
        item_list: [{ type: 1, text_item: { text: text.slice(0, 1800) } }],
        ...(contextToken ? { context_token: contextToken } : {}),
      },
    },
    tokenData.token,
    15_000,
  );
  if ((response.ret ?? 0) !== 0 || (response.errcode ?? 0) !== 0) {
    throw new Error(`sendmessage failed: ret=${response.ret ?? 0} errcode=${response.errcode ?? 0} ${response.errmsg ?? ""}`);
  }
}

async function apiGet<T>(baseUrl: string, endpoint: string): Promise<T> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/${endpoint}`, {
    headers: buildHeaders(),
    signal: AbortSignal.timeout(35_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as T;
}

async function apiPost<T>(
  baseUrl: string,
  endpoint: string,
  body: Record<string, unknown>,
  token: string,
  timeoutMs: number,
): Promise<T> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/${endpoint}`, {
    method: "POST",
    headers: buildHeaders(token),
    body: JSON.stringify({ ...body, base_info: { channel_version: CHANNEL_VERSION } }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as T;
}

function buildHeaders(token?: string): Record<string, string> {
  const randomUin = Buffer.from(String(crypto.randomBytes(4).readUInt32BE(0)), "utf8").toString("base64");
  return {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "iLink-App-Id": "bot",
    "iLink-App-ClientVersion": ILINK_APP_CLIENT_VERSION,
    "X-WECHAT-UIN": randomUin,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function renderQr(value: string): Promise<void> {
  await mkdir(STORAGE_DIR, { recursive: true });
  const imagePath = path.join(STORAGE_DIR, `login-qr-${Date.now()}-${++qrSequence}.png`);
  await QRCode.toFile(imagePath, value, { width: 480, margin: 3 });
  console.log("Scan this QR code with WeChat:");
  qrcodeTerminal.generate(value, { small: true });
  console.log(`QR image: ${imagePath}`);
  console.log(`QR fallback URL: ${value}`);
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

function disableProxyEnvironment(): void {
  for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy", "SOCKS_PROXY", "socks_proxy"]) {
    delete process.env[name];
  }
  process.env.GLOBAL_AGENT_HTTP_PROXY = "";
}

function pruneSeen(seen: Map<number, number>): void {
  const cutoff = Date.now() - 5 * 60_000;
  for (const [id, at] of seen) if (at < cutoff) seen.delete(id);
}

function maskId(value: string): string {
  return value.length <= 10 ? "***" : `${value.slice(0, 5)}...${value.slice(-4)}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
