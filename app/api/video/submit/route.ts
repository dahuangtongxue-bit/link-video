import { NextRequest, NextResponse } from "next/server";
import { checkAuth, videoIsMock, VIDEO_API_KEY, VIDEO_BASE_URL } from "@/lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "访问口令错误" }, { status: 401 });

  const { imageUrl, prompt, model, resolution, duration } = await req
    .json()
    .catch(() => ({} as any));
  if (!imageUrl) return NextResponse.json({ error: "缺少 imageUrl" }, { status: 400 });

  const dur = Number(duration) || 5;
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
    const body = {
      model,
      prompt:
        prompt && prompt.trim() ? prompt.trim() : "让画面自然地动起来，保持主体稳定、镜头平滑",
      image: imageUrl,
      duration: dur,
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
