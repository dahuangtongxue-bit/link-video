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

// 「任务本身失败」（要立即报错），与「网络抖动」（要容忍重试）区分开
class TaskFailedError extends Error {}

// 文生图：一次返回图片地址
export async function generateImage(prompt: string, model: string): Promise<string> {
  const res = await fetchWithTimeout(
    "/api/image",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ prompt, model }),
    },
    120000
  );
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  if (!data.imageUrl) throw new Error("未拿到图片地址");
  return data.imageUrl as string;
}

// 图生视频：提交任务，拿 taskId（提交是秒回的异步任务）
export async function submitVideo(input: {
  imageUrl: string;
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

// 查询一次任务状态（单次 20 秒超时）
export async function pollVideoOnce(taskId: string, model: string): Promise<PollResult> {
  const res = await fetchWithTimeout(
    `/api/video/poll?taskId=${encodeURIComponent(taskId)}&model=${encodeURIComponent(model)}`,
    { headers: authHeaders() },
    20000
  );
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

// 轮询直到完成 / 失败 / 超时。
// 关键设计：
//  - 每次查询自带超时，卡住会被斩断并自动重试，循环不会被冻死；
//  - 偶发网络错误容忍（连续 8 次才报错）；
//  - 时间到了先补查最后一次再判超时（防电脑睡眠把时间“睡”过去造成误判）。
export async function pollVideoUntilDone(
  taskId: string,
  model: string,
  onProgress: (p?: number) => void,
  isCancelled: () => boolean,
  opts: { intervalMs?: number; maxMs?: number } = {}
): Promise<string> {
  const intervalMs = opts.intervalMs ?? 4000;
  const maxMs = opts.maxMs ?? 10 * 60 * 1000;
  const start = Date.now();
  let consecutiveErrors = 0;

  while (Date.now() - start < maxMs) {
    if (isCancelled()) throw new Error("已取消");

    try {
      const r = await pollVideoOnce(taskId, model);
      consecutiveErrors = 0;
      if (r.status === "done" && r.videoUrl) return r.videoUrl;
      if (r.status === "error") throw new TaskFailedError(r.error || "视频生成失败");
      if (typeof r.progress === "number") onProgress(r.progress);
    } catch (e: any) {
      if (e instanceof TaskFailedError) throw e;
      if (isCancelled()) throw new Error("已取消");
      consecutiveErrors++;
      if (consecutiveErrors >= 8) {
        throw new Error(`查询连续出错：${e?.message || e}`);
      }
    }

    if (isCancelled()) throw new Error("已取消");
    await sleep(intervalMs);
  }

  // 最后的机会：再查一次，真没有才判超时
  try {
    const r = await pollVideoOnce(taskId, model);
    if (r.status === "done" && r.videoUrl) return r.videoUrl;
  } catch {}
  throw new Error("生成超时，请删除卡片后重新生成");
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
