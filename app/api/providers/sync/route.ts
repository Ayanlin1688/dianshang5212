import { NextRequest } from "next/server";

import { withProviderCredentials } from "@/lib/services/provider-runtime";
import { getActiveProviderConfig, resolveProviderConnectionInput, syncProviderModelsFromUpstream } from "@/lib/services/provider-service";
import { tuneDefaultModelForRole } from "@/lib/services/analysis-model-tuner";
import { providerInputSchema } from "@/lib/validations/provider";
import { handleRouteError, ok } from "@/lib/utils/route";

export const maxDuration = 300;

/**
 * 与上游拉取同步：
 * 重新拉取中转站模型列表 → 真实探活文本/视觉模型 → 剔除不可用模型 → 重排默认分配
 * → 用软件自身的 Agent 兼容性检测逐个验证，选出真正能跑通流程的规划/图像识别模型。
 */
export async function POST(request: NextRequest) {
  return withProviderCredentials(request, async () => {
    try {
      const body = await request.json().catch(() => ({}));
      const active = await getActiveProviderConfig().catch(() => null);
      const parsed = providerInputSchema.parse({
        name: body?.name ?? active?.name ?? "KKOne 中转站",
        baseUrl: body?.baseUrl ?? active?.baseUrl ?? "",
        apiKey: body?.apiKey ?? "",
      });
      const input = await resolveProviderConnectionInput(parsed);
      const result = await syncProviderModelsFromUpstream({
        ...input,
        providerId: active?.id ?? null,
        isActive: true,
        probe: true,
      });

      // 兼容性验证：列表可用 ≠ 能跑 Agent，这里以真实检测结果为准
      const tune = body?.tune === false
        ? []
        : await Promise.all([
            tuneDefaultModelForRole({
              providerConfigId: result.providerId,
              role: "planning",
              candidates: result.candidates.planning,
            }),
            tuneDefaultModelForRole({
              providerConfigId: result.providerId,
              role: "analysis",
              candidates: result.candidates.analysis,
            }),
          ]);

      const planningModel = tune.find((item) => item.role === "planning")?.modelId ?? result.defaults.planningModelId;
      const analysisModel = tune.find((item) => item.role === "analysis")?.modelId ?? result.defaults.analysisModelId;

      return ok({
        ...result,
        defaults: {
          ...result.defaults,
          planningModelId: planningModel,
          analysisModelId: analysisModel,
        },
        tuning: tune.map((item) => ({
          role: item.role,
          modelId: item.modelId,
          changed: item.changed,
          attempts: item.attempts,
        })),
      });
    } catch (error) {
      return handleRouteError(error);
    }
  });
}

