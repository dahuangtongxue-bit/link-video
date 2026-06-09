import { NextRequest, NextResponse } from "next/server";
import { checkAuth, videoIsMock, VIDEO_API_KEY, VIDEO_BASE_URL } from "@/lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "访问口令错误" }, { status: 401 });

  const { imageUrl, prompt, model, resolution, duration } = await req.json().catch(() => ({}));
  if (!imageUrl) return NextResponse.json({ error: "缺少 imageUrl" }, { status: 400 });

  const res = resolution || "720p";
  const dur = duration || "5";

  // ---------- MOCK ----------
  if (videoIsMock) {
    const readyAt = Date.now() + 8000;
    return NextResponse.json({ taskId: `mock_${readyAt}` });
  }

  // ===================================================================
  // Seedance 2.0「创建任务」：异步，返回任务 id（火山方舟原生格式）。
  // 清晰度/时长用 Seedance 的文本指令 --resolution / --duration 传。
  // 若 零克云 文档不同，核对带 ← 的：① 路径 ② content 结构 ③ id 字段。
  // （若你平台用显式字段而非文本指令，把 res/dur 放进 body 顶层即可。）
  // ===================================================================
  try {
    const url = `${VIDEO_BASE_URL}/api/v3/contents/generations/tasks`; // ← 接口路径
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${VIDEO_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        content: [                                                       // ← content 数组
          {
            type: "text",
            text: `${prompt || "让画面自然动起来"} --resolution ${res} --ratio adaptive --duration ${dur}`,
          },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      }),
    });

    if (!r.ok) {
      const t = await r.text();
      return NextResponse.json({ error: `平台返回错误: ${t.slice(0, 300)}` }, { status: 502 });
    }

    const data = await r.json();
    const taskId: string | undefined = data?.id || data?.task_id || data?.data?.id; // ← 取任务 id
    if (!taskId) return NextResponse.json({ error: "未从响应解析到任务 ID" }, { status: 502 });

    return NextResponse.json({ taskId });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "请求平台失败" }, { status: 500 });
  }
}
