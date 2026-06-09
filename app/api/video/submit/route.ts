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
  // Seedance「创建任务」：new-api 网关路径 = POST {BASE}/v1/video/generations，返回任务 id。
  // 请求体用火山原生 content 数组；清晰度/时长用 --rs / --rt / --dur 文本指令带入。
  // 若平台报的是「参数/字段」错误（而非 Invalid URL），把文档里的创建任务 JSON 发我，
  // 大概率是 content 数组 vs 扁平字段（model/prompt/image_url）的区别，改这段 body 即可。
  // ===================================================================
  try {
    const url = `${VIDEO_BASE_URL}/v1/video/generations`; // ← 接口路径
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${VIDEO_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        content: [                                                           // ← 请求体结构
          {
            type: "text",
            text: `${prompt || "让画面自然动起来"} --rs ${res} --rt adaptive --dur ${dur}`,
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
