import { NextRequest, NextResponse } from "next/server";
import { checkAuth, IMAGE_API_KEY, IMAGE_BASE_URL } from "@/lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 反推提示词（图生文）：把图片丢给多模态视觉模型，反推出一段可直接用于文生图的提示词。
// 模型名走环境变量 VISION_MODEL（必须是支持图片输入的对话模型）。
const REVERSE_PROMPT = [
  "请根据这张参考图片，反推出一段适合直接用于 AI 文生图（Seedream）的中文提示词。",
  "要求：",
  "1. 只输出提示词正文，不要任何解释、标题、引号或前后缀；",
  "2. 自然融成一段话，覆盖：主体（外观/材质/表情/动作）、场景与环境、构图与视角（景别/机位/主体位置）、光线（光源方向/明暗）、色彩（主色调/饱和度）、风格与质感（摄影/插画/3D、镜头与胶片质感）；",
  "3. 只用肯定句描述画面里有什么，不要用否定句；",
  "4. 长度 100~180 字。",
].join("\n");

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "访问口令错误" }, { status: 401 });

  const { imageUrl } = await req.json().catch(() => ({}));
  if (!imageUrl || typeof imageUrl !== "string") {
    return NextResponse.json({ error: "缺少 imageUrl" }, { status: 400 });
  }

  const BASE = IMAGE_BASE_URL;
  const KEY = IMAGE_API_KEY;
  if (!BASE || !KEY) {
    return NextResponse.json(
      { error: "服务端未配置 MAAS_BASE_URL / MAAS_API_KEY" },
      { status: 500 }
    );
  }
  const model = (process.env.VISION_MODEL || "doubao-seed-2-0-pro-260215").trim();

  try {
    const r = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: REVERSE_PROMPT },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
        temperature: 0.6,
        max_tokens: 800,
      }),
    });
    const text = await r.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {}
    if (!r.ok) {
      return NextResponse.json(
        {
          error: `反推模型调用失败(${r.status}): ${text.slice(
            0,
            200
          )}。若提示模型不存在或不支持图片，请在 Netlify 把 VISION_MODEL 设为零克云上支持图片输入的对话模型名`,
        },
        { status: 502 }
      );
    }
    const out = data?.choices?.[0]?.message?.content?.trim();
    if (!out) return NextResponse.json({ error: "反推模型未返回内容" }, { status: 502 });
    return NextResponse.json({ prompt: out });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
