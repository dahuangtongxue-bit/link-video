import { NextRequest, NextResponse } from "next/server";
import { checkAuth, imageIsMock, IMAGE_API_KEY, IMAGE_BASE_URL, sleep } from "@/lib/serverAuth";
import { imageSize } from "@/lib/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "访问口令错误" }, { status: 401 });

  const { prompt, model, size, ratio, image: srcImage } = await req.json().catch(() => ({}));
  if (!prompt) return NextResponse.json({ error: "缺少 prompt" }, { status: 400 });

  // 档位 × 比例 → 宽x高（与后台函数、lib/models.ts 共用同一张 SIZE_TABLE）
  const px = imageSize(size, ratio);

  // ---------- MOCK：未配置平台时返回占位图 ----------
  if (imageIsMock) {
    await sleep(1500);
    const seed = encodeURIComponent(String(prompt)).slice(0, 24) || "ai";
    return NextResponse.json({ imageUrl: `https://picsum.photos/seed/${seed}/768/768` });
  }

  // ===================================================================
  // 豆包图像（Seedream）：OpenAI 兼容的同步接口。
  // 已按公开标准格式接好；若你 零克云 文档不同，核对带 ← 的几行即可。
  // ===================================================================
  try {
    const genBody: Record<string, any> = {
      model,                       // 模型名来自 lib/models.ts
      prompt,
      size: px,                    // 由 档位×比例 映射而来
      response_format: "url",      // ← 要 url；平台只给 base64 就改 "b64_json"
      watermark: false,            // ← 去水印（个别平台没这个字段，删掉即可）
    };
    if (srcImage) genBody.image = srcImage;  // ← 图生图：源图字段（若文档叫 image_url/images 就改这里）

    const r = await fetch(`${IMAGE_BASE_URL}/v1/images/generations`, {   // ← 接口路径
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${IMAGE_API_KEY}`,
      },
      body: JSON.stringify(genBody),
    });

    if (!r.ok) {
      const t = await r.text();
      return NextResponse.json({ error: `平台返回错误: ${t.slice(0, 300)}` }, { status: 502 });
    }

    const data = await r.json();
    const raw: string | undefined = data?.data?.[0]?.url || data?.data?.[0]?.b64_json; // ← 取图地址
    if (!raw) return NextResponse.json({ error: "未从响应解析到图片" }, { status: 502 });

    const imageUrl = raw.startsWith("http") ? raw : `data:image/png;base64,${raw}`;
    return NextResponse.json({ imageUrl });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "请求平台失败" }, { status: 500 });
  }
}
