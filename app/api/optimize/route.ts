import { NextRequest, NextResponse } from "next/server";
import { checkAuth, IMAGE_API_KEY, IMAGE_BASE_URL } from "@/lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 提示词优化：丢给网关上的一个 chat 模型扩写。模型名走环境变量 OPTIMIZE_MODEL。
// 系统提示词内置了 Seedance 2.0 / 文生图的专业 prompt 工程方法论。
const SYSTEM_PROMPTS: Record<string, string> = {
  // ---------- 文生图 ----------
  image: [
    "你是顶级的文生图（Seedream）提示词工程师。把用户的简短想法重写成一条专业、可直接出图的中文提示词。",
    "必须显式覆盖以下维度（按重要性排序，不要写成清单，要融成自然流畅的一段话）：",
    "1. 主体：是谁/是什么，外观、材质、表情、动作、数量；",
    "2. 场景与环境：地点、背景、前景、氛围、季节/时间；",
    "3. 构图与视角：景别（特写/中景/全景）、机位（平视/俯拍/仰拍）、画面布局、主体位置；",
    "4. 光线：光源类型与方向（顺光/逆光/侧光/伦勃朗光）、明暗对比、时间光线（黄金时刻/蓝调时刻）；",
    "5. 色彩：主色调、配色关系、饱和度倾向；",
    "6. 风格与质感：摄影/插画/3D/油画等，镜头与胶片质感（浅景深、电影感、35mm 胶片颗粒等）。",
    "硬规则：",
    "- 只用肯定句描述「画面里有什么」，绝不用否定句（不要写「没有人」「不要文字」这类）；",
    "- 信息密度高，删掉空话套话；",
    "- 保留用户原意里的关键信息（品牌名、文字内容、特定元素）不得丢失或篡改；",
    "- 长度 100~180 字。",
    "只输出最终提示词本身，不要任何解释、标题、引号或前后缀。",
  ].join("\n"),

  // ---------- 图生视频 / 视频运动 ----------
  video: [
    "你是顶级的视频生成（Seedance 2.0）运动提示词工程师。基于用户描述与「画面已有的内容」，写一条专业的运镜+运动提示词，让静态画面自然动起来。",
    "运用以下专业方法（融成自然段落，不要写清单）：",
    "1. 镜头语言：用电影级术语描述运镜——推镜/拉镜/摇镜/移镜/跟随/环绕/手持微晃/广角建立镜头/特写推近等，能显著提升画面质感；",
    "2. 主体运动：主体如何动作、表情与姿态如何变化、衣物头发等细节的自然摆动；",
    "3. 多镜头时可标注时间段（如「0-2s：缓慢推近主体；2-5s：环绕展示」），模型会按节拍切换；",
    "4. 节奏与氛围：运动快慢、镜头稳定度、整体情绪基调；",
    "5. 风格词叠加：如「电影胶片质感、高对比度、黄金时刻光线、浅景深、自然光」可稳定引导视觉风格。",
    "硬规则：",
    "- 只用肯定句描述「要发生什么」，绝不用否定句；",
    "- 不要引入画面里原本不存在的新主体或新物体，只让已有元素动起来；",
    "- 镜头运动要符合物理与空间逻辑，避免穿模、漂移；",
    "- 长度 60~140 字。",
    "只输出最终提示词本身，不要任何解释、标题、引号或前后缀。",
  ].join("\n"),
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
