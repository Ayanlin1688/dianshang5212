/** 修正默认模型分配为中转站真实上游模型，并列出能力标签 */
import { config as loadEnv } from "dotenv";

loadEnv();

async function main() {
  const { prisma } = await import("../lib/db/prisma");

  const provider = await prisma.providerConfig.findFirst({ where: { isActive: true } });
  if (!provider) throw new Error("no active provider");

  const models = await prisma.modelProfile.findMany({
    where: { providerConfigId: provider.id },
    select: { modelId: true, capabilities: true },
  });

  for (const m of models) {
    const c = m.capabilities as Record<string, unknown>;
    const tags = [c.text && "text", c.vision && "vision", c.image_gen && "img", c.image_edit && "edit"]
      .filter(Boolean)
      .join(",");
    console.log(m.modelId, "=>", tags);
  }

  // 重置默认标记
  await prisma.modelProfile.updateMany({
    where: { providerConfigId: provider.id },
    data: {
      isDefaultAnalysis: false,
      isDefaultPlanning: false,
      isDefaultHeroImage: false,
      isDefaultDetailImage: false,
      isDefaultImageEdit: false,
    },
  });

  // 选择中转站真实存在的上游模型作为默认（按候选顺序优先）
  const pick = (candidates: string[]) =>
    candidates.find((id) => models.some((m) => m.modelId === id)) ?? null;

  const planning = pick(["gpt-6.1-sol", "gpt-6-sol", "gpt-6-astra", "gpt-5.6-sol", "gemini-3.1-pro-high"]);
  const analysis = pick(["gemini-3.1-pro-preview", "gemini-3.1-pro-high", "gpt-6-astra", planning ?? ""]);
  const heroImage = pick(["gpt-image-2.5-sunburst", "gpt-image-2.5-flare", "gpt-image-2"]);
  const imageEdit = pick(["gpt-image-2.5-sunburst", "gpt-image-2.5-flare", "grok-imagine-image-edit", "gpt-image-2"]);

  console.log("\n默认模型分配:", { planning, analysis, heroImage, imageEdit });

  const setDefault = async (modelId: string | null, field: string) => {
    if (!modelId) return;
    await prisma.modelProfile.updateMany({
      where: { providerConfigId: provider.id, modelId },
      data: { [field]: true },
    });
  };

  await setDefault(planning, "isDefaultPlanning");
  await setDefault(analysis, "isDefaultAnalysis");
  await setDefault(heroImage, "isDefaultHeroImage");
  await setDefault(heroImage, "isDefaultDetailImage");
  await setDefault(imageEdit, "isDefaultImageEdit");

  console.log("[fix] 默认模型已更新");
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
