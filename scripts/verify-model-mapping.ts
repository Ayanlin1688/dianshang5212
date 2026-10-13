/** 输出模型 → 软件功能区 的完整映射，用于核对 */
import { config as loadEnv } from "dotenv";

loadEnv();

const ROLES = [
  { key: "isDefaultAnalysis", label: "图像解析" },
  { key: "isDefaultPlanning", label: "文本规划" },
  { key: "isDefaultHeroImage", label: "主图生成" },
  { key: "isDefaultDetailImage", label: "详情图生成" },
  { key: "isDefaultImageEdit", label: "图像编辑" },
];

async function main() {
  const { prisma } = await import("../lib/db/prisma");
  const provider = await prisma.providerConfig.findFirst({ where: { isActive: true } });
  if (!provider) throw new Error("no active provider");

  const models = await prisma.modelProfile.findMany({
    where: { providerConfigId: provider.id },
    orderBy: { modelId: "asc" },
  });

  const text: string[] = [];
  const vision: string[] = [];
  const gen: string[] = [];
  const edit: string[] = [];
  const none: string[] = [];

  for (const m of models) {
    const c = m.capabilities as Record<string, unknown>;
    const tags: string[] = [];
    if (c.text) tags.push("文本");
    if (c.vision) tags.push("识别");
    if (c.image_gen) tags.push("生成");
    if (c.image_edit) tags.push("编辑");

    if (c.text) text.push(m.modelId);
    if (c.vision) vision.push(m.modelId);
    if (c.image_gen) gen.push(m.modelId);
    if (c.image_edit) edit.push(m.modelId);
    if (tags.length === 0) none.push(m.modelId);

    const flags = ROLES.filter((r) => (m as Record<string, unknown>)[r.key]).map((r) => r.label);
    console.log(
      `${m.modelId.padEnd(34)} [${tags.join("/") || "—"}]${flags.length ? "  默认→ " + flags.join("、") : ""}`,
    );
  }

  console.log("\n===== 功能区可用模型汇总 =====");
  console.log(`文本规划(${text.length}):`, text.join(", ") || "无");
  console.log(`图像解析(${vision.length}):`, vision.join(", ") || "无");
  console.log(`图像生成(${gen.length}):`, gen.join(", ") || "无");
  console.log(`图像编辑(${edit.length}):`, edit.join(", ") || "无");
  console.log(`未匹配任何功能区(${none.length}):`, none.join(", ") || "无");

  console.log("\n===== 当前默认分配 =====");
  for (const role of ROLES) {
    const hit = models.filter((m) => (m as Record<string, unknown>)[role.key]).map((m) => m.modelId);
    console.log(`${role.label}: ${hit.join("、") || "未设置"}`);
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
