/**
 * 上游模型真实可用性探测。
 *
 * 中转站的 /v1/models 只声明「模型存在」，并不保证真的能调用：
 * 常见情况是分组未开放、上游无可用账号、未配置价格，调用时直接报错。
 * 因此同步上游时对文本/视觉模型做一次极小成本的探活，只有真正能返回内容的
 * 模型才会被选作「规划模型 / 图像识别模型」。
 */

import { withRelayDispatcher } from "@/lib/utils/relay-dispatcher";

export type ModelProbeStatus = "ok" | "unavailable" | "inconclusive";

export type ModelProbeResult = {
  modelId: string;
  /** 文本调用是否成功 */
  ok: boolean;
  status: ModelProbeStatus;
  /** 是否确认支持图像输入（带图探活成功） */
  supportsVision: boolean;
  latencyMs: number;
  /** 失败时的可读中文原因 */
  reason: string | null;
  checkedAt: string;
};

/** 8x8 纯红 PNG，用于视觉探活（体积极小，几乎不消耗额度） */
export const PROBE_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGO4IyKHFTEMLQkAj85DgUvUt5cAAAAASUVORK5CYII=";

const DEFAULT_TIMEOUT_MS = 20000;

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, "");
}

/** 与适配器保持一致的候选地址推导：base 未带 /v1 时优先补 /v1 */
export function buildChatCompletionUrls(baseUrl: string) {
  const normalized = normalizeBaseUrl(baseUrl);
  const urls: string[] = [];

  if (!/\/v\d+(?:beta)?$/i.test(normalized)) {
    urls.push(`${normalized}/v1/chat/completions`);
  }
  urls.push(`${normalized}/chat/completions`);

  return [...new Set(urls)];
}

/**
 * 区分「确认不可用」与「探测不确定」：
 * - unavailable：上游明确表示该模型不可调用（分组未开放 / 无账号 / 未定价 / 不存在 / 无权限）
 * - inconclusive：超时、限流、5xx、网络抖动 —— 不能据此判定模型永久不可用
 */
export function classifyProbeFailure(status: number, rawBody: string): ModelProbeStatus {
  const text = rawBody || "";

  if (/not available for this group|no available accounts|no available .*account|价格尚未|not been priced|has not been priced|未配置价格|model.+not exist|does not exist|invalid.?model|unknown model|模型不存在/i.test(text)) {
    return "unavailable";
  }
  if (status === 401 || status === 403 || status === 404) {
    return "unavailable";
  }

  return "inconclusive";
}

/** 把上游报错翻译成可读中文原因 */
export function describeModelProbeFailure(status: number, rawBody: string) {
  const body = rawBody || "";
  let message = "";
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string } | string;
      message?: string;
    };
    const raw = typeof parsed.error === "string" ? parsed.error : parsed.error?.message ?? parsed.message ?? "";
    message = String(raw);
  } catch {
    message = body;
  }

  const text = `${message} ${body}`;

  if (/not available for this group|is not available/i.test(text)) {
    return "上游分组未开放该模型";
  }
  if (/no available accounts|no available .*account/i.test(text)) {
    return "上游暂无可用账号";
  }
  if (/价格尚未|not been priced|has not been priced|未配置价格/i.test(text)) {
    return "上游尚未配置该模型价格";
  }
  if (/model.+not exist|does not exist|invalid.?model|unknown model|模型不存在/i.test(text)) {
    return "上游不存在该模型";
  }
  if (status === 401 || status === 403) {
    return "鉴权失败（Key 无效或无该模型权限）";
  }
  if (status === 404) {
    return "上游未提供该模型（404）";
  }
  if (status === 429) {
    return "触发限流（429），可稍后重试";
  }
  if (status >= 500) {
    return `上游服务异常（${status}）`;
  }
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timeout|aborted|network/i.test(text)) {
    return "网络异常或超时";
  }
  if (status === 200) {
    return "响应为空，无法确认可用性";
  }

  const trimmed = message.trim().replace(/\s+/g, " ");
  return trimmed ? trimmed.slice(0, 140) : `调用失败（${status || "无响应"}）`;
}

type ChatProbeResponse = {
  ok: boolean;
  status: number;
  body: string;
};

async function postChat(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<ChatProbeResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, withRelayDispatcher({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    }) as RequestInit);
    const text = await response.text();
    return { ok: response.ok, status: response.status, body: text };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const aborted = (error as { name?: string })?.name === "AbortError";
    return {
      ok: false,
      status: aborted ? 408 : 0,
      body: aborted ? `请求超时（${timeoutMs}ms）` : message,
    };
  } finally {
    clearTimeout(timer);
  }
}

function hasCompletionResult(body: string) {
  try {
    const payload = JSON.parse(body) as {
      choices?: unknown[];
      data?: unknown[];
      content?: unknown;
    };
    // 推理型模型可能把预算用在 reasoning 上导致 content 为空，
    // 只要上游返回了合法的 completion 结构就算调用成功。
    return Boolean(payload.choices?.length || payload.data?.length || payload.content);
  } catch {
    return false;
  }
}

/**
 * 探测单个文本/视觉模型：
 * 1) 先发一次纯文本极小请求，确认模型真的能调用；
 * 2) 文本通过后再带一张小图，确认图像输入能力。
 */
export async function probeChatModel(input: {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  timeoutMs?: number;
  checkVision?: boolean;
}): Promise<ModelProbeResult> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const urls = buildChatCompletionUrls(input.baseUrl);
  const checkedAt = new Date().toISOString();
  const startedAt = Date.now();
  let lastFailure = { status: 0, body: "" };

  for (const url of urls) {
    const textProbe = await probeTextWithRetry(url, input.apiKey, input.modelId, timeoutMs);

    if (textProbe.ok && hasCompletionResult(textProbe.body)) {
      const supportsVision = input.checkVision === false
        ? false
        : await probeVision(url, input.apiKey, input.modelId, timeoutMs);

      return {
        modelId: input.modelId,
        ok: true,
        status: "ok" as const,
        supportsVision,
        latencyMs: Date.now() - startedAt,
        reason: null,
        checkedAt,
      };
    }

    lastFailure = { status: textProbe.status, body: textProbe.body };

    // 端点本身存在的问题才换下一个候选地址；其余错误直接判定，不再重复打上游
    if (!/404|not found|no route|cannot\s+(get|post)|unsupported endpoint/i.test(textProbe.body)) {
      break;
    }
  }

  const status = classifyProbeFailure(lastFailure.status, lastFailure.body);

  return {
    modelId: input.modelId,
    ok: false,
    status,
    supportsVision: false,
    latencyMs: Date.now() - startedAt,
    reason: describeModelProbeFailure(lastFailure.status, lastFailure.body),
    checkedAt,
  };
}

/** 文本探活：瞬时失败（超时/限流/5xx）重试一次，避免把可用的模型误判为不可用 */
async function probeTextWithRetry(url: string, apiKey: string, modelId: string, timeoutMs: number) {
  const body = {
    model: modelId,
    messages: [{ role: "user", content: "ping" }],
    max_tokens: 16,
  };

  let last = await postChat(url, apiKey, body, timeoutMs);

  for (let attempt = 0; attempt < 1; attempt += 1) {
    const transient = !last.ok && classifyProbeFailure(last.status, last.body) === "inconclusive";
    if (!transient) break;
    last = await postChat(url, apiKey, body, timeoutMs);
  }

  return last;
}

async function probeVision(url: string, apiKey: string, modelId: string, timeoutMs: number) {
  const visionProbe = await postChat(
    url,
    apiKey,
    {
      model: modelId,
      // 推理型模型需要足够的输出预算，否则 content 为空会被误判为「不支持图片」
      max_tokens: 128,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Reply with the dominant color of this image, one word." },
            { type: "image_url", image_url: { url: PROBE_IMAGE } },
          ],
        },
      ],
    },
    timeoutMs,
  );

  return visionProbe.ok && hasCompletionResult(visionProbe.body);
}

/** 并发受限的批量映射，避免把中转站打爆 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const size = Math.max(1, Math.min(limit, items.length || 1));

  await Promise.all(
    Array.from({ length: size }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index], index);
      }
    }),
  );

  return results;
}
