"use client";

import { useMemo, useState } from "react";
import { Copy, Download, FileJson, Loader2, Sparkles, Smartphone } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type { XiaohongshuPlan } from "@/lib/ai/schemas/xiaohongshu";

function downloadText(fileName: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function buildMarkdown(plan: XiaohongshuPlan) {
  return [
    `# ${plan.coverTitle}`,
    plan.coverSubtitle,
    "",
    `选题：${plan.topic}`,
    `人群：${plan.audience}`,
    `洞察：${plan.coreInsight}`,
    "",
    "## 标题备选",
    ...plan.titleOptions.map((title, index) => `${index + 1}. ${title}`),
    "",
    "## 分页脚本",
    ...plan.pages.flatMap((page) => [
      `### ${page.pageNumber}. ${page.title}`,
      page.subtitle ? `副标题：${page.subtitle}` : "",
      `正文：${page.body}`,
      `画面：${page.visualDirection}`,
      `版式：${page.layout}`,
      page.negativePrompt ? `避免：${page.negativePrompt}` : "",
      "",
    ]),
    "## 发布文案",
    plan.caption,
    "",
    plan.hashtags.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`)).join(" "),
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function XiaohongshuWorkspace() {
  const [topic, setTopic] = useState("");
  const [plan, setPlan] = useState<XiaohongshuPlan | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);

  const selectedPage = useMemo(() => plan?.pages[selectedIndex] ?? null, [plan, selectedIndex]);

  async function handlePlan() {
    if (topic.trim().length < 2) {
      toast.error("请输入一个更明确的选题。");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/xiaohongshu/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic }),
      });
      const payload = await response.json();
      if (!payload.success) {
        throw new Error(payload.error?.message ?? "小红书图文规划失败");
      }
      setPlan(payload.data);
      setSelectedIndex(0);
      toast.success("小红书图文规划已生成");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "小红书图文规划失败");
    } finally {
      setLoading(false);
    }
  }

  function handleExportJson() {
    if (!plan) return;
    downloadText("xiaohongshu-plan.json", JSON.stringify(plan, null, 2), "application/json;charset=utf-8");
  }

  function handleExportMarkdown() {
    if (!plan) return;
    downloadText("xiaohongshu-plan.md", buildMarkdown(plan), "text/markdown;charset=utf-8");
  }

  async function handleCopyCaption() {
    if (!plan) return;
    await navigator.clipboard.writeText(buildMarkdown(plan));
    toast.success("图文脚本已复制");
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>选题输入</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              placeholder="例如：小户型桌面收纳盒怎么拍出高级感 / 吹风机选购避坑 / 通勤包一周搭配"
              className="min-h-[140px] text-base leading-7"
            />
            <Button type="button" onClick={handlePlan} disabled={loading} className="w-full rounded-2xl">
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              {loading ? "正在规划..." : "生成图文规划"}
            </Button>
          </CardContent>
        </Card>

        {plan ? (
          <Card>
            <CardHeader>
              <CardTitle>{plan.coverTitle}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-border bg-muted/50 p-4">
                  <p className="text-xs text-muted-foreground">目标人群</p>
                  <p className="mt-2 text-sm leading-6">{plan.audience}</p>
                </div>
                <div className="rounded-2xl border border-border bg-muted/50 p-4">
                  <p className="text-xs text-muted-foreground">核心洞察</p>
                  <p className="mt-2 text-sm leading-6">{plan.coreInsight}</p>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">标题备选</p>
                <div className="flex flex-wrap gap-2">
                  {plan.titleOptions.map((title) => (
                    <Badge key={title} variant="outline" className="max-w-full truncate">
                      {title}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">发布文案</p>
                <div className="rounded-2xl border border-border bg-background p-4 text-sm leading-7 dark:bg-black/20">
                  {plan.caption}
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {plan.hashtags.map((tag) => (
                      <span key={tag}>{tag.startsWith("#") ? tag : `#${tag}`}</span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button type="button" variant="outline" onClick={handleExportMarkdown}>
                  <Download className="mr-2 h-4 w-4" />
                  一键导出文案
                </Button>
                <Button type="button" variant="outline" onClick={handleExportJson}>
                  <FileJson className="mr-2 h-4 w-4" />
                  导出 JSON
                </Button>
                <Button type="button" variant="secondary" onClick={handleCopyCaption}>
                  <Copy className="mr-2 h-4 w-4" />
                  复制脚本
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <div className="xl:sticky xl:top-6 xl:self-start">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>手机图文预览</CardTitle>
              <Badge variant="outline">
                <Smartphone className="mr-1 h-3.5 w-3.5" />
                3:4
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="mx-auto w-full max-w-[390px] rounded-[2.25rem] border-[10px] border-slate-950 bg-slate-950 shadow-[0_28px_80px_-42px_rgba(15,23,42,0.8)] dark:border-black">
              <div className="overflow-hidden rounded-[1.45rem] bg-[#f7f3ea]">
                <div className="aspect-[3/4] p-5">
                  {selectedPage ? (
                    <div className="flex h-full flex-col justify-between rounded-[1.25rem] bg-[linear-gradient(145deg,#fffaf0,#eaf3ff_54%,#fff)] p-5 text-slate-950 shadow-inner">
                      <div className="space-y-3">
                        <Badge className="rounded-full">P{selectedPage.pageNumber}</Badge>
                        <h2 className="text-3xl font-semibold leading-tight tracking-normal">{selectedPage.title}</h2>
                        {selectedPage.subtitle ? (
                          <p className="text-base font-medium leading-6 text-slate-600">{selectedPage.subtitle}</p>
                        ) : null}
                      </div>
                      <div className="rounded-2xl bg-white/78 p-4 shadow-sm">
                        <p className="text-sm leading-7 text-slate-700">{selectedPage.body}</p>
                      </div>
                      <div className="space-y-2 text-xs leading-5 text-slate-500">
                        <p>{selectedPage.visualDirection}</p>
                        <p>{selectedPage.layout}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center rounded-[1.25rem] border border-dashed border-slate-300 bg-white/70 p-6 text-center">
                      <Sparkles className="h-10 w-10 text-slate-400" />
                      <p className="mt-4 text-lg font-semibold text-slate-900">等待生成图文规划</p>
                      <p className="mt-2 text-sm leading-6 text-slate-500">输入选题后，这里会展示每一页的手机端预览。</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {plan ? (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-8 xl:grid-cols-4 2xl:grid-cols-8">
                {plan.pages.map((page, index) => (
                  <button
                    key={`${page.pageNumber}-${page.title}`}
                    type="button"
                    onClick={() => setSelectedIndex(index)}
                    className={`aspect-[3/4] rounded-xl border p-2 text-left text-xs transition ${
                      selectedIndex === index
                        ? "border-slate-950 bg-slate-950 text-white dark:border-white dark:bg-white dark:text-slate-950"
                        : "border-border bg-background hover:bg-muted dark:bg-black/20"
                    }`}
                  >
                    <span className="block text-[10px] opacity-70">P{page.pageNumber}</span>
                    <span className="mt-1 line-clamp-3 block leading-4">{page.title}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
