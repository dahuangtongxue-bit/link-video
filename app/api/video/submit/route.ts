import { NextRequest, NextResponse } from "next/server";
import { checkAuth, videoIsMock, VIDEO_API_KEY, VIDEO_BASE_URL } from "@/lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "访问口令错误" }, { status: 401 });

  const { imageUrl, lastImageUrl, prompt, model, resolution, duration } = await req
    .json()
    .catch(() => ({} as any));
  if (!imageUrl) return NextResponse.json({ error: "缺少 imageUrl" }, { status: 400 });

  // 超大 base64 防线：旧版上传的未压缩原图会压垮请求链路，明确拒绝并给出指引
  for (const u of [imageUrl, lastImageUrl]) {
    if (typeof u === "string" && u.startsWith("data:") && u.length > 4_000_000) {
      return NextResponse.json(
        { error: "上传图过大。请删除该图片卡后重新上传（新版上传会自动压缩）" },
        { status: 400 }
      );
    }
  }

  const dur = Math.min(10, Math.max(3, Number(duration) || 5)); // 3~10 秒
  const res = (resolution || "720p").toString().toLowerCase(); // 480p / 720p / 1080p

  // ---------- MOCK ----------
  if (videoIsMock) {
    const readyAt = Date.now() + 8000;
    return NextResponse.json({ taskId: `mock_${readyAt}` });
  }

  // ===================================================================
  // 创建任务：POST {BASE}/v1/video/generations
  // New API 视频用「扁平字段」（不是火山 content 数组）：
  //   model(必填) / prompt(必填) / image(图URL) / duration(秒) / metadata(供应商自定义)
  // 成功返回 201 + { task_id, status:"processing" } —— 查询要用 task_id。
  // ===================================================================
  try {
    const url = `${VIDEO_BASE_URL}/v1/video/generations`;
    const promptText =
      prompt && prompt.trim() ? prompt.trim() : "让画面自然地动起来，保持主体稳定、镜头平滑";

    // 两种模式（已对照 new-api 源码核实）：
    // ① 单图（首帧）：扁平 image 字段 —— 适配器转成 content 里的 image_url 条目（已验证可用）
    // ② 首尾帧：metadata.content 带 role 标记 —— UnmarshalMetadata 把 metadata 整体 JSON
    //    直灌进上游载荷（只挡 model 字段），role: first_frame / last_frame 原样到火山引擎
    // duration 双保险：适配器实际读 seconds(字符串) 换算时长，duration 数字也一并带上
    const body: any = lastImageUrl
      ? {
          model,
          prompt: promptText,
          duration: dur,
          seconds: String(dur),
          metadata: {
            resolution: res,
            content: [
              { type: "image_url", image_url: { url: imageUrl }, role: "first_frame" },
              { type: "image_url", image_url: { url: lastImageUrl }, role: "last_frame" },
            ],
          },
        }
      : {
          model,
          prompt: promptText,
          image: imageUrl,
          duration: dur,
          seconds: String(dur),
          metadata: { resolution: res }, // 供应商自定义参数；不支持会被忽略，不影响提交
        };

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${VIDEO_API_KEY}` },
      body: JSON.stringify(body),
    });

    const text = await r.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {
      /* 平台返回非 JSON */
    }

    if (!r.ok) {
      return NextResponse.json(
        { error: `平台返回错误(${r.status}): ${text.slice(0, 300)}` },
        { status: 502 }
      );
    }

    // 关键：查询用 task_id，不是 id
    const taskId: string | undefined =
      data?.task_id || data?.data?.task_id || data?.id || data?.data?.id;
    if (!taskId) {
      return NextResponse.json(
        { error: `未解析到 task_id，平台返回: ${text.slice(0, 200)}` },
        { status: 502 }
      );
    }

    return NextResponse.json({ taskId });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "请求平台失败" }, { status: 500 });
  }
}
