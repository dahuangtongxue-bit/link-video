import { NextRequest, NextResponse } from "next/server";
import { checkAuth, videoIsMock, VIDEO_API_KEY, VIDEO_BASE_URL } from "@/lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// mock 模式用的示例视频（公开样例）
const SAMPLE_VIDEO =
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";

// 从五花八门的返回结构里尽量挖出「视频地址」
function pickVideoUrl(d: any): string | undefined {
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

// 状态字段也兜底几种命名，统一转小写
function pickStatus(d: any): string {
  const s =
    d?.status ?? d?.task_status ?? d?.state ?? d?.data?.status ?? d?.data?.state ?? "";
  return String(s).toLowerCase();
}

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
  // 查询任务：GET {BASE}/v1/video/generations/{task_id}
  // 健壮解析：
  //   ① 只要挖到「视频地址」就判定完成（地址只有真渲染好才会出现，最可靠）
  //   ② 命中明确的失败状态 → 报错
  //   ③ 其余一律视为进行中，并把平台原始返回放进 raw，方便定位
  // ===================================================================
  try {
    const url = `${VIDEO_BASE_URL}/v1/video/generations/${encodeURIComponent(taskId)}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${VIDEO_API_KEY}` } });

    const text = await r.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {
      /* 平台返回了非 JSON，下面用 text 兜底 */
    }

    if (!r.ok) {
      return NextResponse.json({
        status: "error",
        error: `平台返回错误(${r.status}): ${text.slice(0, 200)}`,
      });
    }

    const videoUrl = pickVideoUrl(data);
    const s = pickStatus(data);
    const failStatuses = [
      "failed",
      "failure",
      "fail",
      "error",
      "cancelled",
      "canceled",
      "rejected",
    ];

    // ① 拿到视频地址 → 完成（不纠结状态字段拼写/大小写）
    if (videoUrl) return NextResponse.json({ status: "done", videoUrl });

    // ② 明确失败
    if (failStatuses.includes(s)) {
      return NextResponse.json({
        status: "error",
        error: data?.error?.message || data?.error || data?.fail_reason || "生成失败",
        raw: data ?? text.slice(0, 600),
      });
    }

    // ③ 仍在进行 —— 带上 raw，便于在 Network 里看清平台真实格式
    const progress = data?.progress ?? data?.data?.progress ?? data?.percent;
    return NextResponse.json({ status: "pending", progress, raw: data ?? text.slice(0, 600) });
  } catch (e: any) {
    return NextResponse.json({ status: "error", error: e?.message || "请求平台失败" });
  }
}
