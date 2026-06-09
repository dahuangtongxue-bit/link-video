import { NextRequest, NextResponse } from "next/server";
import { checkAuth, videoIsMock, VIDEO_API_KEY, VIDEO_BASE_URL } from "@/lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// mock 模式用的示例视频（公开样例）
const SAMPLE_VIDEO =
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "访问口令错误" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const taskId = searchParams.get("taskId") || "";
  if (!taskId) return NextResponse.json({ status: "error", error: "缺少 taskId" });

  // ---------- MOCK：按编进 taskId 的时间判断是否完成 ----------
  if (videoIsMock) {
    const readyAt = Number(taskId.replace("mock_", "")) || 0;
    const remain = readyAt - Date.now();
    if (remain <= 0) return NextResponse.json({ status: "done", videoUrl: SAMPLE_VIDEO });
    const progress = Math.max(5, Math.min(95, Math.round((1 - remain / 8000) * 100)));
    return NextResponse.json({ status: "pending", progress });
  }

  // ===================================================================
  // Seedance「查询任务」：new-api 网关路径 = GET {BASE}/v1/video/generations/{task_id}。
  // 核对带 ← 的：① 状态字段/取值 ② 出片 url 的字段。
  // 状态约定：queued/running/processing = 还在跑；succeeded = 完成；failed/cancelled = 失败。
  // ===================================================================
  try {
    const url = `${VIDEO_BASE_URL}/v1/video/generations/${encodeURIComponent(taskId)}`; // ← 接口路径
    const r = await fetch(url, { headers: { Authorization: `Bearer ${VIDEO_API_KEY}` } });

    if (!r.ok) {
      const t = await r.text();
      return NextResponse.json({ status: "error", error: `平台返回错误: ${t.slice(0, 200)}` });
    }

    const data = await r.json();
    const s: string = data?.status || ""; // ← 状态字段
    if (["succeeded", "success", "completed", "done"].includes(s)) {
      const videoUrl =
        data?.content?.video_url || data?.video_url || data?.data?.video_url; // ← 出片地址
      return NextResponse.json({ status: "done", videoUrl });
    }
    if (["failed", "error", "cancelled", "canceled"].includes(s)) {
      return NextResponse.json({ status: "error", error: data?.error?.message || data?.error || "生成失败" });
    }
    // queued / running / processing → 还在跑
    return NextResponse.json({ status: "pending", progress: data?.progress });
  } catch (e: any) {
    return NextResponse.json({ status: "error", error: e?.message || "请求平台失败" });
  }
}
