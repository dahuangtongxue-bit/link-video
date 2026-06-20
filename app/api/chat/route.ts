import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function cleanBase(b: string) {
  return (b || "").trim().replace(/\/+$/, "").replace(/\/v1$/, "");
}

// 画布助手「生文」模式：纯问答。
// 生图 / 生视频 由前端按钮直接发起，不经过这里——所以那两条路不依赖这个接口。
const SYSTEM_ASK = `你是「AI 画布工作台」的助手。用户在这个无限画布上用文字生成图片和视频。
请简洁、友好地用中文回答用户的问题或请求。
如果用户其实是想生成图片或视频，提醒他用输入框上方的「生图 / 生视频」按钮切到对应模式后再描述。`;

export async function POST(req: NextRequest) {
  const PASS = (process.env.ACCESS_PASSWORD || "").trim();
  const key = req.headers.get("x-access-key") || "";
  if (PASS && key !== PASS) return NextResponse.json({ error: "访问口令错误" }, { status: 401 });

  let body: any = null;
  try {
    body = await req.json();
  } catch {}
  const message = (body?.message || "").toString().trim();
  if (!message) return NextResponse.json({ error: "消息为空" }, { status: 400 });

  const BASE = cleanBase(process.env.MAAS_BASE_URL || "");
  const KEY = (process.env.MAAS_API_KEY || "").trim();
  const MODEL = (process.env.CHAT_MODEL || "").trim();
  if (!BASE || !KEY)
    return NextResponse.json({ error: "服务端未配置 MAAS_BASE_URL / MAAS_API_KEY" }, { status: 500 });
  if (!MODEL)
    return NextResponse.json(
      { error: "未配置 CHAT_MODEL（在 Netlify 环境变量里设成你平台的文本模型 id，全 ASCII）" },
      { status: 500 }
    );

  try {
    const r = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_ASK },
          { role: "user", content: message },
        ],
        temperature: 0.5,
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
    content = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    return NextResponse.json({ text: content || "（没拿到回答）" });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
