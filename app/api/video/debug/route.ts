import { NextRequest, NextResponse } from "next/server";
import { VIDEO_API_KEY, VIDEO_BASE_URL } from "@/lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 调试用：直接在浏览器打开
//   /api/video/debug?taskId=cgt-xxxxxxxx
// 它会用服务端 key 去查零克云，把原始返回原样吐出来，方便看「视频地址到底在哪个字段」。
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const taskId = searchParams.get("taskId") || "";
  if (!taskId) {
    return NextResponse.json({
      hint: "请在网址后面加 ?taskId=xxx（从零克云『任务日志』里复制一条成功任务的 任务ID）",
    });
  }

  const queriedUrl = `${VIDEO_BASE_URL}/v1/video/generations/${encodeURIComponent(taskId)}`;
  try {
    const r = await fetch(queriedUrl, {
      headers: { Authorization: `Bearer ${VIDEO_API_KEY}` },
    });
    const text = await r.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {}
    return NextResponse.json(
      {
        queriedUrl,
        httpStatus: r.status,
        parsed,
        rawText: parsed ? undefined : text.slice(0, 3000),
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json({ queriedUrl, error: e?.message || "请求失败" });
  }
}
