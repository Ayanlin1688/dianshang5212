import { prisma } from "@/lib/db/prisma";
import { OpenAICompatibleAdapter } from "@/lib/ai/adapters/openai-compatible";
import { normalizeDetectedModels } from "@/lib/ai/capability-detector";
import { recommendDefaultModels } from "@/lib/ai/model-matcher";
import { encryptSecret } from "@/lib/utils/crypto";
import { getRequestProviderCredentials, resolveEffectiveBaseUrl } from "@/lib/services/provider-runtime";
import type {
  CapabilityMap,
  ModelDetectionResult,
  ModelRoleMap,
  ProviderConnectionInput,
} from "@/types/domain";

type RuntimeProviderModel = {
  id: string;
  providerConfigId: string;
  modelId: string;
  label: string;
  capabilities: Record<string, unknown>;
  roles: Record<string, unknown>;
  quality: string | null;
  latency: string | null;
  cost: string | null;
  isAvailable: boolean;
  isDefaultAnalysis: boolean;
  isDefaultPlanning: boolean;
  isDefaultHeroImage: boolean;
  isDefaultDetailImage: boolean;
  isDefaultImageEdit: boolean;
  createdAt: Date;
  updatedAt: Date;
  endpointSupport: {
    imageGeneration: string;
    imageEdit: string;
    note: string | null;
  };
};

type ProviderAdapterContext = {
  provider: {
    id: string;
    name: string;
    baseUrl: string;
    apiKeyEncrypted: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    models: RuntimeProviderModel[];
  };
  apiKey: string;
  adapter: OpenAICompatibleAdapter;
};

type ProviderModelSnapshot = {
  modelId: string;
  label: string;
  capabilities: Record<string, unknown>;
  roles: Record<string, unknown>;
  quality?: string | null;
  latency?: string | null;
  cost?: string | null;
  isAvailable: boolean;
  endpointSupport?: {
    imageGeneration: string;
    imageEdit: string;
    note?: string | null;
  };
};

type DiscoveredProviderModel = {
  id: string;
  label?: string;
  type?: string | null;
  category?: string | null;
  modalities?: string[];
  endpointTypes?: string[];
  ownedBy?: string | null;
};

function maskApiKey(apiKey: string) {
  const trimmed = apiKey.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 10) {
    return `${trimmed.slice(0, 3)}***${trimmed.slice(-2)}`;
  }
  return `${trimmed.slice(0, 6)}***${trimmed.slice(-4)}`;
}

function readEndpointSupport(capabilities: Record<string, unknown> | null | undefined) {
  return {
    imageGeneration: (capabilities?.__imageGenerationStatus as string | undefined) ?? "unknown",
    imageEdit: (capabilities?.__imageEditStatus as string | undefined) ?? "unknown",
    note: (capabilities?.__probeNote as string | undefined) ?? null,
  };
}

function hydrateProviderModels<T extends { capabilities: any }>(models: T[]) {
  return models.map((model) => ({
    ...model,
    endpointSupport: readEndpointSupport(model.capabilities as Record<string, unknown> | undefined),
  }));
}

// 只使用中转站真实返回的上游模型，不再合并任何本地预设模型
// （避免出现中转站并不存在的 gpt-4o / dall-e 等模型被选中导致调用失败）
function mergeDiscoveredModels(_baseUrl: string, models: DiscoveredProviderModel[]) {
  return models;
}

const PASSIVE_IMAGE_CAPABILITY_NOTE =
  "Passive capability detection only; no real image endpoint probe is called during model discovery.";

function enrichModelEndpointSupport(models: ProviderModelSnapshot[]) {
  return models.map((model) => {
    const capabilities = { ...(model.capabilities as Record<string, unknown>) };
    delete capabilities.real_image_gen;
    delete capabilities.real_image_edit;

    const hasImageGeneration = Boolean(capabilities.image_gen);
    const hasImageEdit = Boolean(capabilities.image_edit);
    const endpointSupport = {
      imageGeneration: hasImageGeneration ? ("unknown" as const) : ("not_applicable" as const),
      imageEdit: hasImageEdit ? ("unknown" as const) : ("not_applicable" as const),
      note: hasImageGeneration || hasImageEdit ? PASSIVE_IMAGE_CAPABILITY_NOTE : null,
    };

    capabilities.__imageGenerationStatus = endpointSupport.imageGeneration;
    capabilities.__imageEditStatus = endpointSupport.imageEdit;
    capabilities.__probeNote = endpointSupport.note;

    return {
      ...model,
      capabilities: capabilities as CapabilityMap,
      roles: { ...model.roles } as ModelRoleMap,
      endpointSupport,
    };
  }) satisfies ModelDetectionResult[];
}

async function replaceProviderModels(
  providerConfigId: string,
  models: Awaited<ReturnType<typeof discoverProviderModels>>["models"],
  defaults: {
    analysisModelId?: string | null;
    planningModelId?: string | null;
    heroImageModelId?: string | null;
    detailImageModelId?: string | null;
    imageEditModelId?: string | null;
  },
) {
  await prisma.modelProfile.deleteMany({
    where: { providerConfigId },
  });

  await prisma.modelProfile.createMany({
    data: models.map((model) => ({
      providerConfigId,
      modelId: model.modelId,
      label: model.label,
      capabilities: model.capabilities,
      roles: model.roles,
      quality: model.quality,
      latency: model.latency,
      cost: model.cost,
      isAvailable: model.isAvailable,
      isDefaultAnalysis: defaults.analysisModelId === model.modelId,
      isDefaultPlanning: defaults.planningModelId === model.modelId,
      isDefaultHeroImage: defaults.heroImageModelId === model.modelId,
      isDefaultDetailImage: defaults.detailImageModelId === model.modelId,
      isDefaultImageEdit: defaults.imageEditModelId === model.modelId,
    })),
  });
}

export async function testProviderConnection(input: ProviderConnectionInput) {
  const baseUrl = resolveEffectiveBaseUrl(input.baseUrl);
  const adapter = new OpenAICompatibleAdapter(baseUrl, input.apiKey);
  const startedAt = Date.now();
  try {
    const models = await adapter.listModels();
    return {
      ok: true,
      providerLabel: baseUrl,
      modelCount: models.length,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    throw new Error(describeConnectionFailure(error, input.apiKey));
  }
}

function describeConnectionFailure(error: unknown, apiKey: string) {
  const raw = error instanceof Error ? error.message : String(error);
  const masked = apiKey.length > 10 ? `${apiKey.slice(0, 6)}***${apiKey.slice(-4)}` : "***";

  if (/\((401|403)\)/.test(raw) || /unauthorized|invalid[\s_-]?api[\s_-]?key|no permission|forbidden|invalid token/i.test(raw)) {
    return `不通：API Key 无效或无权限（${masked}）`;
  }
  if (/\((404|405)\)/.test(raw)) {
    return "不通：接口地址错误，未找到 /models 接口，请检查 baseURL 是否为 /v1 结尾";
  }
  if (/\((429)\)/.test(raw)) {
    return "不通：请求过于频繁或额度不足（429）";
  }
  if (/\((5\d\d)\)/.test(raw)) {
    return `不通：中转站服务异常（${raw.match(/\((5\d\d)\)/)?.[1]}）`;
  }
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timeout|aborted|network/i.test(raw)) {
    return "不通：网络连接失败或超时，请检查网络与中转站地址";
  }
  return `不通：${raw}`;
}

export async function resolveProviderConnectionInput(
  input: Omit<ProviderConnectionInput, "apiKey"> & { apiKey?: string | null; id?: string | null },
): Promise<ProviderConnectionInput> {
  const runtimeCredentials = getRequestProviderCredentials();
  const apiKey = input.apiKey?.trim() || runtimeCredentials.apiKey?.trim() || "";
  const baseUrl = resolveEffectiveBaseUrl(input.baseUrl || runtimeCredentials.baseUrl);

  if (!apiKey) {
    throw new Error("API Key is not configured in this browser. Configure it in Provider settings first.");
  }

  if (!baseUrl) {
    throw new Error("Provider baseURL is not configured. Set it in the UI or LOCK_BASE_URL.");
  }

  return {
    name: input.name,
    baseUrl,
    apiKey,
  };
}

export async function discoverProviderModels(input: ProviderConnectionInput) {
  const baseUrl = resolveEffectiveBaseUrl(input.baseUrl);
  const adapter = new OpenAICompatibleAdapter(baseUrl, input.apiKey);
  const models = await adapter.listModels();
  const normalized = enrichModelEndpointSupport(normalizeDetectedModels(mergeDiscoveredModels(baseUrl, models)));
  return {
    models: normalized,
    recommendations: recommendDefaultModels(normalized),
  };
}

export async function saveProviderConfig(
  input: ProviderConnectionInput & {
    id?: string | null;
    isActive?: boolean;
    discoveredModels?: ProviderModelSnapshot[];
    defaultAssignments?: {
      analysisModelId?: string | null;
      planningModelId?: string | null;
      heroImageModelId?: string | null;
      detailImageModelId?: string | null;
      imageEditModelId?: string | null;
    };
  },
) {
  const baseUrl = resolveEffectiveBaseUrl(input.baseUrl);
  const discoveredModels = input.discoveredModels?.length
    ? enrichModelEndpointSupport(input.discoveredModels)
    : (await discoverProviderModels({ ...input, baseUrl })).models;
  const discovered = {
    models: discoveredModels,
    recommendations: recommendDefaultModels(discoveredModels),
  };
  const nextIsActive = input.isActive ?? true;

  if (nextIsActive) {
    await prisma.providerConfig.updateMany({
      data: { isActive: false },
    });
  }

  const provider = input.id
    ? await prisma.providerConfig.update({
        where: { id: input.id },
        data: {
          name: input.name,
          baseUrl,
          apiKeyEncrypted: encryptSecret(""),
          isActive: nextIsActive,
        },
      })
    : await prisma.providerConfig.create({
        data: {
          name: input.name,
          baseUrl,
          apiKeyEncrypted: encryptSecret(""),
          isActive: nextIsActive,
        },
      });

  const defaults = {
    ...discovered.recommendations,
    ...(input.defaultAssignments ?? {}),
  };

  await replaceProviderModels(provider.id, discovered.models, defaults);
  return provider.id;
}

export async function getAllProviderConfigs() {
  const providers = await prisma.providerConfig.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      models: {
        orderBy: { modelId: "asc" },
      },
    },
  });

  return providers.map((provider) => {
    const effectiveBaseUrl = resolveEffectiveBaseUrl(provider.baseUrl);
    return {
      ...provider,
      baseUrl: effectiveBaseUrl,
      apiKey: "",
      maskedApiKey: "",
      models: hydrateProviderModels(provider.models) as RuntimeProviderModel[],
    };
  });
}

export async function getActiveProviderConfig() {
  const provider = await prisma.providerConfig.findFirst({
    where: { isActive: true },
    include: {
      models: {
        orderBy: { modelId: "asc" },
      },
    },
  });

  if (!provider) return null;

  const effectiveBaseUrl = resolveEffectiveBaseUrl(provider.baseUrl);
  return {
    ...provider,
    baseUrl: effectiveBaseUrl,
    apiKey: "",
    maskedApiKey: "",
    models: hydrateProviderModels(provider.models) as RuntimeProviderModel[],
  };
}

export async function activateProviderConfig(providerId: string) {
  const provider = await prisma.providerConfig.findUnique({
    where: { id: providerId },
  });

  if (!provider) {
    throw new Error("未找到要切换的历史服务配置。");
  }

  await prisma.$transaction([
    prisma.providerConfig.updateMany({
      data: { isActive: false },
    }),
    prisma.providerConfig.update({
      where: { id: providerId },
      data: { isActive: true },
    }),
  ]);

  return getAllProviderConfigs();
}

export async function deleteProviderConfig(providerId: string) {
  const provider = await prisma.providerConfig.findUnique({
    where: { id: providerId },
  });

  if (!provider) {
    throw new Error("未找到要删除的历史服务配置。");
  }

  await prisma.$transaction(async (tx) => {
    await tx.providerConfig.delete({
      where: { id: providerId },
    });

    if (!provider.isActive) {
      return;
    }

    const fallbackProvider = await tx.providerConfig.findFirst({
      orderBy: { updatedAt: "desc" },
    });

    await tx.providerConfig.updateMany({
      data: { isActive: false },
    });

    if (fallbackProvider) {
      await tx.providerConfig.update({
        where: { id: fallbackProvider.id },
        data: { isActive: true },
      });
    }
  });

  return getAllProviderConfigs();
}

export async function getProviderAdapter(providerId?: string): Promise<ProviderAdapterContext> {
  const provider =
    (providerId
      ? await prisma.providerConfig.findUnique({
          where: { id: providerId },
          include: { models: true },
        })
      : await prisma.providerConfig.findFirst({
          where: { isActive: true },
          include: { models: true },
        })) ?? null;

  if (!provider) {
    throw new Error("No active provider config found.");
  }

  const runtimeCredentials = getRequestProviderCredentials();
  const apiKey = runtimeCredentials.apiKey?.trim() ?? "";
  if (!apiKey) {
    throw new Error("API Key is not configured in this browser. Configure it in Provider settings first.");
  }
  const baseUrl = resolveEffectiveBaseUrl(runtimeCredentials.baseUrl ?? provider.baseUrl);
  const runtimeModels = hydrateProviderModels(provider.models) as unknown as RuntimeProviderModel[];

  return {
    provider: {
      ...provider,
      baseUrl,
      models: runtimeModels,
    },
    apiKey,
    adapter: new OpenAICompatibleAdapter(baseUrl, apiKey),
  };
}
