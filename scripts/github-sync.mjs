#!/usr/bin/env node
/**
 * GitHub 同步器（GitHub Git Data API 实现，等价于 git push）
 *
 * 为什么不用 git push：
 *   本机到 github.com 的 HTTPS 链路（git push 使用的那条）TLS 握手会被中断，
 *   直连超时、走本地代理同样失败；而 api.github.com 可以正常访问。
 *   因此改用 GitHub 官方 REST Git Data API 上传对象并推进分支指针，效果等同 git push。
 *
 * 行为：
 *   - 逐提交（commit）回放本地尚未同步的历史，保留原始提交说明、作者与时间；
 *   - 构建目录树时过滤掉构建缓存 / 依赖 / 本地数据等不应入库的路径
 *     （例如历史中误提交的 .next-run1 构建产物），因此不会把垃圾推上云端；
 *   - 每个提交只上传相对父提交发生变化的 blob，增量同步非常轻量；
 *   - 状态记录在 .github-sync.json，重复执行是安全的（幂等，无变化时直接退出）。
 *
 * 用法：
 *   node scripts/github-sync.mjs                # 增量同步
 *   node scripts/github-sync.mjs --dry-run      # 只打印计划，不产生任何写入
 *   node scripts/github-sync.mjs --force        # 忽略状态文件，从头回放全部历史
 *   node scripts/github-sync.mjs --repo a/b --branch main
 *
 * 退出码：0 成功（含"无需同步"）；1 失败。
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const STATE_PATH = path.join(ROOT, ".github-sync.json");
const LOCK_PATH = path.join(ROOT, ".github-sync.lock");
const API = "https://api.github.com";
const CONCURRENCY = 10;

/** 永不入库的路径（构建缓存 / 依赖 / 本地数据 / 本工具自身状态） */
const EXCLUDE = [
  /^\.next[^/]*\//, // .next/  .next-run1/  .next-desktop/ ...
  /^node_modules\//,
  /^storage\//,
  /^(?:dist|dist-desktop|build|release|out)\//,
  /^logs\//,
  /^\.git\//,
  /^\.github-sync\.(?:json|lock)$/,
  /^\.sync-watch\.lock$/,
  /\.tmp-dev\.log$/,
  /^runtime-start\.log$/,
];
const isExcluded = (p) => EXCLUDE.some((re) => re.test(p));

// ---------------------------------------------------------------- 参数解析

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const DRY_RUN = flag("dry-run");
const FORCE = flag("force");

// ---------------------------------------------------------------- 基础工具

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, maxBuffer: 1024 * 1024 * 512 });
}
function gitText(args) {
  return git(args).toString("utf8");
}
function gitLines(args) {
  return gitText(args).split("\n").map((s) => s.trim()).filter(Boolean);
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function log(...args) {
  console.log(...args);
}

/** 读取某个提交经过过滤后的树：path -> { mode, type, sha } */
function treeMapOfCommit(commit) {
  const raw = git(["ls-tree", "-r", "-z", commit]).toString("utf8");
  const map = new Map();
  for (const record of raw.split("\0")) {
    if (!record) continue;
    const tab = record.indexOf("\t");
    if (tab < 0) continue;
    const [mode, type, sha] = record.slice(0, tab).split(" ");
    const p = record.slice(tab + 1);
    if (isExcluded(p)) continue;
    map.set(p, { mode, type, sha });
  }
  return map;
}

function readCommitMeta(commit) {
  const out = gitText([
    "log", "-1", "--format=%an%x1f%ae%x1f%aI%x1f%cn%x1f%ce%x1f%cI%x1f%B", commit,
  ]).split("\x1f");
  return {
    authorName: out[0],
    authorEmail: out[1],
    authorDate: out[2],
    committerName: out[3],
    committerEmail: out[4],
    committerDate: out[5],
    message: out.slice(6).join("\x1f").replace(/\s+$/, "") || "(no message)",
  };
}

// ---------------------------------------------------------------- 令牌与仓库

function resolveToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error("无法获取 GitHub 令牌：请先执行 gh auth login");
  }
}

function detectRepo() {
  let url = "";
  try {
    url = gitText(["remote", "get-url", "origin"]).trim();
  } catch {
    /* ignore */
  }
  const m = url.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/i);
  if (!m) throw new Error(`无法从 origin 解析 GitHub 仓库地址（当前为 "${url}"）`);
  return `${m[1]}/${m[2]}`;
}

const TOKEN = resolveToken();
let REPO = "";
let BRANCH = "";

async function api(method, endpoint, body) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(`${API}${endpoint}`, {
        method,
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
          "User-Agent": "mxpage-github-sync",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      if (attempt < 3) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      throw new Error(`${method} ${endpoint} 网络失败：${error.message}`);
    }
    const text = await res.text();
    if (res.ok) return text ? JSON.parse(text) : null;

    const rateLimited = res.status === 403 && /rate limit|secondary rate/i.test(text);
    const retryable = rateLimited || res.status >= 500;
    if (retryable && attempt < 4) {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    throw new Error(`${method} ${endpoint} -> HTTP ${res.status}：${text.slice(0, 500)}`);
  }
}

// ---------------------------------------------------------------- 运行锁

function acquireLock() {
  for (let i = 0; i < 150; i++) {
    try {
      fs.writeFileSync(LOCK_PATH, String(process.pid), { flag: "wx" });
      return true;
    } catch {
      let stale = true;
      try {
        const pid = Number(fs.readFileSync(LOCK_PATH, "utf8").trim());
        const age = Date.now() - fs.statSync(LOCK_PATH).mtimeMs;
        stale = !pid || age > 15 * 60_000 || !isAlive(pid);
      } catch {
        stale = true;
      }
      if (stale) {
        try {
          fs.unlinkSync(LOCK_PATH);
        } catch {
          /* ignore */
        }
        continue;
      }
      sleepSync(1000);
    }
  }
  return false;
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function releaseLock() {
  try {
    if (Number(fs.readFileSync(LOCK_PATH, "utf8").trim()) === process.pid) fs.unlinkSync(LOCK_PATH);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------- 状态文件

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return {};
  }
}
function saveState(state) {
  fs.writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
}

// ---------------------------------------------------------------- 上传

async function uploadBlob(localSha) {
  const content = git(["cat-file", "blob", localSha]);
  const created = await api("POST", `/repos/${REPO}/git/blobs`, {
    content: content.toString("base64"),
    encoding: "base64",
  });
  return created.sha;
}

/** 并发执行，保持顺序返回结果 */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function remoteTreeMap(treeSha) {
  if (!treeSha) return new Map();
  const out = await api("GET", `/repos/${REPO}/git/trees/${treeSha}?recursive=1`);
  const map = new Map();
  for (const entry of out.tree ?? []) {
    if (entry.type !== "blob" && entry.type !== "commit") continue;
    if (isExcluded(entry.path)) continue;
    map.set(entry.path, {
      mode: entry.mode,
      type: entry.type === "commit" ? "commit" : "blob",
      sha: entry.sha,
    });
  }
  return map;
}

// ---------------------------------------------------------------- 主流程

async function main() {
  const state = loadState();
  REPO = opt("repo", state.repo || detectRepo());
  BRANCH = opt("branch", state.branch || "main");

  const head = gitText(["rev-parse", "HEAD"]).trim();

  // 决定需要回放的提交范围
  let from = FORCE ? null : state.localSha;
  if (from) {
    try {
      gitText(["cat-file", "-t", from]);
    } catch {
      from = null;
    }
  }

  let commits;
  if (from && from === head) commits = [];
  else if (from) commits = gitLines(["rev-list", "--reverse", `${from}..HEAD`]);
  else commits = gitLines(["rev-list", "--reverse", "HEAD"]);

  log(`[sync] 仓库 ${REPO}  分支 ${BRANCH}`);
  log(`[sync] 本地 HEAD ${head.slice(0, 7)}  已同步 ${from ? from.slice(0, 7) : "（无，将回放全部历史）"}`);

  if (commits.length === 0) {
    log("[sync] 已是最新，无需同步。");
    return { synced: 0, upToDate: true };
  }
  log(`[sync] 待同步提交 ${commits.length} 个`);

  if (DRY_RUN) {
    let prev = from ? treeMapOfCommit(from) : new Map();
    let totalUploads = 0;
    let totalBytes = 0;
    for (const sha of commits) {
      const entries = treeMapOfCommit(sha);
      const uploads = [];
      let deletions = 0;
      for (const [p, e] of entries) {
        const before = prev.get(p);
        if (!before || before.sha !== e.sha || before.mode !== e.mode) uploads.push(e.sha);
      }
      for (const p of prev.keys()) if (!entries.has(p)) deletions++;
      const bytes = uploads.reduce(
        (sum, s) => sum + Number(gitText(["cat-file", "-s", s]).trim()),
        0,
      );
      totalUploads += uploads.length;
      totalBytes += bytes;
      log(
        `  ${sha.slice(0, 7)}  上传 ${String(uploads.length).padStart(3)} 个 (${(bytes / 1048576).toFixed(2)} MB)  删除 ${String(deletions).padStart(3)} 个  ${readCommitMeta(sha).message.split("\n")[0].slice(0, 46)}`,
      );
      prev = entries;
    }
    log(`[dry-run] 合计上传 ${totalUploads} 个对象，${(totalBytes / 1048576).toFixed(2)} MB。未做任何写入。`);
    return { synced: 0, dryRun: true, totalUploads, totalBytes };
  }

  if (!acquireLock()) throw new Error("另一个同步进程正在运行，稍后再试");
  try {
    // 远端当前指针
    let remoteCommit = null;
    let remoteTree = null;
    let hadRef = false;
    try {
      const ref = await api("GET", `/repos/${REPO}/git/ref/heads/${BRANCH}`);
      remoteCommit = ref.object.sha;
      hadRef = true;
      const remote = await api("GET", `/repos/${REPO}/git/commits/${remoteCommit}`);
      remoteTree = remote.tree.sha;
    } catch (error) {
      if (!/HTTP 404/.test(error.message)) throw error;
      log("[sync] 远端分支尚不存在，将创建。");
    }
    log(`[sync] 远端当前 ${remoteCommit ? remoteCommit.slice(0, 7) : "（空）"}`);

    // 增量基线：有 from 用本地树（等价于远端树），否则取远端真实树
    let prevEntries = from ? treeMapOfCommit(from) : await remoteTreeMap(remoteTree);

    let uploadedTotal = 0;
    let uploadedBytes = 0;

    for (const sha of commits) {
      const meta = readCommitMeta(sha);
      const entries = treeMapOfCommit(sha);
      const treeEntries = [];
      const pending = [];

      for (const [p, e] of entries) {
        const before = prevEntries.get(p);
        if (before && before.sha === e.sha && before.mode === e.mode) continue;
        treeEntries.push({ path: p, mode: e.mode, type: e.type, sha: e.sha, __sha: e.sha });
        if (e.type === "blob") pending.push({ path: p, localSha: e.sha });
      }
      for (const [p, e] of prevEntries) {
        if (!entries.has(p)) {
          treeEntries.push({ path: p, mode: e.mode ?? "100644", type: e.type ?? "blob", sha: null });
        }
      }

      if (pending.length) {
        const sizes = pending.map((x) => Number(gitText(["cat-file", "-s", x.localSha]).trim()));
        await mapLimit(pending, CONCURRENCY, async (item, index) => {
          const remoteSha = await uploadBlob(item.localSha);
          const entry = treeEntries.find((t) => t.path === item.path);
          if (entry) entry.sha = remoteSha;
          uploadedTotal++;
          uploadedBytes += sizes[index] ?? 0;
        });
        for (const t of treeEntries) delete t.__sha;
      }

      const tree = await api("POST", `/repos/${REPO}/git/trees`, {
        ...(remoteTree ? { base_tree: remoteTree } : {}),
        tree: treeEntries.map(({ path: p, mode, type, sha: s }) => ({ path: p, mode, type, sha: s })),
      });

      const commit = await api("POST", `/repos/${REPO}/git/commits`, {
        message: meta.message,
        tree: tree.sha,
        parents: remoteCommit ? [remoteCommit] : [],
        author: { name: meta.authorName, email: meta.authorEmail, date: meta.authorDate },
        committer: { name: meta.committerName, email: meta.committerEmail, date: meta.committerDate },
      });

      log(
        `  ${sha.slice(0, 7)} -> ${commit.sha.slice(0, 7)}  变更 ${String(treeEntries.length).padStart(3)} 项  上传 ${String(pending.length).padStart(3)} 个  ${meta.message.split("\n")[0].slice(0, 40)}`,
      );

      remoteCommit = commit.sha;
      remoteTree = tree.sha;
      prevEntries = entries;
    }

    if (hadRef) {
      await api("PATCH", `/repos/${REPO}/git/refs/heads/${BRANCH}`, {
        sha: remoteCommit,
        force: false,
      });
    } else {
      await api("POST", `/repos/${REPO}/git/refs`, {
        ref: `refs/heads/${BRANCH}`,
        sha: remoteCommit,
      });
    }

    // 一致性校验：远端最终树应与本地 HEAD 的过滤后树完全一致
    const finalRemote = await remoteTreeMap(remoteTree);
    const finalLocal = treeMapOfCommit(head);
    const diffs = [];
    for (const [p, e] of finalLocal) {
      const r = finalRemote.get(p);
      if (!r || r.sha !== e.sha || r.mode !== e.mode) diffs.push(`缺失/不符 ${p}`);
    }
    for (const p of finalRemote.keys()) if (!finalLocal.has(p)) diffs.push(`多余 ${p}`);

    if (diffs.length) {
      log(`[sync] ⚠ 校验发现 ${diffs.length} 处差异（前 5 条）：`);
      for (const d of diffs.slice(0, 5)) log(`        ${d}`);
      log("[sync] 提示：可执行 node scripts/github-sync.mjs --force 重新回放一次。");
    } else {
      log(`[sync] ✔ 校验通过：远端 ${finalLocal.size} 个文件与本地完全一致`);
    }

    saveState({ repo: REPO, branch: BRANCH, localSha: head, remoteSha: remoteCommit, syncedAt: new Date().toISOString() });
    log(
      `[sync] 完成：${commits.length} 个提交，上传 ${uploadedTotal} 个对象（${(uploadedBytes / 1048576).toFixed(2)} MB）`,
    );
    return { synced: commits.length, remoteCommit, uploadedTotal, uploadedBytes, verified: diffs.length === 0 };
  } finally {
    releaseLock();
  }
}

main().catch((error) => {
  console.error(`[sync] 失败：${error?.message ?? error}`);
  process.exitCode = 1;
});
