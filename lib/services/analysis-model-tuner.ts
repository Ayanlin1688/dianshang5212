import { prisma } from "@/lib/db/prisma";
import { resolveAgentConnection } from "@/lib/detail-runs/provider";

export type ModelRole = "planning" | "analysis";

export type RoleTuneAttempt = {
  modelId: string;
  ok: boolean;
  transport?: string;
  reason?: string;
  durationMs: number;
};

export type RoleTuneResult = {
  role: ModelRole;
  modelId: string | null;
  changed: boolean;
  attempts: RoleTuneAttempt[];
};

async function setDefaultModel(providerConfigId: string, role: ModelRole, modelId: string) {
  const flag = role === "analysis" ? "isDefaultAnalysis" : "isDefaultPlanning";
  await prisma.modelProfile.updateMany({
    where: { providerConfigId },
    data: { [flag]: false },
  });
  await prisma.modelProfile.updateMany({
    where: { providerConfigId, modelId },
    data: { [flag]: true },
  });
}

async function readDefaultModel(providerConfigId: string, role: ModelRole) {
  const flag = role === "analysis" ? "isDefaultAnalysis" : "isDefaultPlanning";
  const record = await prisma.modelProfile.findFirst({
    where: { providerConfigId, [flag]: true },
    select: { modelId: true },
  });
  return record?.modelId ?? null;
}

/**
 * 用软件自身的 Agent 兼容性检测（图片识别 + 工具调用往返）逐个验证候选模型，
 * 选出第一个真正能跑通该角色流程的模型作为默认。
 *
 * 注意：中转站「列表里有」不等于「能跑 Agent」——例如部分 Gemini 通道不支持工具调用，
 * 因此这里以真实检测结果为准，而不是只看模型名。
 */
export async function tuneDefaultModelForRole(input: {
  providerConfigId: string;
  role: ModelRole;
  candidates: string[];
  /** 当前默认模型也纳入尝试顺序（放最前） */
  maxCandidates?: number;
}): Promise<RoleTuneResult> {
  const { providerConfigId, role } = input;
  const current = await readDefaultModel(providerConfigId, role);
  // 优先按能力排名尝试（同步的目的就是对齐上游最健康的模型），
  // 当前默认值放到最后作为兜底，避免它已被瞬时故障"污染"时一直被沿用。
  const ordered = [...new Set([...input.candidates, ...(current ? [current] : [])])].slice(
    0,
    input.maxCandidates ?? 4,
  );
  const attempts: RoleTuneAttempt[] = [];

  for (const modelId of ordered) {
    const exists = await prisma.modelProfile.findFirst({
      where: { providerConfigId, modelId },
      select: { isAvailable: true },
    });
    if (!exists) continue;

    const previous = await readDefaultModel(providerConfigId, role);
    await setDefaultModel(providerConfigId, role, modelId);

    const startedAt = Date.now();
    let lastError: unknown = null;
    let passed = false;
    let transport: string | undefined;

    // 瞬时失败（超时/限流/5xx）重试一次，避免把可用模型误判为不兼容
    for (let attempt = 0; attempt < 2 && !passed; attempt += 1) {
      try {
        const connection = await resolveAgentConnection(true, role);
        passed = true;
        transport = connection.transport;
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        if (!/超时|timeout|限流|429|5\d\d|网络/.test(message)) break;
      }
    }

    if (passed) {
      attempts.push({
        modelId,
        ok: true,
        transport,
        durationMs: Date.now() - startedAt,
      });
      return { role, modelId, changed: previous !== modelId, attempts };
    }

    attempts.push({
      modelId,
      ok: false,
      reason: lastError instanceof Error ? lastError.message.slice(0, 200) : String(lastError),
      durationMs: Date.now() - startedAt,
    });
  }

  // 全部候选失败：还原到原先的默认值，避免留下一个半成品
  if (current) {
    await setDefaultModel(providerConfigId, role, current);
  }

  return { role, modelId: current, changed: false, attempts };
}
