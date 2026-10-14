import { config as loadEnv } from "dotenv";

loadEnv();

/** 清理同一 baseUrl + 同名的历史重复服务配置，只保留最新启用的那一个 */
async function main() {
  const { prisma } = await import("../lib/db/prisma");
  const providers = await prisma.providerConfig.findMany({ orderBy: { createdAt: "desc" } });
  const active = providers.find((item) => item.isActive);

  if (!active) {
    console.log("没有启用的服务配置，跳过清理");
    await prisma.$disconnect();
    return;
  }

  const duplicates = providers.filter(
    (item) => !item.isActive && item.baseUrl === active.baseUrl && item.name === active.name,
  );

  if (!duplicates.length) {
    console.log("没有重复的服务配置");
  } else {
    for (const item of duplicates) {
      console.log(`删除重复配置：${item.id} | ${item.name} | ${item.baseUrl}`);
    }
    await prisma.providerConfig.deleteMany({ where: { id: { in: duplicates.map((item) => item.id) } } });
    console.log(`已删除 ${duplicates.length} 个重复配置`);
  }

  const remaining = await prisma.providerConfig.findMany({ include: { models: true } });
  for (const provider of remaining) {
    console.log(
      `保留：${provider.id} | ${provider.name} | active=${provider.isActive} | 模型数=${provider.models.length}`,
    );
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
