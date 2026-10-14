"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";

type Role = "planning" | "analysis";

const ROLE_LABEL: Record<Role, string> = {
  planning: "规划模型",
  analysis: "图像识别模型",
};

export function AgentCompatibility() {
  const [busy, setBusy] = useState<Role | null>(null);
  const [messages, setMessages] = useState<Partial<Record<Role, string>>>({});

  async function check(role: Role) {
    setBusy(role);
    setMessages((prev) => ({ ...prev, [role]: "" }));
    try {
      const response = await fetch("/api/providers/agent-compatibility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const payload = await response.json();
      if (!payload.success) throw new Error(payload.error?.message || "检测失败");
      setMessages((prev) => ({
        ...prev,
        [role]: `检测通过：${payload.data.modelId} · ${payload.data.transport}`,
      }));
    } catch (error) {
      setMessages((prev) => ({
        ...prev,
        [role]: error instanceof Error ? error.message : "检测失败",
      }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-3 rounded-2xl border p-5">
      <h2 className="font-semibold">一键详情页 · Agent 兼容性</h2>
      <p className="text-sm text-muted-foreground">
        先保存下方配置并选择规划、详情图和改图模型。检测会分别调用规划模型与图像识别模型，验证图片识别与工具调用往返；不生成商品图片。
      </p>
      <div className="flex flex-wrap gap-2">
        {(["planning", "analysis"] as Role[]).map((role) => (
          <Button key={role} variant="outline" disabled={busy !== null} onClick={() => check(role)}>
            {busy === role ? "正在检测…" : `检测${ROLE_LABEL[role]}兼容性`}
          </Button>
        ))}
      </div>
      {(["planning", "analysis"] as Role[]).map((role) =>
        messages[role] ? (
          <p key={role} role="status" className="text-sm">
            <span className="text-muted-foreground">{ROLE_LABEL[role]}：</span>
            {messages[role]}
          </p>
        ) : null,
      )}
    </section>
  );
}
