/**
 * 逐个实测「图像识别模型」候选能否通过 Agent 兼容性检测（图片识别 + 工具调用）。
 * 运行方式：npx tsx ./scripts/check-analysis-models.ts
 */
import { config as loadEnv } from "dotenv";

loadEnv();

const CANDIDATES = [
  "gemini-3.8-flash",
  "gemini-3.8-flash-pack",
  "gpt-6.1-sol",
  "gpt-6-astra",
  "gpt-5.6-sol",
  "codex-auto-review",
];

async function main() {
  const { runWithProviderCredentials, resolveEffectiveBaseUrl } = await import("../lib/services/provider-runtime");
  const { DEFAULT_PROVIDER_API_KEY, DEFAULT_PROVIDER_BASE_URL } = await import("../lib/constants/default-provider");
  const { prisma } = await import("../lib/db/prisma");
  const { resolveAgentConnection } = await import("../lib/detail-runs/provider");

  const provider = await prisma.providerConfig.findFirst({ where: { isActive: true } });
  if (!provider) throw new Error("没有启用的服务配置");

  const before = await prisma.modelProfile.findMany({
    where: { providerConfigId: provider.id, isDefaultAnalysis: true },
    select: { modelId: true },
  });

  await runWithProviderCredentials(
    { apiKey: DEFAULT_PROVIDER_API_KEY, baseUrl: resolveEffectiveBaseUrl(DEFAULT_PROVIDER_BASE_URL) },
    async () => {
      for (const modelId of CANDIDATES) {
        const exists = await prisma.modelProfile.findFirst({
          where: { providerConfigId: provider.id, modelId },
          select: { modelId: true },
        });
        if (!exists) {
          console.log(`SKIP ${modelId}（不在模型库中）`);
          continue;
        }

        await prisma.modelProfile.updateMany({
          where: { providerConfigId: provider.id },
          data: { isDefaultAnalysis: false },
        });
        await prisma.modelProfile.updateMany({
          where: { providerConfigId: provider.id, modelId },
          data: { isDefaultAnalysis: true },
        });

        const startedAt = Date.now();
        try {
          const connection = await resolveAgentConnection(true, "analysis");
          console.log(`PASS ${modelId} · ${connection.transport} · ${Date.now() - startedAt}ms`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.log(`FAIL ${modelId} · ${Date.now() - startedAt}ms · ${message.slice(0, 150)}`);
        }
      }
    },
  );

  // 还原原有默认分配
  await prisma.modelProfile.updateMany({
    where: { providerConfigId: provider.id },
    data: { isDefaultAnalysis: false },
  });
  for (const item of before) {
    await prisma.modelProfile.updateMany({
      where: { providerConfigId: provider.id, modelId: item.modelId },
      data: { isDefaultAnalysis: true },
    });
  }
  console.log("[restore] 已还原原默认图像识别模型:", before.map((item) => item.modelId).join(", ") || "无");

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("[check] 失败:", error);
  process.exit(1);
});
