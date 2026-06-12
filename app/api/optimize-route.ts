import { NextRequest, NextResponse } from "next/server";
import { checkAuth, IMAGE_API_KEY, IMAGE_BASE_URL } from "@/lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 提示词优化：丢给网关上的一个 chat 模型扩写。
// 模型名走环境变量 OPTIMIZE_MODEL（在 Netlify 配置），默认 deepseek-chat——
// 如果零克云上的调用名不同，改环境变量即可，不用动代码。
const SYSTEM_PROMPTS: Record<string, string> = {
  image:
    "你是文生图提示词专家。把用户的简短描述扩写成一段高质量中文提示词：明确主体与场景，补充构图、镜头、光线、色调、风格与质感等细节，信息密度高、无废话。只输出提示词本身，不要任何解释、引号或前后缀，长度 80~150 字。",
  video:
    "你是图生视频运动提示词专家。基于用户描述写一段运动提示词：主体怎么动、镜头如何运动（推/拉/摇/移/跟）、节奏快慢与整体氛围，让画面自然延展，不要引入画面里没有的新主体。只输出提示词本身，不要任何解释、引号或前后缀，长度 40~100 字。",
};

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "访问口令错误" }, { status: 401 });

  const { prompt, kind } = await req.json().catch(() => ({}));
  if (!prompt || typeof prompt !== "string") {
    return NextResponse.json({ error: "缺少 prompt" }, { status: 400 });
  }
  const system = SYSTEM_PROMPTS[String(kind)] || SYSTEM_PROMPTS.image;

  const BASE = IMAGE_BASE_URL;
  const KEY = IMAGE_API_KEY;
  if (!BASE || !KEY) {
    return NextResponse.json({ error: "服务端未配置 MAAS_BASE_URL / MAAS_API_KEY" }, { status: 500 });
  }
  const model = (process.env.OPTIMIZE_MODEL || "deepseek-chat").trim();

  try {
    const r = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt.trim() },
        ],
        temperature: 0.8,
        max_tokens: 600,
      }),
    });
    const text = await r.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {}
    if (!r.ok) {
      return NextResponse.json(
        { error: `优化模型调用失败(${r.status}): ${text.slice(0, 200)}。若是模型不存在，请在 Netlify 设置 OPTIMIZE_MODEL 为零克云上可用的 chat 模型名` },
        { status: 502 }
      );
    }
    const out = data?.choices?.[0]?.message?.content?.trim();
    if (!out) return NextResponse.json({ error: "优化模型未返回内容" }, { status: 502 });
    return NextResponse.json({ prompt: out });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
