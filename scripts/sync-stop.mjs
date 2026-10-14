#!/usr/bin/env node
/**
 * 实时同步的状态查看与停止工具。
 *
 *   node scripts/sync-stop.mjs          # 查看守护进程与同步状态
 *   node scripts/sync-stop.mjs --stop   # 停止守护进程
 *
 * 亦可通过 npm 调用：npm run github:status / npm run github:stop
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const WATCH_LOCK = path.join(ROOT, ".sync-watch.lock");
const STATE_PATH = path.join(ROOT, ".github-sync.json");
const LOG_FILE = path.join(ROOT, "logs", "github-sync.log");

function readPid(file) {
  try {
    const pid = Number(fs.readFileSync(file, "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

const pid = readPid(WATCH_LOCK);
const alive = pid ? isAlive(pid) : false;

if (process.argv.includes("--stop")) {
  if (!alive) {
    console.log("[sync] 当前没有正在运行的守护进程。");
    try {
      fs.unlinkSync(WATCH_LOCK);
    } catch {
      /* ignore */
    }
    process.exit(0);
  }
  try {
    process.kill(pid);
    console.log(`[sync] 已停止守护进程（PID ${pid}）。`);
  } catch (error) {
    console.log(`[sync] 停止失败：${error.message}`);
    process.exitCode = 1;
  }
  process.exit();
}

console.log("== MxPage → GitHub 实时同步 状态 ==");
console.log(`项目目录      : ${ROOT}`);
console.log(`守护进程      : ${alive ? `运行中（PID ${pid}）` : "未运行"}`);

try {
  const state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  console.log(`远端仓库      : ${state.repo} (${state.branch})`);
  console.log(`已同步到提交  : ${String(state.localSha).slice(0, 7)}`);
  console.log(`远端提交      : ${String(state.remoteSha).slice(0, 7)}`);
  console.log(`上次同步时间  : ${state.syncedAt}`);
} catch {
  console.log("同步状态      : 尚未同步过（.github-sync.json 不存在）");
}

try {
  const stat = fs.statSync(LOG_FILE);
  console.log(`日志文件      : ${LOG_FILE}（${(stat.size / 1024).toFixed(1)} KB）`);
} catch {
  console.log("日志文件      : 暂无");
}
