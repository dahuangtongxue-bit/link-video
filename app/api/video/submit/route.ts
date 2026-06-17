import { NextRequest, NextResponse } from "next/server";
import { checkAuth, videoIsMock, VIDEO_API_KEY, VIDEO_BASE_URL } from "@/lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 上传图是 base64（可达数 MB），传输+提交上游耗时长，默认 10s 会 504。拉长到 60s。
export const maxDuration = 60;

const TOO_BIG = 4_000_000; // base64 data URL 上限，超了请求链路会崩

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "访问口令错误" }, { status: 401 });

  const {
    // 兼容旧字段名 imageUrl == 首帧
    imageUrl,
    firstImageUrl,
    lastImageUrl,
    referenceImageUrl, // 参考图（角色/物体/场景一致性，真人照片走这里）
    sourceVideoUrl, // 源视频（延续 / 编辑）
    prompt,
    model,
    resolution,
    duration,
    ratio,
  } = await req.json().catch(() => ({} as any));

  const firstUrl = firstImageUrl || imageUrl || "";
  const lastUrl = lastImageUrl || "";
  const refImg = referenceImageUrl || "";
  const srcVideo = sourceVideoUrl || "";

  // 至少要有一个媒体输入（纯文生视频本工具不走这条提交，画布上没有入口）
  if (!firstUrl && !refImg && !srcVideo) {
    return NextResponse.json({ error: "缺少图片或视频输入" }, { status: 400 });
  }

  // ---- 混用规则校验（违反上游会 400，这里提前拦下，省一次烧钱）----
  // 规则1：reference_image 不能与 first_frame / last_frame 同时出现
  if (refImg && (firstUrl || lastUrl)) {
    return NextResponse.json(
      { error: "参考图不能与首帧/尾帧同时使用。要么用参考图（角色一致性），要么用首尾帧（指定起止画面）" },
      { status: 400 }
    );
  }
  // 规则2：尾帧必须配首帧
  if (lastUrl && !firstUrl) {
    return NextResponse.json({ error: "设置尾帧前必须先设置首帧" }, { status: 400 });
  }

  // ---- 参考图 / 源视频必须是公网 URL ----
  // 零克云 Seedance 的参考图/源视频只认公网可访问地址（官方操练场的"图片地址"也只收 URL），
  // base64 data URL 会被网关丢弃、退化成纯文生视频。生成的图/视频自带火山引擎公网 URL，可直接用；
  // 上传的图是 data URL，没有公网地址，参考图模式下明确拦下。
  // 参考图必须是 asset://（素材库引用，前端已调 /api/asset 转换）或公网 URL，绝不能是 data URL
  if (refImg.startsWith("data:")) {
    return NextResponse.json(
      { error: "参考图需先入素材库（前端应已自动处理）。data URL 不被接受。" },
      { status: 400 }
    );
  }
  if (srcVideo.startsWith("data:")) {
    return NextResponse.json(
      { error: "源视频必须是平台生成的视频（有公网地址）" },
      { status: 400 }
    );
  }

  // ---- 超大 base64 防线 ----
  for (const u of [firstUrl, lastUrl, refImg]) {
    if (typeof u === "string" && u.startsWith("data:") && u.length > TOO_BIG) {
      return NextResponse.json(
        { error: "上传图过大。请删除该图片卡后重新上传（新版上传会自动压缩）" },
        { status: 400 }
      );
    }
  }

  const dur = Math.min(10, Math.max(3, Number(duration) || 5)); // 3~10 秒
  const ratioVal = typeof ratio === "string" && ratio && ratio !== "adaptive" ? ratio : "";
  const res = (resolution || "720p").toString().toLowerCase();
  const promptText =
    prompt && prompt.trim() ? prompt.trim() : "让画面自然地动起来，保持主体稳定、镜头平滑";

  // ---------- MOCK ----------
  if (videoIsMock) {
    const readyAt = Date.now() + 8000;
    return NextResponse.json({ taskId: `mock_${readyAt}` });
  }

  try {
    const url = `${VIDEO_BASE_URL}/v1/video/generations`;

    // ===== 组装 content 数组（已对照零克云文档 4.1.3 / 4.1.4 + new-api 源码核实）=====
    // 文档 role 取值：first_frame / last_frame / reference_image / reference_video / reference_audio
    // 经 metadata.content 通道直灌上游（resolution/ratio 同通道，已验证零克云能透传）
    const content: any[] = [];
    if (srcVideo) {
      // 视频延续 / 编辑：源视频
      content.push({ type: "video_url", video_url: { url: srcVideo }, role: "reference_video" });
    }
    if (refImg) {
      // 参考图：角色/物体/场景一致性
      content.push({ type: "image_url", image_url: { url: refImg }, role: "reference_image" });
    }
    if (firstUrl) {
      content.push({ type: "image_url", image_url: { url: firstUrl }, role: "first_frame" });
    }
    if (lastUrl) {
      content.push({ type: "image_url", image_url: { url: lastUrl }, role: "last_frame" });
    }

    const metadata: any = { resolution: res, content };
    if (ratioVal) metadata.ratio = ratioVal;

    // 时长：doubao 适配器只认 seconds(字符串经 Atoi 换算)，顶层 duration 是死字段且
    // 在 t2v 下会触发上游 "duration is not valid" 校验报错，故只发 seconds。
    const body: any = {
      model,
      prompt: promptText,
      seconds: String(dur),
      metadata,
    };

    // 单首帧这一最常见、已验证的路径，额外保留扁平 image 字段做冗余（双通道，任一生效即可）
    if (firstUrl && !lastUrl && !refImg && !srcVideo) {
      body.image = firstUrl;
    }

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${VIDEO_API_KEY}` },
      body: JSON.stringify(body),
    });

    const text = await r.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {
      /* 平台返回非 JSON */
    }

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
