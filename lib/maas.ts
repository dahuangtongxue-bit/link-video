// 前端调用封装。注意：这里只调自己的 /api 路由 / Netlify 函数，绝不直接碰平台 key。
// 访问口令存在 localStorage，作为请求头/请求体带上。

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

// 文生图：一次返回图片地址（不变）
export async function generateImage(prompt: string, model: string): Promise<string> {
  const res = await fetch("/api/image", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ prompt, model }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  if (!data.imageUrl) throw new Error("未拿到图片地址");
  return data.imageUrl as string;
}

// 图生视频：提交到「后台函数」，立刻拿到 jobId。
// 后台函数最多跑 15 分钟，负责扛那个会阻塞几十秒的同步渲染请求，绕开 10 秒限制。
export async function submitVideo(input: {
  imageUrl: string;
  prompt: string;
  model: string;
  resolution?: string;
  duration?: string;
}): Promise<string> {
  const jobId = `vid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const res = await fetch("/.netlify/functions/video-render-background", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, accessKey: getAccessKey(), ...input }),
  });
  // 后台函数受理后会立刻返回 202；只要不是明确错误码就算提交成功
  if (res.status >= 400) throw new Error(await readError(res));
  return jobId;
}

export interface PollResult {
  status: "pending" | "done" | "error";
  videoUrl?: string;
  progress?: number;
  error?: string;
}

// 查询一次任务状态：读后台函数写入 Blobs 的结果
export async function pollVideoOnce(taskId: string, _model: string): Promise<PollResult> {
  const res = await fetch(
    `/.netlify/functions/video-result?jobId=${encodeURIComponent(taskId)}`
  );
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

// 轮询直到完成 / 失败 / 超时
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

  while (Date.now() - start < maxMs) {
    if (isCancelled()) throw new Error("已取消");
    const r = await pollVideoOnce(taskId, model);
    if (r.status === "done" && r.videoUrl) return r.videoUrl;
    if (r.status === "error") throw new Error(r.error || "视频生成失败");
    onProgress(r.progress);
    await new Promise((res) => setTimeout(res, intervalMs));
  }
  throw new Error("生成超时");
}

// 访问口令相关（不变）
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
