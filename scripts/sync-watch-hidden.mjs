#!/usr/bin/env node
/**
 * 以「无控制台窗口」的方式在后台启动实时同步守护进程。
 *
 * 供需要「无窗口后台常驻」的场景手动启动，或在启动文件夹 / 计划任务中调用：
 * 本进程只负责把 scripts/sync-watch.mjs 派生为一个脱离的、隐藏窗口的子进程，
 * 随后立即退出，因此调用方不会长时间占用进程。
 *
 * 本机日常自启由用户启动文件夹中的 MxPage-GitHub-Sync.vbs 负责。
 *
 * 手动启动：node scripts/sync-watch-hidden.mjs
 */

import { spawn } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

const child = spawn(process.execPath, [path.join(ROOT, "scripts", "sync-watch.mjs")], {
  cwd: ROOT,
  detached: true, // 脱离父进程，计划任务退出后继续运行
  windowsHide: true, // 不创建控制台窗口
  stdio: "ignore",
});
child.unref();
