import { readFile } from "node:fs/promises";
import https, { type Agent } from "node:https";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";

interface AlertConfig {
  telegram?: {
    bot_token?: string;
    chat_id?: string;
  };
}

interface AppSettings {
  ApiEndpointSettings?: {
    socks_proxy?: string;
    https_proxy?: string;
  };
}

const scheduledRows = [
  ["1", "B/USDT", "+14.97%", "0.13130"],
  ["2", "VVV/USDT", "+13.37%", "11.6200"],
  ["3", "BSB/USDT", "+4.19%", "0.13786"],
];

const watchlistRows = [
  ["英伟达 NVDA", "202.49", "-2.37%"],
  ["美光 MU", "844.00", "-1.08%"],
  ["QQQ", "693.76", "-1.73%"],
];

const richMarkdown = `# 📊 行情广播 · 富文本测试

**24H 涨幅 TOP 3**

| 排名 | 交易对 | 涨跌幅 | 价格 |
|---:|---|---:|---:|
${scheduledRows.map(row => `| ${row.join(" | ")} |`).join("\n")}

**自选行情**

| 标的 | 现价 | 今日 |
|---|---:|---:|
${watchlistRows.map(row => `| ${row.join(" | ")} |`).join("\n")}

# 🚨 价格异动 · 模拟测试

**BTC/USDT**

| 项目 | 数值 |
|---|---:|
| 90 秒涨跌 | **+3.21%** |
| 当前价 | 118,520.00 |
| 窗口低点 | 114,830.00 |
| 窗口高点 | 118,520.00 |
| 24H 涨跌 | +5.42% |

> ⚠️ 本消息由本地脚本发送，不是正式预警`;

const htmlText = `<b>📊 行情广播 · HTML 测试</b>

<b>24H 涨幅 TOP 3</b>
<pre>1  B/USDT    +14.97%   0.13130
2  VVV/USDT  +13.37%  11.6200
3  BSB/USDT   +4.19%   0.13786</pre>

<b>自选行情</b>
<pre>英伟达 NVDA  202.49  -2.37%
美光 MU      844.00  -1.08%
QQQ          693.76  -1.73%</pre>

<b>🚨 价格异动 · 模拟测试</b>
<b>BTC/USDT</b>
<pre>90 秒涨跌  +3.21%
当前价      118,520.00
窗口低点    114,830.00
窗口高点    118,520.00
24H 涨跌    +5.42%</pre>

<blockquote>⚠️ 本消息由本地脚本发送，不是正式预警</blockquote>`;

const shouldSend = process.argv.includes("--send");
console.log("=== HTML preview ===\n");
console.log(htmlText);
console.log("\n=== sendRichMessage markdown preview ===\n");
console.log(richMarkdown);

if (!shouldSend) {
  console.log("\nPreview only. Add --send to send both test messages.");
} else {
  const config = await readJson<AlertConfig>("alert-daemon.config.json");
  const settings = await readJson<AppSettings>("Quantum_Monitor_System/1_Core_Engine/settings.json");
  const token = process.env.TELEGRAM_BOT_TOKEN || config.telegram?.bot_token;
  const chatId = process.env.TELEGRAM_CHAT_ID || config.telegram?.chat_id;
  if (!token || !chatId) throw new Error("Telegram bot token or chat id is not configured");

  const agent = getProxyAgent(settings);
  const htmlResult = await requestTelegram(token, "sendMessage", {
    chat_id: chatId,
    text: htmlText,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  }, agent);
  console.log(`\nHTML test sent: message ${extractMessageId(htmlResult)}`);

  const richResult = await requestTelegram(token, "sendRichMessage", {
    chat_id: chatId,
    rich_message: {
      markdown: richMarkdown,
      skip_entity_detection: true,
    },
    link_preview_options: { is_disabled: true },
  }, agent);
  console.log(`Rich-message test sent: message ${extractMessageId(richResult)}`);
}

async function readJson<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw.replace(/^\uFEFF/, "")) as T;
}

function getProxyAgent(settings: AppSettings): Agent | undefined {
  const socksProxy = process.env.SOCKS_PROXY || process.env.socks_proxy || settings.ApiEndpointSettings?.socks_proxy;
  if (socksProxy) return new SocksProxyAgent(socksProxy);
  const httpProxy = process.env.HTTPS_PROXY || process.env.https_proxy || settings.ApiEndpointSettings?.https_proxy;
  if (httpProxy) return new HttpsProxyAgent(httpProxy);
  return undefined;
}

function requestTelegram(
  token: string,
  method: string,
  payload: Record<string, unknown>,
  agent: Agent | undefined,
): Promise<unknown> {
  const body = JSON.stringify(payload);
  const url = `https://api.telegram.org/bot${token}/${method}`;
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: "POST",
      agent,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    }, res => {
      const chunks: Buffer[] = [];
      res.on("data", chunk => chunks.push(chunk as Buffer));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let parsed: unknown;
        try {
          parsed = JSON.parse(text) as unknown;
        } catch {
          reject(new Error(`Telegram returned invalid JSON (HTTP ${res.statusCode ?? 0})`));
          return;
        }
        if ((res.statusCode ?? 500) >= 400 || !isTelegramSuccess(parsed)) {
          reject(new Error(`Telegram ${method} rejected the test (HTTP ${res.statusCode ?? 0}): ${telegramDescription(parsed)}`));
          return;
        }
        resolve(parsed);
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function isTelegramSuccess(value: unknown): value is { ok: true; result?: { message_id?: number } } {
  return Boolean(value && typeof value === "object" && "ok" in value && (value as { ok?: unknown }).ok === true);
}

function telegramDescription(value: unknown): string {
  if (!value || typeof value !== "object" || !("description" in value)) return "unknown error";
  return String((value as { description?: unknown }).description ?? "unknown error");
}

function extractMessageId(value: unknown): string {
  if (!isTelegramSuccess(value)) return "unknown";
  return String(value.result?.message_id ?? "accepted");
}
