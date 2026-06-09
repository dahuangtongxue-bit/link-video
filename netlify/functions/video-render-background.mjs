import { getStore } from "@netlify/blobs";

const STORE = "video-jobs";

function cleanBase(b) {
  let s = (b || "").trim().replace(/\/+$/, "");
  s = s.replace(/\/v1$/, "");
  return s;
}

// 从五花八门的返回结构里尽量挖出「视频地址」
function pickVideoUrl(d) {
  if (!d || typeof d !== "object") return undefined;
  return (
    d.content?.video_url ||
    d.video_url ||
    d.videoUrl ||
    d.url ||
    d.output?.video_url ||
    d.output?.url ||
    d.result?.video_url ||
    d.video?.url ||
    d.data?.video_url ||
    d.data?.url ||
    d.data?.content?.video_url ||
    d.data?.video?.url ||
    (Array.isArray(d.data) ? d.data[0]?.url || d.data[0]?.video_url : undefined) ||
    (Array.isArray(d.videos) ? d.videos[0]?.url || d.videos[0]?.video_url : undefined)
  );
}

function pickStatus(d) {
  const s = d?.status ?? d?.task_status ?? d?.state ?? d?.data?.status ?? d?.data?.state ?? "";
  return String(s).toLowerCase();
}

const json = (obj) =>
  new Response(JSON.stringify(obj), { headers: { "content-type": "application/json" } });

// 文件名以 -background 结尾 → Netlify 后台函数：被调用后立刻回 202，函数体在后台最多跑 15 分钟。
export default async (req) => {
  let payload = {};
  try {
    payload = await req.json();
  } catch {}
  const { jobId, accessKey, imageUrl, prompt, model, resolution, duration } = payload;

  if (!jobId) return json({ error: "缺少 jobId" });

  const store = getStore(STORE);

  // 访问口令校验（与主站一致；未设置则跳过）
  const required = process.env.ACCESS_PASSWORD || "";
  if (required && accessKey !== required) {
    await store.setJSON(jobId, { status: "error", error: "访问口令错误" });
    return json({ ok: false });
  }
  if (!imageUrl) {
    await store.setJSON(jobId, { status: "error", error: "缺少 imageUrl" });
    return json({ ok: false });
  }

  const base = cleanBase(process.env.MAAS_VIDEO_BASE_URL || process.env.MAAS_BASE_URL || "");
  const key = process.env.MAAS_VIDEO_API_KEY || process.env.MAAS_API_KEY || "";
  if (!base || !key) {
    await store.setJSON(jobId, {
      status: "error",
      error: "服务端未配置 MAAS_BASE_URL / MAAS_API_KEY",
    });
    return json({ ok: false });
  }

  // 先标记进行中
  await store.setJSON(jobId, { status: "pending" });

  const body = {
    model,
    prompt:
      prompt && String(prompt).trim()
        ? String(prompt).trim()
        : "让画面自然地动起来，保持主体稳定、镜头平滑",
    image: imageUrl,
    duration: Number(duration) || 5,
    metadata: { resolution: String(resolution || "720p").toLowerCase() },
  };

  // 给阻塞请求一个足够长的超时（后台函数最多 15 分钟，这里设 13 分钟留余量）
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 13 * 60 * 1000);

  try {
    // 创建任务：Seedance 是「同步」的——这个 fetch 会一直挂到视频渲染完才返回
    const r = await fetch(`${base}/v1/video/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await r.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {}

    if (!r.ok) {
      await store.setJSON(jobId, {
        status: "error",
        error: `平台返回错误(${r.status}): ${text.slice(0, 300)}`,
      });
      return json({ ok: false });
    }

    // 情况一：同步——直接返回了视频地址
    let videoUrl = pickVideoUrl(data);
    if (videoUrl) {
      await store.setJSON(jobId, { status: "done", videoUrl });
      return json({ ok: true });
    }

    // 情况二：异步——返回 task_id，则在后台轮询直到出片（后台函数额度足够）
    const taskId = data?.task_id || data?.data?.task_id || data?.id || data?.data?.id;
    if (!taskId) {
      await store.setJSON(jobId, {
        status: "error",
        error: `未拿到视频或 task_id: ${text.slice(0, 200)}`,
      });
      return json({ ok: false });
    }

    const queryUrl = `${base}/v1/video/generations/${encodeURIComponent(taskId)}`;
    const start = Date.now();
    const maxMs = 13 * 60 * 1000;
    while (Date.now() - start < maxMs) {
      await new Promise((s) => setTimeout(s, 5000));
      const rr = await fetch(queryUrl, { headers: { Authorization: `Bearer ${key}` } });
      const tt = await rr.text();
      let dd = null;
      try {
        dd = JSON.parse(tt);
      } catch {}
      videoUrl = pickVideoUrl(dd);
      if (videoUrl) {
        await store.setJSON(jobId, { status: "done", videoUrl });
        return json({ ok: true });
      }
      const st = pickStatus(dd);
      if (["failed", "failure", "fail", "error", "cancelled", "canceled", "rejected"].includes(st)) {
        await store.setJSON(jobId, {
          status: "error",
          error: dd?.error?.message || dd?.error || dd?.fail_reason || "生成失败",
        });
        return json({ ok: false });
      }
    }
    await store.setJSON(jobId, { status: "error", error: "渲染超时（13 分钟）" });
  } catch (e) {
    const msg = e?.name === "AbortError" ? "渲染超时" : e?.message || "渲染失败";
    await store.setJSON(jobId, { status: "error", error: msg });
  } finally {
    clearTimeout(timer);
  }
  return json({ ok: true });
};
