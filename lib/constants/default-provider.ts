// KKOne 中转站默认配置
// 所有语言模型 / 图像模型请求统一走该中转站
export const DEFAULT_PROVIDER_BASE_URL =
  process.env.NEXT_PUBLIC_DEFAULT_BASE_URL?.trim() || "https://api.kkone.vip/v1";

export const DEFAULT_PROVIDER_API_KEY =
  process.env.NEXT_PUBLIC_DEFAULT_API_KEY?.trim() || "sk-8nWWJskd5Z3GSlMI5zIEqKrdPwMY999BYdLStPnLDSkayp5C";

export const DEFAULT_PROVIDER_NAME = "KKOne 中转站";
