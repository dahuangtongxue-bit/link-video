import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanBase(b: string) {
  return (b || "").trim().replace(/\/+$/, "").replace(/\/v1$/, "");
}

// 画布助手「大脑」：读用户这句话 + 当前画布上下文，理解成一个【动作】，
// 只输出一个 JSON 对象。前端拿到动作后在画布上执行（生成/回答/…）。
// 动作层是稳定契约——以后想换更强的模型、或升级成多步 Agent，这层不用动。
const SYSTEM = `你是「AI 画布工作台」的助手大脑。用户在一个无限画布上：用文字生成图片，再把图片生成视频。
你的唯一任务：把用户这句话理解成一个【动作】，并且【只输出一个 JSON 对象，不要任何解释、不要 markdown 代码块、不要 <think>】。

可用动作（二选一）：
1. 生成图片 —— 用户想画一张新图 / 生成图片 / 描述了一个画面时：
   {"action":"generate_image","prompt":"<干净、完整的中文生图提示词>"}
   prompt 要忠实用户意图，可以把它补全成一句通顺的画面描述，但不要擅自加入用户没提到的主体或风格。
2. 直接回答 —— 用户在问问题、闲聊、或要建议（不是要你生成图片）时：
   {"action":"answer","text":"<简洁的中文回答>"}

当前选中的卡片：{{CONTEXT}}
若用户用「这张」「它」等指代且有选中卡片，按选中卡片理解。

记住：只输出一个 JSON 对象。`;

export async function POST(req: NextRequest) {
  const PASS = (process.env.ACCESS_PASSWORD || "").trim();
  const key = req.headers.get("x-access-key") || "";
  if (PASS && key !== PASS) return NextResponse.json({ error: "访问口令错误" }, { status: 401 });

  let body: any = null;
  try {
    body = await req.json();
  } catch {}
  const message = (body?.message || "").toString().trim();
  const context = body?.context || null;
  if (!message) return NextResponse.json({ error: "消息为空" }, { status: 400 });

  const BASE = cleanBase(process.env.MAAS_BASE_URL || "");
  const KEY = (process.env.MAAS_API_KEY || "").trim();
  const MODEL = (process.env.CHAT_MODEL || "").trim();
  if (!BASE || !KEY)
    return NextResponse.json({ error: "服务端未配置 MAAS_BASE_URL / MAAS_API_KEY" }, { status: 500 });
  if (!MODEL)
    return NextResponse.json(
      { error: "未配置 CHAT_MODEL：在 Netlify 环境变量里设成你平台的文本模型 id（如 deepseek-… / qwen-… ，全 ASCII）" },
      { status: 500 }
    );

  const ctxText = context?.selected
    ? `类型=${context.selected.type}，名称=${context.selected.name || "未命名"}，提示词=${context.selected.prompt || "(无)"}`
    : "无";
  const sys = SYSTEM.replace("{{CONTEXT}}", ctxText);

  try {
    const r = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: message },
        ],
        temperature: 0.3,
        stream: false,
      }),
    });
    const text = await r.text();
    if (!r.ok)
      return NextResponse.json({ error: `平台返回错误(${r.status}): ${text.slice(0, 300)}` }, { status: 502 });

    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {}
    let content: string = data?.choices?.[0]?.message?.content || "";

    // 防弹解析：去思考标签、去代码围栏、抓第一个 {...}
    content = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    content = content.replace(/```json|```/g, "").trim();
    const m = content.match(/\{[\s\S]*\}/);
    let action: any = null;
    if (m) {
      try {
        action = JSON.parse(m[0]);
      } catch {}
    }
    if (!action || !action.action) {
      // 兜底：当成直接回答，把模型说的话原样带回
      action = { action: "answer", text: content || "（没太听懂，换个说法再试试？）" };
    }
    return NextResponse.json({ action });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
