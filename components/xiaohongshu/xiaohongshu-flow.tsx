"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ChevronLeft,
  CheckCircle2,
  Download,
  Heart,
  ImagePlus,
  Loader2,
  Menu,
  MessageCircle,
  PenLine,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type { XiaohongshuPlan } from "@/lib/ai/schemas/xiaohongshu";
import { cn } from "@/lib/utils";
import { fileToBase64Payload } from "@/lib/utils/base64-upload";
import {
  buildDefaultImagePrompt,
  buildXiaohongshuMarkdown,
  createEmptyXiaohongshuDraft,
  defaultXiaohongshuConfig,
  downloadTextFile,
  loadXiaohongshuDraftWithAssets,
  normalizeXiaohongshuConfig,
  saveXiaohongshuDraft,
  type XiaohongshuDraft,
  type XiaohongshuGeneratedImage,
  type XiaohongshuImageAspectRatio,
  type XiaohongshuReferenceImage,
} from "@/components/xiaohongshu/xiaohongshu-flow-state";

const steps = [
  { href: "/xiaohongshu/plan", label: "1 规划", description: "文本生成" },
  { href: "/xiaohongshu/review", label: "2 调整", description: "编辑提示词" },
  { href: "/xiaohongshu/generate", label: "3 生成", description: "图像生成" },
  { href: "/xiaohongshu/edit", label: "4 修改", description: "图像编辑" },
];

const imageCountOptions = [3, 4, 5, 6, 7, 8];
const aspectRatioOptions: XiaohongshuImageAspectRatio[] = ["1:1", "3:4", "9:16"];

type ApiPayload<T = unknown> = {
  success: boolean;
  data?: T;
  error?: { message?: string; details?: unknown };
};

type TaskPayload = {
  id: string;
  status: "PENDING" | "RUNNING" | "SUCCESS" | "FAILED" | "CANCELED";
  outputPayload?: {
    totalItems?: number;
    completedItems?: number;
    failedItems?: number;
    currentStep?: string;
    images?: XiaohongshuGeneratedImage[];
    items?: Array<{ pageNumber: number; state: string; message: string }>;
  } | null;
  errorMessage?: string | null;
};

function getAspectClass(aspectRatio: XiaohongshuImageAspectRatio) {
  if (aspectRatio === "1:1") return "aspect-square";
  if (aspectRatio === "9:16") return "aspect-[9/16]";
  return "aspect-[3/4]";
}

function FlowNav({ current }: { current: string }) {
  return (
    <div className="grid gap-2 md:grid-cols-4">
      {steps.map((step) => {
        const active = step.href.endsWith(current);
        return (
          <Link
            key={step.href}
            href={step.href}
            className={cn(
              "rounded-2xl border px-4 py-3 transition",
              active
                ? "border-slate-950 bg-slate-950 text-white dark:border-white dark:bg-white dark:text-slate-950"
                : "border-border bg-background hover:bg-muted dark:bg-black/20",
            )}
          >
            <p className="text-sm font-medium">{step.label}</p>
            <p className={cn("mt-1 text-xs", active ? "opacity-75" : "text-muted-foreground")}>{step.description}</p>
          </Link>
        );
      })}
    </div>
  );
}

function EmptyState({ message, actionHref, actionLabel }: { message: string; actionHref: string; actionLabel: string }) {
  return (
    <Card>
      <CardContent className="flex min-h-[280px] flex-col items-center justify-center text-center">
        <Sparkles className="h-10 w-10 text-muted-foreground" />
        <p className="mt-4 text-base font-medium">{message}</p>
        <Link href={actionHref} className={cn(buttonVariants({ variant: "default" }), "mt-5")}>
          {actionLabel}
        </Link>
      </CardContent>
    </Card>
  );
}

function XiaohongshuAppPreview({
  plan,
  selectedIndex,
  imageUrl,
  imageAspectRatio = defaultXiaohongshuConfig.imageAspectRatio,
}: {
  plan: XiaohongshuPlan | null;
  selectedIndex: number;
  imageUrl?: string | null;
  imageAspectRatio?: XiaohongshuImageAspectRatio;
}) {
  const [previewMode, setPreviewMode] = useState<"note" | "cover">("note");
  const page = plan?.pages[selectedIndex] ?? null;
  const ratioClass = getAspectClass(imageAspectRatio);
  const pageCount = plan?.pages.length ?? 0;
  const displayIndex = pageCount > 0 ? Math.min(selectedIndex + 1, pageCount) : 1;
  const authorName = "子圭时安";

  function renderArtwork(compact = false) {
    if (imageUrl) {
      return <img src={imageUrl} alt={page?.title ?? "小红书图文"} className="h-full w-full object-cover" />;
    }

    if (!page) {
      return (
        <div className="flex h-full items-center justify-center bg-slate-100 p-5 text-center text-xs text-slate-500">
          还没有图文规划
        </div>
      );
    }

    return (
      <div className="flex h-full flex-col justify-between bg-[linear-gradient(145deg,#fff7dc,#eef5ff_48%,#fff)] p-4 text-slate-950">
        <div className="space-y-2">
          <div className="inline-flex rounded-full bg-black px-2 py-1 text-[10px] font-semibold text-white">P{page.pageNumber}</div>
          <h2 className={cn("font-black leading-tight tracking-normal", compact ? "text-lg" : "text-3xl")}>{page.title}</h2>
          {page.subtitle ? <p className={cn("font-semibold text-slate-600", compact ? "text-xs" : "text-sm")}>{page.subtitle}</p> : null}
        </div>
        <div className="rounded-2xl border-2 border-slate-950 bg-white/88 p-3 shadow-sm">
          <p className={cn("leading-5 text-slate-800", compact ? "line-clamp-3 text-xs" : "line-clamp-5 text-sm")}>{page.body}</p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-[10px] font-semibold text-slate-900">
          <span className="rounded-lg bg-yellow-300 px-1.5 py-1">先看</span>
          <span className="rounded-lg bg-yellow-300 px-1.5 py-1">再判断</span>
          <span className="rounded-lg bg-yellow-300 px-1.5 py-1">最后做</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[390px] space-y-3">
      <div className="grid rounded-full bg-slate-100 p-1 text-sm font-semibold text-slate-500 dark:bg-white/10 dark:text-slate-400">
        <div className="grid grid-cols-2">
          {[
            ["note", "笔记预览"],
            ["cover", "封面预览"],
          ].map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => setPreviewMode(mode as "note" | "cover")}
              className={cn(
                "h-10 rounded-full transition",
                previewMode === mode ? "bg-white text-slate-950 shadow-sm dark:bg-slate-950 dark:text-white" : "hover:text-slate-700",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto aspect-[71.9/150] w-full max-w-[360px] rounded-[2.4rem] border-[10px] border-[#5a5a5a] bg-[#5a5a5a] shadow-[0_28px_80px_-42px_rgba(15,23,42,0.8)]">
        <div className="relative h-full w-full overflow-hidden rounded-[1.65rem] bg-white text-slate-950">
          <div className="flex h-12 items-end justify-between px-10 pb-2 text-sm font-bold">
            <span>9:41</span>
            <div className="flex items-center gap-1.5">
              <span className="flex h-4 items-end gap-0.5">
                <span className="h-1.5 w-1 rounded-full bg-black" />
                <span className="h-2.5 w-1 rounded-full bg-black" />
                <span className="h-3.5 w-1 rounded-full bg-black" />
              </span>
              <span className="h-3 w-4 rounded-t-full border-2 border-black border-b-0" />
              <span className="h-3.5 w-6 rounded border-2 border-black after:ml-[23px] after:block after:h-1.5 after:w-0.5 after:rounded-r after:bg-black" />
            </div>
          </div>

          {previewMode === "note" ? (
            <div className="flex h-[calc(100%-3rem)] flex-col">
              <div className="flex h-14 items-center justify-between border-b border-slate-100 px-5">
                <div className="flex items-center gap-3">
                  <ChevronLeft className="h-7 w-7" />
                  <div className="h-9 w-9 overflow-hidden rounded-full bg-[linear-gradient(135deg,#111,#ddd)]" />
                  <span className="text-sm font-bold">{authorName}</span>
                </div>
                <div className="flex items-center gap-4">
                  <button type="button" className="rounded-full border border-rose-500 px-4 py-1 text-sm font-bold text-rose-500">
                    关注
                  </button>
                  <Send className="h-6 w-6" />
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-hidden">
                <div className={cn("relative w-full overflow-hidden bg-slate-100", ratioClass)}>
                  {renderArtwork(false)}
                  <div className="absolute right-3 top-2 rounded-full bg-white/82 px-2 py-0.5 text-xs font-bold">
                    {String(displayIndex).padStart(2, "0")} / {String(Math.max(pageCount, 1)).padStart(2, "0")}
                  </div>
                </div>
                <div className="space-y-4 bg-white px-5 py-5 text-sm">
                  <p className="text-xs text-slate-400">编辑于 刚刚</p>
                  <div className="flex items-start gap-3">
                    <div className="h-8 w-8 rounded-full bg-slate-200" />
                    <div className="rounded-2xl bg-slate-50 px-4 py-3 text-slate-500">说点什么，让 TA 也认识笔记里的你</div>
                  </div>
                </div>
              </div>

              <div className="flex h-16 items-center gap-4 border-t border-slate-100 bg-white px-5 pb-2">
                <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-slate-100 px-3 py-2 text-sm text-slate-400">
                  <PenLine className="h-4 w-4" />
                  说点什么...
                </div>
                <Heart className="h-7 w-7" />
                <span className="text-sm font-semibold">点赞</span>
                <Star className="h-7 w-7" />
                <span className="text-sm font-semibold">收藏</span>
                <MessageCircle className="h-7 w-7" />
              </div>
              <div className="absolute bottom-2 left-1/2 h-1 w-28 -translate-x-1/2 rounded-full bg-black" />
            </div>
          ) : (
            <div className="flex h-[calc(100%-3rem)] flex-col">
              <div className="flex h-12 items-center justify-between border-b border-slate-100 px-5">
                <Menu className="h-6 w-6" />
                <div className="flex items-center gap-7 text-base font-semibold">
                  <span className="text-slate-400">关注</span>
                  <span className="relative">
                    发现
                    <span className="absolute -bottom-2 left-1/2 h-0.5 w-6 -translate-x-1/2 rounded-full bg-rose-500" />
                  </span>
                  <span className="text-slate-400">附近</span>
                </div>
                <Search className="h-6 w-6" />
              </div>
              <div className="flex h-10 items-center gap-5 overflow-hidden border-b border-slate-100 px-5 text-sm font-semibold text-slate-400">
                <span className="text-slate-950">推荐</span>
                <span>直播</span>
                <span>短剧</span>
                <span>穿搭</span>
                <span>旅行</span>
              </div>
              <div className="grid min-h-0 flex-1 grid-cols-2 gap-1.5 overflow-hidden bg-slate-100 p-1.5">
                {[0, 1, 2, 3].map((item) => (
                  <div key={item} className="overflow-hidden rounded bg-white">
                    <div className={cn(item === 0 ? ratioClass : item === 2 ? "aspect-[3/5]" : "aspect-[3/4]", "bg-slate-200")}>
                      {item === 0 ? renderArtwork(true) : null}
                    </div>
                    <div className="space-y-2 p-2">
                      <p className="line-clamp-2 text-sm font-semibold">{item === 0 ? page?.title || "示例笔记标题1" : `示例笔记标题${item + 1}`}</p>
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span className="flex items-center gap-1">
                          <span className="h-5 w-5 rounded-full bg-slate-200" />
                          {item === 0 ? authorName : "用户名"}
                        </span>
                        <span className="flex items-center gap-1">
                          <Heart className="h-4 w-4" />0
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="relative flex h-16 items-center justify-around border-t border-slate-100 bg-white pb-2 text-sm font-semibold text-slate-400">
                <span className="text-slate-950">首页</span>
                <span>市集</span>
                <span className="flex h-9 w-12 items-center justify-center rounded-xl bg-rose-500 text-white">
                  <Plus className="h-6 w-6" />
                </span>
                <span>消息</span>
                <span>我</span>
                <div className="absolute bottom-2 left-1/2 h-1 w-28 -translate-x-1/2 rounded-full bg-black" />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PageSelector({
  plan,
  selectedIndex,
  onSelect,
  images,
  imageAspectRatio,
}: {
  plan: XiaohongshuPlan;
  selectedIndex: number;
  onSelect: (index: number) => void;
  images?: XiaohongshuGeneratedImage[];
  imageAspectRatio: XiaohongshuImageAspectRatio;
}) {
  return (
    <div className="grid grid-cols-4 gap-2 sm:grid-cols-8 xl:grid-cols-4 2xl:grid-cols-8">
      {plan.pages.map((page, index) => {
        const generated = images?.find((item) => item.pageNumber === page.pageNumber);
        return (
          <button
            key={`${page.pageNumber}-${page.title}`}
            type="button"
            onClick={() => onSelect(index)}
            className={cn(
              getAspectClass(imageAspectRatio),
              "rounded-xl border p-2 text-left text-xs transition",
              selectedIndex === index
                ? "border-slate-950 bg-slate-950 text-white dark:border-white dark:bg-white dark:text-slate-950"
                : "border-border bg-background hover:bg-muted dark:bg-black/20",
            )}
          >
            <span className="flex items-center justify-between gap-1 text-[10px] opacity-70">
              P{page.pageNumber}
              {generated ? <CheckCircle2 className="h-3 w-3" /> : null}
            </span>
            <span className="mt-1 line-clamp-3 block leading-4">{page.title}</span>
          </button>
        );
      })}
    </div>
  );
}

async function readPayload<T>(response: Response): Promise<ApiPayload<T>> {
  try {
    return (await response.json()) as ApiPayload<T>;
  } catch {
    return {
      success: false,
      error: { message: response.ok ? "响应解析失败" : `请求失败：${response.status}` },
    };
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function XiaohongshuPlanStep() {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [imageCount, setImageCount] = useState(defaultXiaohongshuConfig.imageCount);
  const [imageAspectRatio, setImageAspectRatio] = useState<XiaohongshuImageAspectRatio>(
    defaultXiaohongshuConfig.imageAspectRatio,
  );
  const [referenceImages, setReferenceImages] = useState<XiaohongshuReferenceImage[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void loadXiaohongshuDraftWithAssets().then((draft) => {
      const config = normalizeXiaohongshuConfig(draft.config);
      setTopic(draft.topic);
      setImageCount(config.imageCount);
      setImageAspectRatio(config.imageAspectRatio);
      setReferenceImages(draft.referenceImages ?? []);
    });
  }, []);

  async function handleReferenceUpload(files: FileList | null) {
    const selectedFiles = Array.from(files ?? []).slice(0, 4);
    if (selectedFiles.length === 0) return;

    try {
      const converted = await Promise.all(
        selectedFiles.map(async (file) => {
          const payload = await fileToBase64Payload(file);
          return {
            fileName: payload.fileName,
            mimeType: payload.mimeType,
            dataUrl: `data:${payload.mimeType};base64,${payload.base64Data}`,
          };
        }),
      );
      setReferenceImages(converted);
      toast.success(`已添加 ${converted.length} 张参考图`);
    } catch {
      toast.error("参考图读取失败，请换一张图片重试。");
    }
  }

  async function handlePlan() {
    if (topic.trim().length < 2) {
      toast.error("请输入一个更明确的选题。");
      return;
    }

    setLoading(true);
    const config = normalizeXiaohongshuConfig({ imageCount, imageAspectRatio });
    const usableReferenceImages = referenceImages.filter(
      (image) => typeof image.dataUrl === "string" && image.dataUrl.trim().length > 0,
    );

    try {
      const response = await fetch("/api/xiaohongshu/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topic.trim(),
          imageCount: config.imageCount,
          imageAspectRatio: config.imageAspectRatio,
          images: usableReferenceImages.map((image) => image.dataUrl),
        }),
      });
      const payload = await readPayload<XiaohongshuPlan>(response);
      if (!payload.success || !payload.data) {
        throw new Error(payload.error?.message || "小红书图文规划失败");
      }

      await saveXiaohongshuDraft({
        topic: topic.trim(),
        config,
        referenceImages: usableReferenceImages,
        plan: payload.data,
        images: [],
        updatedAt: new Date().toISOString(),
      });
      toast.success("文本规划完成，进入提示词调整。");
      router.push("/xiaohongshu/review");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "小红书图文规划失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <FlowNav current="plan" />
      <Card>
        <CardHeader>
          <CardTitle>1. 规划选题</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <Textarea
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            placeholder="例如：小户型桌面收纳盒怎么拍出高级感 / 吹风机选购避坑 / 通勤包一周搭配"
            className="min-h-[180px] text-base leading-7"
          />

          <div className="grid gap-4 rounded-2xl border border-border bg-muted/35 p-4 md:grid-cols-2">
            <div className="space-y-3">
              <p className="text-sm font-medium">图片数量</p>
              <div className="flex flex-wrap gap-2">
                {imageCountOptions.map((count) => (
                  <Button
                    key={count}
                    type="button"
                    variant={imageCount === count ? "default" : "outline"}
                    className="h-9 rounded-xl px-3"
                    onClick={() => setImageCount(count)}
                  >
                    {count} 张
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              <p className="text-sm font-medium">图片比例</p>
              <div className="flex flex-wrap gap-2">
                {aspectRatioOptions.map((ratio) => (
                  <Button
                    key={ratio}
                    type="button"
                    variant={imageAspectRatio === ratio ? "default" : "outline"}
                    className="h-9 rounded-xl px-4"
                    onClick={() => setImageAspectRatio(ratio)}
                  >
                    {ratio}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-3 rounded-2xl border border-border bg-muted/35 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">参考图</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  可上传产品图、参考风格图或场景图，最多 4 张；规划和生成都会参考这些图片。
                </p>
              </div>
              <label className={cn(buttonVariants({ variant: "outline" }), "cursor-pointer rounded-2xl")}>
                <ImagePlus className="mr-2 h-4 w-4" />
                上传图像
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(event) => handleReferenceUpload(event.target.files)}
                />
              </label>
            </div>

            {referenceImages.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {referenceImages.map((image, index) => (
                  <div key={`${image.fileName}-${index}`} className="relative overflow-hidden rounded-2xl border border-border bg-background">
                    <div className="aspect-square">
                      <img src={image.dataUrl} alt={image.fileName} className="h-full w-full object-cover" />
                    </div>
                    <button
                      type="button"
                      onClick={() => setReferenceImages((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                      className="absolute right-2 top-2 rounded-full bg-black/70 p-1 text-white"
                      aria-label="移除参考图"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                    <p className="truncate px-3 py-2 text-xs text-muted-foreground">{image.fileName}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                未上传参考图时，Agent 会只根据选题做文字规划。
              </div>
            )}
          </div>
          <Button type="button" onClick={handlePlan} disabled={loading} className="rounded-2xl">
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {loading ? "正在做图文规划..." : "生成图文规划"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export function XiaohongshuReviewStep() {
  const router = useRouter();
  const [draft, setDraft] = useState<XiaohongshuDraft>(createEmptyXiaohongshuDraft());
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    void loadXiaohongshuDraftWithAssets().then((loaded) => {
      if (loaded.plan) {
        loaded.plan.pages = loaded.plan.pages.map((page) => ({
          ...page,
          imagePrompt: page.imagePrompt || buildDefaultImagePrompt(loaded.plan as XiaohongshuPlan, page, loaded.config),
        }));
      }
      setDraft(loaded);
    });
  }, []);

  if (!draft.plan) {
    return <EmptyState message="还没有文本规划，请先完成第一步。" actionHref="/xiaohongshu/plan" actionLabel="去规划" />;
  }

  const config = normalizeXiaohongshuConfig(draft.config);
  const page = draft.plan.pages[selectedIndex];

  function updatePage(patch: Partial<XiaohongshuPlan["pages"][number]>) {
    if (!draft.plan) return;
    const nextPlan = {
      ...draft.plan,
      pages: draft.plan.pages.map((item, index) => (index === selectedIndex ? { ...item, ...patch } : item)),
    };
    setDraft({ ...draft, plan: nextPlan });
  }

  async function handleSaveAndNext() {
    await saveXiaohongshuDraft(draft);
    toast.success("提示词已保存。");
    router.push("/xiaohongshu/generate");
  }

  return (
    <div className="space-y-6">
      <FlowNav current="review" />
      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <Card>
          <CardHeader>
            <CardTitle>2. 用户调整提示词</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <PageSelector
              plan={draft.plan}
              selectedIndex={selectedIndex}
              onSelect={setSelectedIndex}
              imageAspectRatio={config.imageAspectRatio}
            />
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-medium">页面标题</span>
                <Textarea value={page.title} onChange={(event) => updatePage({ title: event.target.value })} />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium">正文要点</span>
                <Textarea value={page.body} onChange={(event) => updatePage({ body: event.target.value })} />
              </label>
            </div>
            <label className="block space-y-2">
              <span className="text-sm font-medium">图像生成提示词</span>
              <Textarea
                value={page.imagePrompt}
                onChange={(event) => updatePage({ imagePrompt: event.target.value })}
                className="min-h-[260px] font-mono text-sm leading-6"
              />
            </label>
            <label className="block space-y-2">
              <span className="text-sm font-medium">负面约束</span>
              <Textarea
                value={page.negativePrompt}
                onChange={(event) => updatePage({ negativePrompt: event.target.value })}
                className="min-h-[90px]"
              />
            </label>
            <Button type="button" onClick={handleSaveAndNext} className="rounded-2xl">
              <Save className="mr-2 h-4 w-4" />
              保存并进入生成
            </Button>
          </CardContent>
        </Card>

        <Card className="xl:sticky xl:top-6 xl:self-start">
          <CardHeader>
            <CardTitle>手机预览</CardTitle>
          </CardHeader>
          <CardContent>
            <XiaohongshuAppPreview plan={draft.plan} selectedIndex={selectedIndex} imageAspectRatio={config.imageAspectRatio} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function XiaohongshuGenerateStep() {
  const router = useRouter();
  const [draft, setDraft] = useState<XiaohongshuDraft>(createEmptyXiaohongshuDraft());
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingPage, setLoadingPage] = useState<number | null>(null);

  useEffect(() => {
    void loadXiaohongshuDraftWithAssets().then(setDraft);
  }, []);

  if (!draft.plan) {
    return <EmptyState message="还没有可生成的提示词，请先完成规划和调整。" actionHref="/xiaohongshu/plan" actionLabel="去规划" />;
  }

  const config = normalizeXiaohongshuConfig(draft.config);
  const selectedImage = draft.images.find((item) => item.pageNumber === draft.plan?.pages[selectedIndex]?.pageNumber);

  async function handleGenerate() {
    if (!draft.plan) return;
    const plan = draft.plan;
    const referenceImages = draft.referenceImages.map((image) => image.dataUrl).filter(Boolean);
    const planPageNumbers = new Set(plan.pages.map((page) => page.pageNumber));
    let nextImages = draft.images.filter((image) => !planPageNumbers.has(image.pageNumber));

    await saveXiaohongshuDraft({ ...draft, images: nextImages });
    setLoading(true);
    setLoadingPage(plan.pages[0]?.pageNumber ?? null);

    try {
      const response = await fetch("/api/tasks/xiaohongshu-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan,
          imageAspectRatio: config.imageAspectRatio,
          referenceImages,
        }),
      });
      const created = await readPayload<TaskPayload>(response);
      if (!created.success || !created.data?.id) {
        throw new Error(created.error?.message ?? "小红书生成任务启动失败");
      }

      for (;;) {
        const taskResponse = await fetch(`/api/tasks/${created.data.id}`, { cache: "no-store" });
        const taskPayload = await readPayload<TaskPayload>(taskResponse);
        if (!taskPayload.success || !taskPayload.data) {
          throw new Error(taskPayload.error?.message ?? "读取小红书生成任务失败");
        }

        const task = taskPayload.data;
        const output = task.outputPayload ?? {};
        const taskImages = Array.isArray(output.images) ? output.images : [];
        if (taskImages.length > 0) {
          nextImages = [
            ...nextImages.filter((image) => !taskImages.some((item) => item.pageNumber === image.pageNumber)),
            ...taskImages,
          ].sort((a, b) => a.pageNumber - b.pageNumber);
          const nextDraft = { ...draft, images: nextImages };
          setDraft(nextDraft);
          await saveXiaohongshuDraft(nextDraft);
        }

        const runningItem = output.items?.find((item) => item.state === "running");
        setLoadingPage(runningItem?.pageNumber ?? null);

        if (task.status === "SUCCESS") {
          const successCount = Number(output.completedItems ?? nextImages.length);
          const failedCount = Number(output.failedItems ?? 0);
          if (successCount > 0 && failedCount > 0) {
            toast.warning(`已生成 ${successCount} 张，${failedCount} 页失败，可稍后重试。`);
          } else if (successCount > 0) {
            toast.success("图像生成完成，可以进入修改。");
          } else {
            toast.error("本次没有成功生成图片，请稍后重试或减少图片数量。");
          }
          break;
        }

        if (task.status === "FAILED" || task.status === "CANCELED") {
          throw new Error(task.errorMessage ?? "小红书生成任务失败");
        }

        await sleep(1800);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "小红书图像生成失败");
    } finally {
      setLoading(false);
      setLoadingPage(null);
    }
  }

  return (
    <div className="space-y-6">
      <FlowNav current="generate" />
      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <Card>
          <CardHeader>
            <CardTitle>3. 图像生成</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <PageSelector
              plan={draft.plan}
              selectedIndex={selectedIndex}
              onSelect={setSelectedIndex}
              images={draft.images}
              imageAspectRatio={config.imageAspectRatio}
            />
            <div className="rounded-2xl border border-border bg-muted/40 p-4 text-sm leading-7 text-muted-foreground">
              将按 {config.imageAspectRatio} 比例逐页生成 {draft.plan.pages.length} 张图片。已成功的页面会立即保存，单页失败不会影响其他页面。
            </div>
            <div className="flex flex-wrap gap-3">
              <Button type="button" onClick={handleGenerate} disabled={loading} className="rounded-2xl">
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-2 h-4 w-4" />}
                {loading
                  ? loadingPage
                    ? `正在生成第 ${loadingPage} 页...`
                    : "正在生成..."
                  : draft.images.length > 0
                    ? "重新生成整组图片"
                    : "生成整组图片"}
              </Button>
              <Link href="/xiaohongshu/edit" className={cn(buttonVariants({ variant: "secondary" }), "rounded-2xl")}>
                进入修改
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card className="xl:sticky xl:top-6 xl:self-start">
          <CardHeader>
            <CardTitle>生成预览</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <XiaohongshuAppPreview
              plan={draft.plan}
              selectedIndex={selectedIndex}
              imageUrl={selectedImage?.imageUrl}
              imageAspectRatio={config.imageAspectRatio}
            />
            {selectedImage ? <p className="text-xs leading-5 text-muted-foreground">模型：{selectedImage.model}</p> : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function XiaohongshuEditStep() {
  const [draft, setDraft] = useState<XiaohongshuDraft>(createEmptyXiaohongshuDraft());
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editPrompt, setEditPrompt] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void loadXiaohongshuDraftWithAssets().then(setDraft);
  }, []);

  const config = normalizeXiaohongshuConfig(draft.config);
  const selectedPage = draft.plan?.pages[selectedIndex] ?? null;
  const selectedImage = useMemo(
    () => draft.images.find((item) => item.pageNumber === selectedPage?.pageNumber) ?? null,
    [draft.images, selectedPage],
  );

  if (!draft.plan) {
    return <EmptyState message="还没有小红书图文规划。" actionHref="/xiaohongshu/plan" actionLabel="去规划" />;
  }

  if (draft.images.length === 0) {
    return <EmptyState message="还没有生成图片，请先完成第三步。" actionHref="/xiaohongshu/generate" actionLabel="去生成" />;
  }

  async function handleEdit() {
    if (!selectedImage || !selectedPage) return;
    if (!selectedImage.imageUrl) {
      toast.error("当前图片没有加载完成，请刷新页面后重试。");
      return;
    }
    if (editPrompt.trim().length < 2) {
      toast.error("请写清楚你想修改哪里。");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/xiaohongshu/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl: selectedImage.imageUrl,
          prompt: editPrompt,
          page: selectedPage,
          imageAspectRatio: config.imageAspectRatio,
        }),
      });
      const payload = await readPayload<{ imageUrl: string; model: string; revisedPrompt?: string; updatedAt: string }>(response);
      if (!payload.success || !payload.data) {
        throw new Error(payload.error?.message ?? "图片修改失败");
      }

      const nextImages = draft.images.map((image) =>
        image.pageNumber === selectedImage.pageNumber
          ? {
              ...image,
              imageUrl: payload.data!.imageUrl,
              model: payload.data!.model,
              revisedPrompt: payload.data!.revisedPrompt,
              updatedAt: payload.data!.updatedAt,
            }
          : image,
      );
      const nextDraft = { ...draft, images: nextImages };
      setDraft(nextDraft);
      await saveXiaohongshuDraft(nextDraft);
      toast.success("当前页已修改。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "图片修改失败");
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    if (!draft.plan) return;
    downloadTextFile(
      "xiaohongshu-final.json",
      JSON.stringify({ config, plan: draft.plan, images: draft.images }, null, 2),
      "application/json;charset=utf-8",
    );
    downloadTextFile("xiaohongshu-final.md", buildXiaohongshuMarkdown(draft.plan), "text/markdown;charset=utf-8");
  }

  return (
    <div className="space-y-6">
      <FlowNav current="edit" />
      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <Card>
          <CardHeader>
            <CardTitle>4. 用户修改不满意的地方</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <PageSelector
              plan={draft.plan}
              selectedIndex={selectedIndex}
              onSelect={setSelectedIndex}
              images={draft.images}
              imageAspectRatio={config.imageAspectRatio}
            />
            <Textarea
              value={editPrompt}
              onChange={(event) => setEditPrompt(event.target.value)}
              placeholder="例如：第 2 页标题太靠边，改成上方居中；背景更干净一点；保留主体，不要改动产品结构。"
              className="min-h-[150px] text-base leading-7"
            />
            <div className="flex flex-wrap gap-3">
              <Button type="button" onClick={handleEdit} disabled={loading || !selectedImage?.imageUrl} className="rounded-2xl">
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PenLine className="mr-2 h-4 w-4" />}
                {loading ? "正在修改当前页..." : "修改当前页"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setEditPrompt("")} className="rounded-2xl">
                <RefreshCw className="mr-2 h-4 w-4" />
                清空修改意见
              </Button>
              <Button type="button" variant="secondary" onClick={handleExport} className="rounded-2xl">
                <Download className="mr-2 h-4 w-4" />
                一键导出
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="xl:sticky xl:top-6 xl:self-start">
          <CardHeader>
            <CardTitle>当前页</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <XiaohongshuAppPreview
              plan={draft.plan}
              selectedIndex={selectedIndex}
              imageUrl={selectedImage?.imageUrl}
              imageAspectRatio={config.imageAspectRatio}
            />
            <p className="text-sm font-medium">{selectedPage?.title}</p>
            <p className="text-xs leading-5 text-muted-foreground">模型：{selectedImage?.model ?? "未生成"}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
