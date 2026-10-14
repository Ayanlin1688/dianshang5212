/**
 * 与上游拉取同步：
 * 1) 重新拉取中转站模型列表
 * 2) 真实探活文本/视觉模型，剔除上游不可用的模型
 * 3) 用软件自身的 Agent 兼容性检测逐个验证，选出真正能跑通流程的规划/图像识别模型
 * 运行方式：npm run sync:provider
 */
import { config as loadEnv } from "dotenv";

loadEnv();

async function main() {
  const { runWithProviderCredentials, resolveEffectiveBaseUrl } = await import("../lib/services/provider-runtime");
  const { getActiveProviderConfig, syncProviderModelsFromUpstream } = await import("../lib/services/provider-service");
  const { tuneDefaultModelForRole } = await import("../lib/services/analysis-model-tuner");
  const { DEFAULT_PROVIDER_API_KEY, DEFAULT_PROVIDER_BASE_URL, DEFAULT_PROVIDER_NAME } = await import(
    "../lib/constants/default-provider"
  );

  const active = await getActiveProviderConfig();
  const baseUrl = active?.baseUrl || DEFAULT_PROVIDER_BASE_URL;
  const name = active?.name || DEFAULT_PROVIDER_NAME;

  console.log(`[sync] 正在与上游同步：${baseUrl}`);

  await runWithProviderCredentials(
    { apiKey: DEFAULT_PROVIDER_API_KEY, baseUrl: resolveEffectiveBaseUrl(baseUrl) },
    async () => {
      const result = await syncProviderModelsFromUpstream({
        name,
        baseUrl,
        apiKey: DEFAULT_PROVIDER_API_KEY,
        providerId: active?.id ?? null,
        isActive: true,
        probe: true,
      });

      console.log(
        `[sync] 上游模型总数：${result.totalModels}，探活 ${result.probed} 个，确认可用 ${result.availableCount} 个`,
      );

      for (const item of result.unavailable) {
        console.log(`  ✗ 不可用 ${item.modelId} —— ${item.reason}`);
      }
      for (const item of result.inconclusive) {
        console.log(`  ? 探测不确定 ${item.modelId} —— ${item.reason}`);
      }

      console.log("[sync] 兼容性验证（真实调用，较慢）：");
      for (const role of ["planning", "analysis"] as const) {
        const tune = await tuneDefaultModelForRole({
          providerConfigId: result.providerId,
          role,
          candidates: role === "planning" ? result.candidates.planning : result.candidates.analysis,
        });
        const label = role === "planning" ? "规划模型" : "图像识别模型";
        for (const attempt of tune.attempts) {
          console.log(
            `  ${attempt.ok ? "✓" : "✗"} ${label} ${attempt.modelId} · ${attempt.durationMs}ms${
              attempt.ok ? ` · transport=${attempt.transport}` : ` · ${attempt.reason}`
            }`,
          );
        }
        console.log(`[sync] ${label}最终选择：${tune.modelId ?? "未找到可用模型"}`);
      }
    },
  );

  const { prisma } = await import("../lib/db/prisma");
  const defaults = await prisma.modelProfile.findMany({
    where: {
      isAvailable: true,
      OR: [
        { isDefaultPlanning: true },
        { isDefaultAnalysis: true },
        { isDefaultHeroImage: true },
        { isDefaultDetailImage: true },
        { isDefaultImageEdit: true },
      ],
    },
    select: {
      modelId: true,
      isDefaultPlanning: true,
      isDefaultAnalysis: true,
      isDefaultHeroImage: true,
      isDefaultDetailImage: true,
      isDefaultImageEdit: true,
    },
  });
  console.log("[sync] 当前默认分配:", JSON.stringify(defaults, null, 2));
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("[sync] 失败:", error);
  process.exit(1);
});
