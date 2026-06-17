import { NextRequest, NextResponse } from "next/server";
import { checkAuth, videoIsMock, VIDEO_API_KEY, VIDEO_BASE_URL } from "@/lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TOO_BIG = 4_000_000;

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "访问口令错误" }, { status: 401 });

  const {
    imageUrl,
    firstImageUrl,
    lastImageUrl,
    referenceImageUrl,
    referenceImageUrls,
    sourceVideoUrl,
    prompt,
    model,
    resolution,
    duration,
    ratio,
  } = await req.json().catch(() => ({} as any));

  const firstUrl = firstImageUrl || imageUrl || "";
  const lastUrl = lastImageUrl || "";
  // 多参考图：优先用数组，兼容旧单字段
  const refImgs: string[] = Array.isArray(referenceImageUrls)
    ? referenceImageUrls.filter((u: any) => typeof u === "string" && u)
    : referenceImageUrl
    ? [referenceImageUrl]
    : [];
  const srcVideo = sourceVideoUrl || "";

  if (!firstUrl && !refImgs.length && !srcVideo) {
    return NextResponse.json({ error: "缺少图片或视频输入" }, { status: 400 });
  }

  // 混用规则（文档：reference_image 不能与 first/last 同时；尾帧必须配首帧）
  if (refImgs.length && (firstUrl || lastUrl)) {
    return NextResponse.json(
      { error: "参考图不能与首帧/尾帧同时使用" },
      { status: 400 }
    );
  }
  if (lastUrl && !firstUrl) {
    return NextResponse.json({ error: "设置尾帧前必须先设置首帧" }, { status: 400 });
  }

  // base64 防线：零克云只接受公网 URL / asset://，base64 会被丢弃退化成文生视频。
  // 首尾帧理论上也只认 URL；这里对超大 base64 直接拦下避免请求体过大。
  for (const u of [firstUrl, lastUrl, ...refImgs]) {
    if (typeof u === "string" && u.startsWith("data:") && u.length > TOO_BIG) {
      return NextResponse.json(
        { error: "图片过大。请删除后重新上传（会自动压缩）" },
        { status: 400 }
      );
    }
  }

  const dur = Math.min(15, Math.max(4, Number(duration) || 5)); // 平台最小 4 秒
  const ratioVal = typeof ratio === "string" && ratio && ratio !== "adaptive" ? ratio : "";
  const res = (resolution || "720p").toString().toLowerCase();
  const promptText =
    prompt && prompt.trim() ? prompt.trim() : "让画面自然地动起来，保持主体稳定、镜头平滑";

  if (videoIsMock) {
    const readyAt = Date.now() + 8000;
    return NextResponse.json({ taskId: `mock_${readyAt}` });
  }

  try {
    // 路径必须带 /v1（VIDEO_BASE_URL 已被 cleanBase 去掉 /v1）
    const url = `${VIDEO_BASE_URL}/v1/video/generations`;

    // content: text 在前，媒体元素(带 role)在后
    const content: any[] = [{ type: "text", text: promptText }];
    if (srcVideo) {
      content.push({ type: "video_url", video_url: { url: srcVideo }, role: "reference_video" });
    }
    if (refImgs.length) {
      for (const u of refImgs) {
        content.push({ type: "image_url", image_url: { url: u }, role: "reference_image" });
      }
    }
    if (firstUrl) {
      content.push({ type: "image_url", image_url: { url: firstUrl }, role: "first_frame" });
    }
    if (lastUrl) {
      content.push({ type: "image_url", image_url: { url: lastUrl }, role: "last_frame" });
    }

    // body 格式严格对照 infinite-canvas 实跑通的代码：
    // ratio / resolution / duration / generate_audio / watermark 全部放 body 顶层，
    // 和 model/content 平级，【不要】用 metadata 包裹（之前塞 metadata 导致 duration 各种报错）。
    const body: any = {
      model,
      content,
      resolution: res,
      duration: dur, // 数字，平台最小 4~5 秒
      generate_audio: true,
      watermark: false,
    };
    if (ratioVal) body.ratio = ratioVal;

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${VIDEO_API_KEY}` },
      body: JSON.stringify(body),
    });

    const text = await r.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {}

    if (!r.ok) {
      return NextResponse.json(
        { error: `平台返回错误(${r.status}): ${text.slice(0, 300)}` },
        { status: 502 }
      );
    }

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
