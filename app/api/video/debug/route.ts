import { NextRequest, NextResponse } from "next/server";
import { VIDEO_API_KEY, VIDEO_BASE_URL } from "@/lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isHttp(s: any): s is string {
  return typeof s === "string" && /^https?:\/\//i.test(s);
}
function looksLikeVideo(s: any): boolean {
  return isHttp(s) && /\.(mp4|mov|webm|m4v)(\?|$)/i.test(s);
}
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
    if (isHttp(obj.video_url)) return obj.video_url;
    if (isHttp(obj.videoUrl)) return obj.videoUrl;
    if (obj.content && isHttp(obj.content.video_url)) return obj.content.video_url;
    if (looksLikeVideo(obj.fail_reason)) return obj.fail_reason;
    if (looksLikeVideo(obj.url)) return obj.url;
    for (const k of Object.keys(obj)) {
      const u = findVideoUrl(obj[k], depth + 1);
      if (u) return u;
    }
  }
  return undefined;
}

// 调试用：浏览器打开 /api/video/debug?taskId=cgt-xxxx
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const taskId = searchParams.get("taskId") || "";
  if (!taskId) {
    return NextResponse.json({ hint: "网址后面加 ?taskId=xxx（从零克云任务日志复制成功任务的 任务ID）" });
  }

  const queriedUrl = `${VIDEO_BASE_URL}/v1/video/generations/${encodeURIComponent(taskId)}`;
  try {
    const r = await fetch(queriedUrl, { headers: { Authorization: `Bearer ${VIDEO_API_KEY}` } });
    const text = await r.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {}
    return NextResponse.json({
      queriedUrl,
      httpStatus: r.status,
      extractedVideoUrl: findVideoUrl(parsed ?? {}) ?? null, // ← 重点看这个
      parsed,
      rawText: parsed ? undefined : text.slice(0, 3000),
    });
  } catch (e: any) {
    return NextResponse.json({ queriedUrl, error: e?.message || "请求失败" });
  }
}
