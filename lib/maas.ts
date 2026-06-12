// 前端调用封装。注意：这里只调自己的 /api 路由，绝不直接碰平台 key。
// 访问口令存在 localStorage，作为请求头带上。

const KEY_STORE = "ai-canvas-access-key";

export function getAccessKey(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(KEY_STORE) || "";
}

export function setAccessKey(v: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY_STORE, v);
}

function authHeaders(): Record<string, string> {
  return { "x-access-key": getAccessKey() };
}

async function readError(res: Response): Promise<string> {
  try {
    const data = await res.json();
    return data?.error || `请求失败 (${res.status})`;
  } catch {
    return `请求失败 (${res.status})`;
  }
}

// 带超时的 fetch：防止某一次请求卡死，把整个轮询循环冻住
async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 20000
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

// 两类要「立即报错」的异常，与可重试的网络波动区分开：
class TaskFailedError extends Error {} // 云端明确说任务失败
class FatalPollError extends Error {} // 口令错误等，重试也没用

// 文生图：一次返回图片地址
// 文生图：走 Netlify 后台函数（15 分钟额度）+ 轮询取结果。
// 原因：Seedream 5.0 在 2K/4K 档的生成时长远超普通函数 10~26 秒上限，同步等待必 504。
export async function generateImage(prompt: string, model: string, size?: string): Promise<string> {
  const jobId =
    (globalThis.crypto?.randomUUID && globalThis.crypto.randomUUID()) ||
    `job_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  // 1) 触发后台任务（-background 函数立即回 202，函数体继续在后台跑）
  const kick = await fetchWithTimeout(
    "/.netlify/functions/image-gen-background",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ jobId, prompt, model, size }),
    },
    20000
  );
  if (!(kick.ok || kick.status === 202)) throw new Error(await readError(kick));

  // 2) 轮询结果：每 3 秒一次，最多约 6 分钟；单次网络失败不致命，口令错快速失败
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 120; i++) {
    await wait(3000);
    let res: Response;
    try {
      res = await fetchWithTimeout(
        `/.netlify/functions/image-result?jobId=${encodeURIComponent(jobId)}`,
        { headers: { ...authHeaders() } },
        15000
      );
    } catch {
      continue; // 单次查询超时/断网：下一轮再试
    }
    if (res.status === 401) throw new FatalPollError("访问口令错误");
    if (!res.ok) continue;
    const d: any = await res.json().catch(() => null);
    if (!d) continue;
    if (d.status === "done" && d.imageUrl) return d.imageUrl as string;
    if (d.status === "error") throw new Error(d.error || "生成失败");
    // running / pending → 继续等
  }
  throw new Error("生成超时（约 6 分钟）：5.0 大图偏慢，可稍后重试或换 2K");
}

// 图生视频：提交任务，拿 taskId（提交是秒回的异步任务）
export async function submitVideo(input: {
  imageUrl: string;
  lastImageUrl?: string; // 尾帧（可选，首尾帧模式）
  prompt: string;
  model: string;
  resolution?: string;
  duration?: string;
}): Promise<string> {
  const res = await fetchWithTimeout(
    "/api/video/submit",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(input),
    },
    30000
  );
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  if (!data.taskId) throw new Error("未拿到任务 ID");
  return data.taskId as string;
}

export interface PollResult {
  status: "pending" | "done" | "error";
  videoUrl?: string;
  progress?: number;
  error?: string;
}

// 查询一次任务状态（单次 20 秒超时；口令错直接致命）
export async function pollVideoOnce(taskId: string, model: string): Promise<PollResult> {
  const res = await fetchWithTimeout(
    `/api/video/poll?taskId=${encodeURIComponent(taskId)}&model=${encodeURIComponent(model)}`,
    { headers: authHeaders() },
    20000
  );
  if (res.status === 401 || res.status === 403) {
    throw new FatalPollError(await readError(res));
  }
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

// 轮询直到完成 / 任务失败 / 预算用尽。
// 韧性设计：
//  - 预算按「实际查询次数」计，不按墙上时钟 —— 睡眠/切页/冻结不消耗预算，
//    醒来自动接着查；
//  - 每次查询自带 20s 超时，单次卡死会被斩断，循环不会被冻住；
//  - 网络层失败（断网、代理重连、Failed to fetch、5xx）永不判死：
//    指数退避放缓（4s→8s→16s→30s 封顶），网络一恢复自动回到正常节奏。
//    任务在云端独立进行，断网多久都不影响它；
//  - 口令错误立即报错；云端明确说任务失败也立即报错并显示原因。
export async function pollVideoUntilDone(
  taskId: string,
  model: string,
  onProgress: (p?: number) => void,
  isCancelled: () => boolean,
  opts: { intervalMs?: number; maxAttempts?: number } = {}
): Promise<string> {
  const intervalMs = opts.intervalMs ?? 4000;
  const maxAttempts = opts.maxAttempts ?? 200; // ≈ 前台连续查 13 分钟的量
  let netFails = 0; // 连续网络失败次数：只用于退避节奏，绝不判死

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (isCancelled()) throw new Error("已取消");

    try {
      const r = await pollVideoOnce(taskId, model);
      netFails = 0;
      if (r.status === "done" && r.videoUrl) return r.videoUrl;
      if (r.status === "error") throw new TaskFailedError(r.error || "视频生成失败");
      if (typeof r.progress === "number") onProgress(r.progress);
    } catch (e: any) {
      if (e instanceof TaskFailedError || e instanceof FatalPollError) throw e;
      if (isCancelled()) throw new Error("已取消");
      // 网络波动 / 单次超时 / 函数偶发错误：一律不判死，退避后继续
      netFails++;
    }

    if (isCancelled()) throw new Error("已取消");
    const wait =
      netFails === 0 ? intervalMs : Math.min(intervalMs * 2 ** Math.min(netFails, 3), 30000);
    await sleep(wait);
  }

  throw new Error("查询次数用尽（任务可能仍在后台进行），可点「重试查询」继续");
}

// 访问口令相关
export async function isAccessRequired(): Promise<boolean> {
  try {
    const res = await fetch("/api/auth");
    const data = await res.json();
    return !!data.required;
  } catch {
    return false;
  }
}

export async function verifyAccess(password: string): Promise<boolean> {
  try {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    return !!data.ok;
  } catch {
    return false;
  }
}
