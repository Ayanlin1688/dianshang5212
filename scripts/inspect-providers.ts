import { config as loadEnv } from "dotenv";

loadEnv();

async function main() {
  const { prisma } = await import("../lib/db/prisma");
  const providers = await prisma.providerConfig.findMany({
    include: { models: true },
    orderBy: { createdAt: "asc" },
  });

  for (const provider of providers) {
    const defaults = provider.models.filter(
      (m) =>
        m.isDefaultAnalysis ||
        m.isDefaultPlanning ||
        m.isDefaultHeroImage ||
        m.isDefaultDetailImage ||
        m.isDefaultImageEdit,
    );
    console.log(
      `--- ${provider.id} | ${provider.name} | active=${provider.isActive} | 模型数=${provider.models.length} | 不可用=${
        provider.models.filter((m) => !m.isAvailable).length
      }`,
    );
    for (const model of defaults) {
      console.log(
        `     ${model.modelId} analysis=${model.isDefaultAnalysis} planning=${model.isDefaultPlanning} hero=${model.isDefaultHeroImage} detail=${model.isDefaultDetailImage} edit=${model.isDefaultImageEdit}`,
      );
    }
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
