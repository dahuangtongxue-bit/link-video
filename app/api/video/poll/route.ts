import { NextRequest, NextResponse } from "next/server";
import { checkAuth, videoIsMock, VIDEO_API_KEY, VIDEO_BASE_URL } from "@/lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAMPLE_VIDEO =
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";

function isHttp(s: any): s is string {
  return typeof s === "string" && /^https?:\/\//i.test(s);
}
function looksLikeVideo(s: any): boolean {
  return isHttp(s) && /\.(mp4|mov|webm|m4v)(\?|$)/i.test(s);
}

// 递归把成片地址挖出来。零克云返回层层嵌套，地址同时出现在
// data.fail_reason 和 data.data.content.video_url，这里无脑深挖，谁先命中用谁。
function findVideoUrl(obj: any, depth = 0): string | undefined {
  if (obj == null || depth > 8) return undefined;
  if (typeof obj === "string") return looksLikeVideo(obj) ? obj : undefined;
  if (Array.isArray(obj)) {
    for (const x of obj) {
      const u = findVideoUrl(x, depth + 1);
      if (u) return u;
    }
    return undefined;
  }
  if (typeof obj === "object") {
    // 明确的视频字段优先（即便没扩展名也认）
    if (isHttp(obj.video_url)) return obj.video_url;
    if (isHttp(obj.videoUrl)) return obj.videoUrl;
    if (obj.content && isHttp(obj.content.video_url)) return obj.content.video_url;
    // fail_reason / url 里若像视频地址也认
    if (looksLikeVideo(obj.fail_reason)) return obj.fail_reason;
    if (looksLikeVideo(obj.url)) return obj.url;
    // 兜底：继续往里挖
    for (const k of Object.keys(obj)) {
      const u = findVideoUrl(obj[k], depth + 1);
      if (u) return u;
    }
  }
  return undefined;
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

    // ① 挖到视频地址 → 完成
    const videoUrl = findVideoUrl(data);
    if (videoUrl) return NextResponse.json({ status: "done", videoUrl });

    // ② 明确失败 → 报错（此时 fail_reason 才是真正的错误文字）
    const s = String(
      data?.data?.data?.status ?? data?.data?.status ?? data?.status ?? ""
    ).toLowerCase();
    const failStatuses = ["failed", "failure", "fail", "error", "cancelled", "canceled", "rejected"];
    if (failStatuses.includes(s)) {
      const fr = data?.data?.fail_reason ?? data?.fail_reason;
      const msg = typeof fr === "string" && !isHttp(fr) ? fr : "生成失败";
      return NextResponse.json({ status: "error", error: msg });
    }

    // ③ 仍在进行（进度可能是 "60%" 字符串，转成数字）
    let progress: number | undefined;
    const rawProg = data?.data?.progress ?? data?.progress ?? data?.data?.data?.progress;
    if (typeof rawProg === "string") {
      const n = parseInt(rawProg, 10);
      if (!isNaN(n)) progress = n;
    } else if (typeof rawProg === "number") progress = rawProg;

    return NextResponse.json({ status: "pending", progress });
  } catch (e: any) {
    return NextResponse.json({ status: "error", error: e?.message || "请求平台失败" });
  }
}
