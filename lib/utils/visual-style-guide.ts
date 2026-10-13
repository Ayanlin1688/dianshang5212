export type VisualStyleGuide = {
  styleName: string;
  colorPalette: string;
  backgroundSystem: string;
  lighting: string;
  cameraLanguage: string;
  typography: string;
  layoutRules: string;
  propRules: string;
  productRenderingRules: string;
  negativeStyleConstraints: string;
};

export const visualStyleGuideFieldLabels: Record<keyof VisualStyleGuide, string> = {
  styleName: "风格名称",
  colorPalette: "主色 / 辅助色",
  backgroundSystem: "背景系统",
  lighting: "光线方向",
  cameraLanguage: "镜头语言",
  typography: "字体气质",
  layoutRules: "版式密度",
  propRules: "道具规则",
  productRenderingRules: "商品表现规则",
  negativeStyleConstraints: "负面约束",
};

const visualStyleGuideKeys = Object.keys(visualStyleGuideFieldLabels) as Array<keyof VisualStyleGuide>;

function stringifyUnknown(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean).join("；");
  if (value && typeof value === "object") return JSON.stringify(value);
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

export function buildDefaultVisualStyleGuide(context?: { productName?: string; styleLabel?: string; platformLabel?: string }): VisualStyleGuide {
  const productName = context?.productName?.trim() || "当前商品";
  const styleLabel = context?.styleLabel?.trim() || "清爽高级电商风";
  const platformLabel = context?.platformLabel?.trim() || "移动端电商详情页";

  return {
    styleName: `${styleLabel}统一视觉系统`,
    colorPalette: "以商品真实颜色为主色，搭配低饱和浅色背景；全套头图和详情页保持同一组主色、辅助色和强调色。",
    backgroundSystem: `适合${platformLabel}的干净商业背景，头图和详情页共享相同材质、空间感和留白逻辑，避免每张图切换完全不同场景。`,
    lighting: "统一使用柔和商业棚拍光，主光方向保持一致，阴影柔和且连续，商品高光不过曝。",
    cameraLanguage: "头图可使用不同角度，但镜头焦段、透视强度和商品占比保持同一体系；详情页延续同样的产品比例和观察距离。",
    typography: "图内中文使用同一字体气质、字重层级和标题/卖点/CTA 规则；避免不同图片混用完全不同字体风格。",
    layoutRules: "统一标题区、卖点区、商品区和 CTA 的安全边距；信息密度中等，移动端优先，避免过度拥挤。",
    propRules: "只使用与商品真实使用场景相关的少量道具，道具色彩服从主色体系，不抢商品主体。",
    productRenderingRules: `${productName}必须保持同一外形、材质、颜色、比例、开口、线缆、按钮、结构方向和品牌识别点。`,
    negativeStyleConstraints: "禁止忽明忽暗、背景风格跳变、字体混乱、CTA 样式不一致、商品比例漂移、文字穿过商品、线缆插入桌面、悬浮、阴影断裂、反向风或其他不合理物理现象。",
  };
}

export function normalizeVisualStyleGuide(value: unknown, fallback?: VisualStyleGuide): VisualStyleGuide {
  const base = fallback ?? buildDefaultVisualStyleGuide();
  const raw = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

  return visualStyleGuideKeys.reduce((guide, key) => {
    const nextValue = stringifyUnknown(raw[key]);
    guide[key] = nextValue || base[key];
    return guide;
  }, { ...base } as VisualStyleGuide);
}

export function hasVisualStyleGuide(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const raw = value as Record<string, unknown>;
  return visualStyleGuideKeys.some((key) => stringifyUnknown(raw[key]).length > 0);
}

export function readVisualStyleGuide(snapshot: unknown, fallback?: VisualStyleGuide) {
  const raw = (snapshot as Record<string, unknown> | null)?.visualStyleGuide;
  if (!hasVisualStyleGuide(raw)) return null;
  return normalizeVisualStyleGuide(raw, fallback);
}

export function visualStyleGuideToPrompt(guide: VisualStyleGuide) {
  return visualStyleGuideKeys
    .map((key) => `${visualStyleGuideFieldLabels[key]}: ${guide[key]}`)
    .join("\n");
}