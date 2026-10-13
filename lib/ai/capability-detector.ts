import type { CapabilityMap, ModelDetectionResult, ModelRoleMap } from "@/types/domain";

type DetectedModelInput = {
  id: string;
  label?: string;
  type?: string | null;
  category?: string | null;
  modalities?: string[];
  endpointTypes?: string[];
  ownedBy?: string | null;
};

const emptyCapabilityMap = (): CapabilityMap => ({
  text: false,
  vision: false,
  image_gen: false,
  image_edit: false,
  structured_output: false,
  fast: false,
  cheap: false,
  high_quality: false,
});

const emptyRoleMap = (): ModelRoleMap => ({
  analysis: false,
  planning: false,
  hero_image: false,
  detail_image: false,
  image_edit: false,
});

function modelText(model: string | DetectedModelInput) {
  if (typeof model === "string") {
    return model.toLowerCase();
  }

  return [
    model.id,
    model.label,
    model.type,
    model.category,
    model.ownedBy,
    ...(model.modalities ?? []),
    ...(model.endpointTypes ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function detectModelCapabilities(model: string | DetectedModelInput): CapabilityMap {
  const id = (typeof model === "string" ? model : model.id).toLowerCase();
  const text = modelText(model);
  const map = emptyCapabilityMap();
  const endpointTypes = typeof model === "string" ? [] : (model.endpointTypes ?? []);
  const endpointText = endpointTypes.join(" ").toLowerCase();

  // 上游显式声明的端点类型优先（openai-compatible /v1/models 的 supported_endpoint_types）
  const declaresVideoOnly =
    endpointText.includes("video") && !endpointText.includes("image-generation") && !endpointText.includes("chat");
  const declaresImageGeneration = endpointText.includes("image-generation");
  const declaresGemini = endpointText.includes("gemini");

  const isGptImageModel = /(?:^|[-_\s])gpt[-_\s]?image(?:[-_\s]?(?:\d+(?:\.\d+)?|mini))?|chatgpt-image/.test(id);
  const isDallE2 = /dall[-_\s]?e[-_\s]?2/.test(id);
  const isImageTyped = /(^|\b)(image|images|image_generation|image-gen|image_gen)(\b|$)/.test(text);
  const isImageEditTyped = /(image_edit|image-edit|edit|edits|inpaint|mask|retouch)/.test(text);
  const isVisionTyped = /(vision|visual|multimodal|image_input|image-input)/.test(text);
  const isTextTyped = /(^|\b)(text|chat|llm|language|completion|completions)(\b|$)/.test(text);
  const isUtilityModel = /(embedding|embed|rerank|ranker|moderation|whisper|tts|speech|transcrib|audio|sora|video)/.test(id);

  // 视频模型不属于本软件任何功能区，直接不赋予能力
  if (declaresVideoOnly || isUtilityModel) {
    return map;
  }

  if (
    (/(^|[-_])o[134](?:[-_]|$)|gpt|gemini|claude|qwen|qwq|qvq|glm|deepseek|chat|instruct|command|llama|mistral|mixtral|moonshot|kimi|yi-|ernie|hunyuan|spark|doubao|minimax|abab|grok|reka|cohere|sonar/.test(id) ||
      isTextTyped) &&
    !isImageTyped &&
    !declaresImageGeneration
  ) {
    map.text = true;
    map.structured_output = true;
  }

  if (/(vision|vl|4o|omni|gemini|multimodal|qwen-vl|qvq|pixtral|llava|visual|claude-3|claude-sonnet|claude-opus|gpt-4\.1|gpt-[56])/.test(id) || isVisionTyped) {
    map.vision = true;
    map.text = true;
    map.structured_output = true;
  }

  if (
    /(image|imagen|flux|sdxl|stable-diffusion|stable.?image|banana|nano-banana|recraft|dall[-_ ]?e|seedream|jimeng|midjourney|mj-|ideogram|hidream|kolors|wanx|cogview|playground|leonardo)/.test(id) ||
    isImageTyped ||
    declaresImageGeneration
  ) {
    map.image_gen = true;
    map.high_quality = true;
  }

  if (/(edit|inpaint|mask|kontext|retouch|erase|remove.?background)/.test(id) || isImageEditTyped) {
    map.image_edit = true;
  }

  if (isGptImageModel) {
    map.image_gen = true;
    map.image_edit = true;
    map.high_quality = true;
  }

  // 中转站声明为图像生成端点的模型，通常同时支持图生图编辑
  if (declaresImageGeneration) {
    map.image_gen = true;
    map.image_edit = true;
    map.high_quality = true;
  }

  // 谷歌 Gemini 图像系列（Nano Banana）原生支持生成 + 编辑
  if (declaresGemini && map.image_gen) {
    map.image_edit = true;
  }

  if (isDallE2) {
    map.image_edit = true;
  }

  if (/(flash|mini|nano|lite|turbo|instant)/.test(id)) {
    map.fast = true;
    map.cheap = true;
  }

  if (/(pro|ultra|4\\.1|opus|quality|max)/.test(id)) {
    map.high_quality = true;
  }

  if (!Object.values(map).some(Boolean)) {
    map.text = true;
  }

  return map;
}

export function detectModelRoles(capabilities: CapabilityMap): ModelRoleMap {
  const roles = emptyRoleMap();

  if (capabilities.text) {
    roles.analysis = true;
    roles.planning = true;
  }

  if (capabilities.image_gen) {
    roles.hero_image = true;
    roles.detail_image = true;
  }

  if (capabilities.image_edit) {
    roles.image_edit = true;
  }

  return roles;
}

export function normalizeDetectedModels(
  models: DetectedModelInput[],
): ModelDetectionResult[] {
  return models.map((model) => {
    const capabilities = detectModelCapabilities(model);
    return {
      modelId: model.id,
      label: model.label ?? model.id,
      capabilities,
      roles: detectModelRoles(capabilities),
      quality: capabilities.high_quality ? "high" : capabilities.fast ? "balanced" : "standard",
      latency: capabilities.fast ? "fast" : "standard",
      cost: capabilities.cheap ? "low" : capabilities.high_quality ? "high" : "medium",
      isAvailable: true,
    };
  });
}
