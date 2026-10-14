#!/usr/bin/env node
/**
 * 以「无控制台窗口」的方式在后台启动实时同步守护进程。
 *
 * 由登录计划任务「MxPage-GitHub-Sync」调用：
 * 本进程只负责把 scripts/sync-watch.mjs 派生为一个脱离的、隐藏窗口的子进程，
 * 随后立即退出，因此计划任务本身不会长时间占用进程。
 *
 * 手动启动亦可：node scripts/sync-watch-hidden.mjs
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
