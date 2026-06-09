import { NextRequest, NextResponse } from "next/server";
import { checkAuth, videoIsMock, VIDEO_API_KEY, VIDEO_BASE_URL } from "@/lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAMPLE_VIDEO =
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";

function isUrl(s: any): s is string {
  return typeof s === "string" && /^https?:\/\//i.test(s);
}

// 从返回里挖视频地址。
// 关键：零克云/new-api 这个渠道把「成片地址」塞在 fail_reason 字段里（命名误导，但确实是 mp4 地址）。
function pickVideoUrl(d: any): string | undefined {
  if (!d || typeof d !== "object") return undefined;
  const candidates = [
    d.url,
    d.video_url,
    d.videoUrl,
    d.content?.video_url,
    d.output?.video_url,
    d.output?.url,
    d.result?.video_url,
    d.video?.url,
    d.data?.url,
    d.data?.video_url,
    d.data?.content?.video_url,
    Array.isArray(d.data) ? d.data[0]?.url || d.data[0]?.video_url : undefined,
    d.fail_reason, // ← 成片地址藏在这
    d.data?.fail_reason,
  ];
  for (const c of candidates) {
    if (isUrl(c)) return c;
  }
  return undefined;
}

function pickStatus(d: any): string {
  const s = d?.status ?? d?.task_status ?? d?.state ?? d?.data?.status ?? "";
  return String(s).toLowerCase();
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "访问口令错误" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const taskId = searchParams.get("taskId") || "";
  if (!taskId) return NextResponse.json({ status: "error", error: "缺少 taskId" });

  // ---------- MOCK ----------
  if (videoIsMock) {
    const readyAt = Number(taskId.replace("mock_", "")) || 0;
    const remain = readyAt - Date.now();
    if (remain <= 0) return NextResponse.json({ status: "done", videoUrl: SAMPLE_VIDEO });
    const progress = Math.max(5, Math.min(95, Math.round((1 - remain / 8000) * 100)));
    return NextResponse.json({ status: "pending", progress });
  }

  // 查询任务：GET {BASE}/v1/video/generations/{task_id}
  try {
    const url = `${VIDEO_BASE_URL}/v1/video/generations/${encodeURIComponent(taskId)}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${VIDEO_API_KEY}` } });
    const text = await r.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {}

    if (!r.ok) {
      return NextResponse.json({
        status: "error",
        error: `平台返回错误(${r.status}): ${text.slice(0, 200)}`,
      });
    }

    // ① 拿到视频地址 → 完成（成片地址在 fail_reason / url）
    const videoUrl = pickVideoUrl(data);
    if (videoUrl) return NextResponse.json({ status: "done", videoUrl });

    // ② 明确失败 → 报错（此时 fail_reason 才是真正的错误信息）
    const s = pickStatus(data);
    const failStatuses = ["failed", "failure", "fail", "error", "cancelled", "canceled", "rejected"];
    if (failStatuses.includes(s)) {
      const fr = data?.fail_reason;
      const msg = isUrl(fr) ? "生成失败" : fr || data?.error?.message || data?.error || "生成失败";
      return NextResponse.json({ status: "error", error: msg });
    }

    // ③ 仍在进行（带 raw 兜底，万一格式还有出入能看清）
    const progress = data?.progress ?? data?.data?.progress ?? data?.percent;
    return NextResponse.json({ status: "pending", progress, raw: data ?? text.slice(0, 400) });
  } catch (e: any) {
    return NextResponse.json({ status: "error", error: e?.message || "请求平台失败" });
  }
}
