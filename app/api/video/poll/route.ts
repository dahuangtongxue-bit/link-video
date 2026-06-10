import { NextRequest, NextResponse } from "next/server";
import { checkAuth, videoIsMock, VIDEO_API_KEY, VIDEO_BASE_URL } from "@/lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAMPLE_VIDEO =
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";

// ===== 备用真相通道：零克云控制台 API（new-api /api/task/self）=====
// 主查询接口（/v1/video/generations/{id}）偶发返回「提交瞬间的过期快照」——
// 任务实际已成功、已扣费，但该接口永远说 IN_PROGRESS。
// 控制台通道读取任务库的最终状态（status / fail_reason / result_url），可作兜底。
// 需要两个环境变量（缺省时本通道自动停用，不影响主流程）：
//   CONSOLE_ACCESS_TOKEN  控制台「个人设置 → 访问令牌」生成的令牌
//   CONSOLE_USER_ID       账号数字 ID
const CONSOLE_ACCESS_TOKEN = process.env.CONSOLE_ACCESS_TOKEN || "";
const CONSOLE_USER_ID = process.env.CONSOLE_USER_ID || "";

function isHttp(s: any): s is string {
  return typeof s === "string" && /^https?:\/\//i.test(s);
}
function looksLikeVideo(s: any): boolean {
  return isHttp(s) && /\.(mp4|mov|webm|m4v)(\?|$)/i.test(s);
}

// 递归挖成片地址：兼容 fail_reason / result_url / data.content.video_url 等所有已知形态
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
    if (isHttp(obj.result_url)) return obj.result_url;
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

const FAIL_STATUSES = ["failed", "failure", "fail", "error", "cancelled", "canceled", "rejected"];

// 通道 B：按 task_id 精确查控制台任务记录
async function queryConsoleTask(taskId: string): Promise<any | null> {
  if (!CONSOLE_ACCESS_TOKEN || !CONSOLE_USER_ID) return null;
  try {
    const u = `${VIDEO_BASE_URL}/api/task/self?p=1&page_size=10&task_id=${encodeURIComponent(taskId)}`;
    const r = await fetch(u, {
      headers: {
        Authorization: CONSOLE_ACCESS_TOKEN,
        "New-Api-User": CONSOLE_USER_ID,
      },
      cache: "no-store",
    });
    if (!r.ok) return null;
    const j: any = await r.json().catch(() => null);
    const items = j?.data?.items;
    if (!Array.isArray(items)) return null;
    return items.find((t: any) => t?.task_id === taskId) ?? null;
  } catch {
    return null;
  }
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

  try {
    // ===== 通道 A：标准查询接口 =====
    const url = `${VIDEO_BASE_URL}/v1/video/generations/${encodeURIComponent(taskId)}`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${VIDEO_API_KEY}` },
      cache: "no-store",
    });
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

    // ① 通道 A 给出成片 → 完成
    const videoUrl = findVideoUrl(data);
    if (videoUrl) return NextResponse.json({ status: "done", videoUrl });

    // ② 通道 A 明确说失败 → 报错
    const sA = String(
      data?.data?.data?.status ?? data?.data?.status ?? data?.status ?? ""
    ).toLowerCase();
    if (FAIL_STATUSES.includes(sA)) {
      const fr = data?.data?.fail_reason ?? data?.fail_reason;
      const msg = typeof fr === "string" && !isHttp(fr) && fr ? fr : "生成失败";
      return NextResponse.json({ status: "error", error: msg });
    }

    // ===== 通道 B：通道 A 说「还没好」时，向控制台核实真相 =====
    const ct = await queryConsoleTask(taskId);
    let consoleSaysSuccess = false;
    if (ct) {
      const u2 = findVideoUrl(ct);
      if (u2) return NextResponse.json({ status: "done", videoUrl: u2 });
      const sB = String(ct.status ?? "").toLowerCase();
      if (FAIL_STATUSES.includes(sB)) {
        const fr2 = typeof ct.fail_reason === "string" && !isHttp(ct.fail_reason) ? ct.fail_reason : "";
        return NextResponse.json({ status: "error", error: fr2 || "生成失败" });
      }
      consoleSaysSuccess = sB === "success";
    }

    // ③ 僵尸任务检测：提交超过 10 分钟还没开始渲染（start_time=0），
    //    且控制台也没有更好的消息 → 基本是卡死在平台侧了
    const submitTime = data?.data?.submit_time;
    const startTime = data?.data?.start_time;
    if (
      !consoleSaysSuccess &&
      typeof submitTime === "number" &&
      submitTime > 0 &&
      startTime === 0 &&
      Date.now() / 1000 - submitTime > 600
    ) {
      return NextResponse.json({
        status: "error",
        error: `平台超过10分钟未开始处理，疑似卡死。请删除卡片重新生成（如需反馈给零克云，任务ID：${taskId}）`,
      });
    }

    // ④ 仍在进行（进度可能是 "60%" 字符串，转成数字）
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
