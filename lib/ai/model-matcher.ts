import type { ModelDetectionResult } from "@/types/domain";

/**
 * 默认模型推荐：只在中转站真实返回的上游模型中选择。
 * 不含任何本地写死的模型 ID 作为「必须存在」的依赖，
 * 下面的加权规则只用于在同一能力集合内排序，模型不存在时自动退化为通用打分。
 */

function sortByScore(
  models: ModelDetectionResult[],
  score: (model: ModelDetectionResult) => number,
) {
  return [...models].sort((left, right) => {
    const diff = score(right) - score(left);
    if (diff !== 0) return diff;
    return left.modelId.localeCompare(right.modelId);
  });
}

function isPreviewOrTest(modelId: string) {
  return /(^|[-_])(?:preview|experimental|beta|test|deprecated|legacy)(?:[-_]|$)/i.test(modelId);
}

/**
 * 中转站的 Gemini 通道实测不支持工具调用往返（Agent 兼容检测：
 * /responses 报「超过允许的调用轮次」、/chat 报「未调用要求的工具」，必挂），
 * 因此 Gemini 系不作为规划/图像识别首选；仅在没有其他可用家族时兜底。
 */
export function isToolCallRiskModel(modelId: string) {
  return /gemini/i.test(modelId);
}

/**
 * 上游探活不确定（超时/限流/5xx）的模型不参与首选，
 * 但只要还有别的候选就不会被彻底排除。
 */
function availabilityPenalty(model: ModelDetectionResult) {
  const capabilities = model.capabilities as Record<string, unknown>;
  return capabilities.__probeInconclusive ? 500 : 0;
}

function isStableImageCandidate(modelId: string) {
  return !/(preview|experimental|beta|test)/i.test(modelId);
}

function hasRealImageGeneration(model: ModelDetectionResult) {
  return model.capabilities.image_gen && model.capabilities.real_image_gen !== false;
}

function hasRealImageEdit(model: ModelDetectionResult) {
  return model.capabilities.image_edit && model.capabilities.real_image_edit !== false;
}

function isImageProductionModel(model: ModelDetectionResult) {
  return Boolean(model.capabilities.image_gen || model.capabilities.image_edit);
}

function isTextGenerationCandidate(model: ModelDetectionResult) {
  return Boolean(model.capabilities.text && !isImageProductionModel(model));
}

function isVisionCandidate(model: ModelDetectionResult) {
  return Boolean(model.capabilities.vision && !isImageProductionModel(model));
}

/** 文本模型质量分层：旗舰 > 中端 > 轻量 > 带 pack/preview 后缀 */
function scoreTextCandidate(model: ModelDetectionResult) {
  const id = model.modelId.toLowerCase();
  let score = -availabilityPenalty(model);

  if (model.capabilities.text) score += 20;
  if (model.capabilities.structured_output) score += 10;
  if (model.capabilities.vision) score += 6;
  if (model.capabilities.high_quality) score += 6;
  if (model.capabilities.fast) score += 2;
  if (model.capabilities.cheap) score += 3;

  // 旗舰档（sol / astra / opus / pro / max）
  if (/(^|[-_])(sol|astra|opus|ultra)([-_]|$)/i.test(id)) score += 30;
  if (/(pro|max|high)(?:[-_]|$)/i.test(id)) score += 14;
  // 中端档
  if (/(plus|sonnet|turbo)/i.test(id)) score += 6;
  // 轻量档（可作快速方案，但排序低于旗舰）
  if (/(mini|nano|lite|flash)(?:[-_]|$)/i.test(id)) score += 4;
  // 型号世代：数字越大越新
  const generation = id.match(/(?:gpt|gemini|glm|qwen)[-_]?(\d+(?:\.\d+)?)/);
  if (generation) score += Math.min(parseFloat(generation[1]), 9);

  // 降权项
  if (isToolCallRiskModel(id)) score -= 60;
  if (/pack(?:[-_]|$)/i.test(id)) score -= 25;
  if (isPreviewOrTest(id)) score -= 6;
  if (/(embedding|rerank|moderation|whisper|tts|speech|transcrib|audio|video)/i.test(id)) score -= 40;

  return score;
}

/** 图像解析（vision）专用打分：优先明确的多模态家族 + 工具调用友好家族 */
function scoreVisionCandidate(model: ModelDetectionResult) {
  const id = model.modelId.toLowerCase();
  let score = scoreTextCandidate(model);

  // Agent 流程要求「图片输入 + 工具调用往返」，实测部分 Gemini 通道不支持工具调用，
  // 因此工具调用友好的 GPT 系家族权重更高，最终仍以真实兼容性检测结果为准。
  if (/(^|[-_])(sol|astra|codex)([-_]|$)/i.test(id) || /^gpt-/i.test(id) || /(^|[-_])o[34]([-_]|$)/i.test(id)) {
    score += 55;
  }
  if (/(vision|vl\b|multimodal|omni)/i.test(id)) score += 30;
  if (model.capabilities.vision) score += 10;
  // 纯 pack 变体不作为解析首选
  if (/pack(?:[-_]|$)/i.test(id)) score -= 30;

  return score;
}

/** 图像模型质量分层：gpt-image 2.5 > 2 > Nano Banana Pro > 2.1 > 2 > grok */
function scoreImageCandidate(model: ModelDetectionResult) {
  const id = model.modelId.toLowerCase();
  let score = -availabilityPenalty(model);

  if (hasRealImageGeneration(model)) score += 30;
  if (hasRealImageEdit(model)) score += 10;
  if (model.capabilities.high_quality) score += 4;

  if (/gpt[-_\s]?image[-_\s]?2\.5/i.test(id)) score += 60;
  else if (/gpt[-_\s]?image[-_\s]?2(?:[-_\s]|$)/i.test(id)) score += 50;
  else if (/gpt[-_\s]?image/i.test(id)) score += 35;
  else if (/nano[-_\s]?banana/i.test(id) || /banana/i.test(id)) score += 30;
  else if (/grok[-_\s]?imagine/i.test(id)) score += 20;
  else if (/(imagen|flux|seedream|jimeng|midjourney|ideogram|cogview|dall[-_\s]?e)/i.test(id)) score += 15;

  if (/sunburst/i.test(id)) score += 6;
  if (/flare/i.test(id)) score += 4;
  if (/pro(?:[-_\s]|$)/i.test(id)) score += 5;
  // 通道变体（-cf 等）作为次选
  if (/-cf(?:[-_]|$)/i.test(id)) score -= 8;
  if (isPreviewOrTest(id)) score -= 6;

  return score;
}

/**
 * 按角色给出候选顺序（用于逐个做真实 Agent 兼容性检测）。
 * 只包含上游探活可用、且能力匹配该角色的模型。
 */
export function rankModelCandidates(
  models: ModelDetectionResult[],
  role: "planning" | "analysis" | "image",
  limit = 4,
) {
  const usable = models.filter((model) => model.isAvailable !== false);

  if (role === "analysis") {
    return sortByScore(usable.filter(isVisionCandidate), scoreVisionCandidate)
      .slice(0, limit)
      .map((model) => model.modelId);
  }

  if (role === "planning") {
    return sortByScore(usable.filter(isTextGenerationCandidate), scoreTextCandidate)
      .slice(0, limit)
      .map((model) => model.modelId);
  }

  return sortByScore(usable.filter(hasRealImageEdit), scoreImageCandidate)
    .slice(0, limit)
    .map((model) => model.modelId);
}

export function recommendDefaultModels(models: ModelDetectionResult[]) {
  models = models.filter(model => model.isAvailable !== false);
  const visionModels = models.filter(isVisionCandidate);
  const textModels = models.filter(isTextGenerationCandidate);
  const stableImageGenerationModels = models.filter(
    (item) => hasRealImageGeneration(item) && isStableImageCandidate(item.modelId),
  );
  const imageGenerationModels = models.filter((item) => hasRealImageGeneration(item));
  const stableImageEditModels = models.filter(
    (item) => hasRealImageEdit(item) && isStableImageCandidate(item.modelId),
  );
  const imageEditModels = models.filter((item) => hasRealImageEdit(item));

  // Agent 角色优先选工具调用安全的家族；只有当安全家族完全缺席时才退回全量候选。
  const preferToolSafe = (list: ModelDetectionResult[]) => {
    const safe = list.filter((model) => !isToolCallRiskModel(model.modelId));
    return safe.length ? safe : list;
  };

  const analysisModel =
    sortByScore(preferToolSafe(visionModels), scoreVisionCandidate)[0] ??
    sortByScore(textModels, scoreTextCandidate)[0] ??
    null;

  const planningModel =
    sortByScore(preferToolSafe(textModels.filter((item) => item.capabilities.structured_output)), scoreTextCandidate)[0] ??
    sortByScore(preferToolSafe(textModels), scoreTextCandidate)[0] ??
    null;

  const heroImageModel =
    sortByScore(stableImageGenerationModels, scoreImageCandidate)[0] ??
    sortByScore(imageGenerationModels, scoreImageCandidate)[0] ??
    null;

  const detailImageModel =
    sortByScore(stableImageGenerationModels, scoreImageCandidate)[0] ??
    heroImageModel;

  const imageEditModel =
    sortByScore(stableImageEditModels, scoreImageCandidate)[0] ??
    sortByScore(imageEditModels, scoreImageCandidate)[0] ??
    null;

  return {
    analysisModelId: analysisModel?.modelId ?? null,
    planningModelId: planningModel?.modelId ?? null,
    heroImageModelId: heroImageModel?.modelId ?? null,
    detailImageModelId: detailImageModel?.modelId ?? null,
    imageEditModelId: imageEditModel?.modelId ?? null,
  };
}
