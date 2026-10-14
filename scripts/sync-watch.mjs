#!/usr/bin/env node
/**
 * MxPage → GitHub 实时同步守护进程
 *
 * 职责：监听项目目录的文件改动 → 自动提交 → 调用 github-sync.mjs 推送到 GitHub。
 *
 * - 构建缓存 / 依赖 / 本地数据目录被忽略，不会因为 dev server 重编译而反复提交；
 * - 改动停止 8 秒后才动作（防抖），避免编辑中途产生碎片提交；
 * - 单实例保护：重复启动会检测到已有进程并直接退出；
 * - 日志写入 logs/github-sync.log（超过 5MB 自动轮转）。
 *
 * 用法：
 *   node scripts/sync-watch.mjs            # 前台运行（可看输出）
 *   wscript scripts/sync-watch-hidden.vbs  # 后台静默运行（无控制台窗口）
 *
 * 环境变量：
 *   SYNC_DEBOUNCE_MS   防抖毫秒数，默认 8000
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const LOG_DIR = path.join(ROOT, "logs");
const LOG_FILE = path.join(LOG_DIR, "github-sync.log");
const WATCH_LOCK = path.join(ROOT, ".sync-watch.lock");
const SYNC_SCRIPT = path.join(ROOT, "scripts", "github-sync.mjs");
const DEBOUNCE_MS = Number(process.env.SYNC_DEBOUNCE_MS || 8000);
const MAX_LOG_BYTES = 5 * 1024 * 1024;

/** 被忽略的路径：不参与「变更检测」 */
const IGNORE = [
  /(^|[\\/])\.git([\\/]|$)/,
  /(^|[\\/])node_modules([\\/]|$)/,
  /(^|[\\/])\.next[^\\/]*([\\/]|$)/,
  /(^|[\\/])(?:storage|dist|dist-desktop|build|release|out|logs)([\\/]|$)/,
  /\.github-sync\.(?:json|lock)$/,
  /\.sync-watch\.lock$/,
  /\.log$/,
  /(^|[\\/])\.DS_Store$/,
  /(^|[\\/])~$/,
];
const isIgnored = (rel) => IGNORE.some((re) => re.test(rel));

// ------------------------------------------------------------------ 日志

function writeLog(line) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  try {
    if (fs.statSync(LOG_FILE).size > MAX_LOG_BYTES) fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
  } catch {
    /* 文件不存在或轮转失败，忽略 */
  }
  fs.appendFileSync(LOG_FILE, `${line}\n`);
  process.stdout.write(`${line}\n`);
}

function stamp() {
  return new Date().toLocaleString("zh-CN", { hour12: false });
}

// ------------------------------------------------------------------ git

function git(args) {
  return spawnSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function hasStagedChanges() {
  return git(["diff", "--cached", "--quiet"]).status === 1;
}

function runSync(reason) {
  writeLog(`[watch] ${reason} → 开始同步到 GitHub`);
  const result = spawnSync(process.execPath, [SYNC_SCRIPT], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  for (const line of output.split("\n")) {
    if (line.trim()) writeLog(`[watch]   ${line}`);
  }
  if (result.status === 0) writeLog(`[watch] ${reason} → 同步完成`);
  else writeLog(`[watch] ${reason} → 同步失败（退出码 ${result.status}），将在下次改动时重试`);
}

/** 提交本地改动并同步 */
function cycle(reason) {
  try {
    const add = git(["add", "-A"]);
    if (add.status !== 0) {
      writeLog(`[watch] git add 失败：${(add.stderr || "").trim()}`);
      return;
    }
    if (hasStagedChanges()) {
      const files = git(["diff", "--cached", "--name-only"])
        .stdout.split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const summary =
        files.length > 3
          ? `${files.slice(0, 3).join("、")} 等 ${files.length} 个文件`
          : files.join("、");
      const body = `chore: 自动同步 ${stamp()}${summary ? `\n\n改动：${summary}` : ""}`;
      const commit = git(["commit", "-m", body]);
      if (commit.status !== 0) {
        const detail = `${commit.stderr || commit.stdout || ""}`.trim().split("\n")[0];
        writeLog(`[watch] 提交失败（可能存在冲突）：${detail}`);
        return;
      }
      writeLog(`[watch] ${reason} → 已自动提交`);
    } else {
      writeLog(`[watch] ${reason} → 无新增改动，仅做同步检查`);
    }
    runSync(reason);
  } catch (error) {
    writeLog(`[watch] 同步循环异常：${error?.message ?? error}`);
  }
}

// ------------------------------------------------------------------ 单实例

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function claimLock() {
  try {
    const pid = Number(fs.readFileSync(WATCH_LOCK, "utf8").trim());
    if (pid && pid !== process.pid && isAlive(pid)) {
      writeLog(`[watch] 已有守护进程在运行（PID ${pid}），本次启动退出。`);
      return false;
    }
  } catch {
    /* 锁不存在或不可读，继续 */
  }
  fs.writeFileSync(WATCH_LOCK, String(process.pid));
  return true;
}

function releaseLock() {
  try {
    if (Number(fs.readFileSync(WATCH_LOCK, "utf8").trim()) === process.pid) fs.unlinkSync(WATCH_LOCK);
  } catch {
    /* ignore */
  }
}

// ------------------------------------------------------------------ 主流程

if (!claimLock()) process.exit(0);

writeLog("");
writeLog(`[watch] ===== 启动实时同步守护进程（PID ${process.pid}）=====`);
writeLog(`[watch] 监听目录：${ROOT}`);
writeLog(`[watch] 防抖：${DEBOUNCE_MS} ms`);

let timer = null;
let lastReason = "";

function schedule(reason) {
  lastReason = reason;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    cycle(lastReason);
  }, DEBOUNCE_MS);
}

let watcher;
try {
  watcher = fs.watch(ROOT, { recursive: true }, (_event, filename) => {
    const rel = String(filename ?? "");
    if (rel && isIgnored(rel)) return;
    schedule("文件变更");
  });
} catch (error) {
  writeLog(`[watch] 无法监听目录：${error?.message ?? error}`);
  releaseLock();
  process.exit(1);
}

watcher.on("error", (error) => writeLog(`[watch] 监听错误：${error?.message ?? error}`));

// 启动时先做一次检查，补齐上次退出后遗留的改动
cycle("启动检查");

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    writeLog(`[watch] 收到 ${signal}，退出。`);
    releaseLock();
    process.exit(0);
  });
}
