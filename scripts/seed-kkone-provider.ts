/**
 * 种子脚本：将 KKOne 中转站写入数据库，并实时拉取上游模型列表保存。
 * 运行方式：npm run seed:provider
 */
import { config as loadEnv } from "dotenv";

loadEnv();

async function main() {
  const { saveProviderConfig } = await import("../lib/services/provider-service");
  const { DEFAULT_PROVIDER_API_KEY, DEFAULT_PROVIDER_BASE_URL, DEFAULT_PROVIDER_NAME } = await import(
    "../lib/constants/default-provider"
  );

  console.log(`[seed] 正在连接中转站 ${DEFAULT_PROVIDER_BASE_URL} 并拉取上游模型...`);

  const providerId = await saveProviderConfig({
    name: DEFAULT_PROVIDER_NAME,
    baseUrl: DEFAULT_PROVIDER_BASE_URL,
    apiKey: DEFAULT_PROVIDER_API_KEY,
    isActive: true,
  });

  const { prisma } = await import("../lib/db/prisma");
  const count = await prisma.modelProfile.count({ where: { providerConfigId: providerId } });
  const defaults = await prisma.modelProfile.findMany({
    where: {
      providerConfigId: providerId,
      OR: [
        { isDefaultAnalysis: true },
        { isDefaultPlanning: true },
        { isDefaultHeroImage: true },
        { isDefaultDetailImage: true },
        { isDefaultImageEdit: true },
      ],
    },
    select: {
      modelId: true,
      isDefaultAnalysis: true,
      isDefaultPlanning: true,
      isDefaultHeroImage: true,
      isDefaultDetailImage: true,
      isDefaultImageEdit: true,
    },
  });

  console.log(`[seed] 完成！服务配置 ID: ${providerId}`);
  console.log(`[seed] 已拉取并保存 ${count} 个上游模型`);
  console.log("[seed] 默认模型分配:", JSON.stringify(defaults, null, 2));

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("[seed] 失败:", error);
  process.exit(1);
});
