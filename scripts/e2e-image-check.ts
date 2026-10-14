/**
 * 端到端生图体检：走软件真实的 provider adapter + 落盘流程。
 * 分别验证「文生图」「带参考图生图」「图像编辑」三条路径的耗时与产出。
 * 运行方式：npx tsx ./scripts/e2e-image-check.ts
 */
import fs from "fs/promises";
import path from "path";

import { config as loadEnv } from "dotenv";

loadEnv();

async function main() {
  const { getProviderAdapter } = await import("../lib/services/provider-service");
  const { saveGeneratedImage } = await import("../lib/storage/asset-manager");
  const { prisma } = await import("../lib/db/prisma");
  const { runWithProviderCredentials } = await import("../lib/services/provider-runtime");
  const { DEFAULT_PROVIDER_API_KEY, DEFAULT_PROVIDER_BASE_URL } = await import("../lib/constants/default-provider");

  type Capabilities = Record<string, boolean>;
  const readCap = (m: { capabilities: unknown }): Capabilities => (m.capabilities as Capabilities) ?? {};

  const provider = await prisma.providerConfig.findFirst({
    where: { isActive: true },
    include: { models: true },
  });
  if (!provider) {
    console.log("✗ 没有启用的服务配置");
    return;
  }

  const credentials = {
    apiKey: process.env.KKONE_API_KEY || DEFAULT_PROVIDER_API_KEY,
    baseUrl: process.env.KKONE_BASE_URL || provider.baseUrl || DEFAULT_PROVIDER_BASE_URL,
  };

  const { adapter } = await runWithProviderCredentials(credentials, () => getProviderAdapter());

  const genModel =
    provider.models.find((m) => readCap(m).image_gen === true && m.isDefaultHeroImage)?.modelId ??
    provider.models.find((m) => readCap(m).image_gen === true && m.isAvailable !== false)?.modelId ??
    null;
  const editModel =
    provider.models.find((m) => readCap(m).image_edit === true && m.isDefaultImageEdit)?.modelId ?? genModel;

  console.log("服务:", provider.name, "| baseUrl:", provider.baseUrl);
  console.log("生图模型:", genModel, "| 编辑模型:", editModel);
  console.log("");

  const refPath = path.join(process.cwd(), "tmp-e2e-ref.png");
  let refDataUrl = "";
  try {
    const buf = await fs.readFile(refPath);
    refDataUrl = `data:image/png;base64,${buf.toString("base64")}`;
    console.log("参考图:", refPath, `(${buf.byteLength} 字节)`);
  } catch {
    console.log("参考图: 未找到 tmp-e2e-ref.png，跳过带参考图用例");
  }

  // 落盘需要真实的 project/section 外键，自动取最新的一个 section
  const section = await prisma.pageSection.findFirst({ orderBy: { createdAt: "desc" } });
  const projectId = section?.projectId ?? (await prisma.project.findFirst({ orderBy: { createdAt: "desc" } }))?.id;
  const sectionId = section?.id;
  if (!projectId || !sectionId) {
    console.log("✗ 数据库里没有可用的 project/section，跳过落盘（仍会验证生成接口）");
  }
  const storageRoot = process.env.STORAGE_ROOT ?? "storage";

  const kindOf = (r: { b64Json?: string | null; url?: string | null }) =>
    r.b64Json ? "b64(内联)" : r.url ? "url(需下载)" : "无输出";

  async function saveIfPossible(label: string, startedAt: number, source: { url?: string | null; b64Json?: string | null }) {
    if (!projectId || !sectionId) {
      console.log(`  （跳过落盘：无可用 section）| ${label} 全链路 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
      return;
    }
    const saved = await saveGeneratedImage({ projectId, sectionId, prompt: label, source, metadata: { e2e: true } });
    const stat = await fs.stat(path.join(process.cwd(), storageRoot, saved.filePath));
    console.log(`  ✓ 落盘: ${saved.filePath} (${stat.size}B) | ${label} 全链路 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  }


  if (genModel) {
    console.log("── 用例1：文生图（无参考图）──");
    const t1 = Date.now();
    try {
      const result = await adapter.generateImage({
        model: genModel,
        prompt: "a clean product photo of a white ceramic mug on a soft beige background, studio lighting",
        size: "1024x1024",
        aspectRatio: "1:1",
        referenceImages: [],
      });
      console.log(`  生成返回: ${kindOf(result)} | 耗时 ${((Date.now() - t1) / 1000).toFixed(1)}s`);
      await saveIfPossible("e2e text-to-image", t1, { url: result.url, b64Json: result.b64Json });
    } catch (error) {
      console.log(`  ✗ 失败(${((Date.now() - t1) / 1000).toFixed(1)}s):`, error instanceof Error ? error.message.slice(0, 300) : error);
    }
  }

  if (genModel && refDataUrl) {
    console.log("");
    console.log("── 用例2：带参考图生图（主图路径）──");
    const t2 = Date.now();
    try {
      const result = await adapter.generateImage({
        model: genModel,
        prompt: "keep the same subject, place it on a marble counter with soft daylight",
        size: "1024x1024",
        aspectRatio: "1:1",
        referenceImages: [refDataUrl],
      });
      console.log(`  生成返回: ${kindOf(result)} | 耗时 ${((Date.now() - t2) / 1000).toFixed(1)}s`);
      await saveIfPossible("e2e reference-guided image", t2, { url: result.url, b64Json: result.b64Json });
    } catch (error) {
      console.log(`  ✗ 失败(${((Date.now() - t2) / 1000).toFixed(1)}s):`, error instanceof Error ? error.message.slice(0, 300) : error);
    }
  }

  if (editModel && refDataUrl) {
    console.log("");
    console.log("── 用例3：图像编辑 ──");
    const t3 = Date.now();
    try {
      const result = await adapter.editImage({
        model: editModel,
        prompt: "change the background to a dark gray gradient while keeping the subject unchanged",
        image: refDataUrl,
        size: "1024x1024",
        aspectRatio: "1:1",
        referenceImages: [],
      });
      console.log(`  编辑返回: ${kindOf(result)} | 耗时 ${((Date.now() - t3) / 1000).toFixed(1)}s`);
      await saveIfPossible("e2e image edit", t3, { url: result.url, b64Json: result.b64Json });
    } catch (error) {
      console.log(`  ✗ 失败(${((Date.now() - t3) / 1000).toFixed(1)}s):`, error instanceof Error ? error.message.slice(0, 300) : error);
    }
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("[e2e] 失败:", error);
  process.exit(1);
});
