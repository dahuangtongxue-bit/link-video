import { NextRequest, NextResponse } from "next/server";
import { checkAuth, VIDEO_API_KEY, VIDEO_BASE_URL } from "@/lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 把一张公网图片 URL 导入 Seedance 素材库，返回 assetId（供视频请求里写 asset://{assetId}）。
// 流程（已对照零克云文档「三、素材管理接口」）：
//   1. CreateAssetGroup → 拿 GroupId
//   2. CreateAsset(GroupId + 公网URL) → 拿 AssetId
//   3. GetAsset 轮询到 Status=Active
// 接口基础路径 {BASE}/seedance/asset/，统一 Bearer 鉴权。
//
// 为什么必须走这里：零克云网关会丢弃 metadata.content 里裸 URL 的 reference_image
// （实测 scenario 退化成 text_to_video），只有 asset:// 引用才被正确透传给上游。

async function callAsset(action: string, payload: any) {
  const url = `${VIDEO_BASE_URL}/seedance/asset/${action}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${VIDEO_API_KEY}` },
    body: JSON.stringify(payload),
  });
  const text = await r.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {}
  return { httpOk: r.ok, httpStatus: r.status, data, text };
}

// 文档里成功响应形如 { state:1, data:{...}, error:null }；失败 error 不为 null 或 data.Error 有值
function extractError(res: { data: any; text: string }): string | null {
  const d = res.data;
  if (!d) return `非 JSON 响应: ${res.text.slice(0, 160)}`;
  if (d.error) {
    const e = d.error;
    return e.message || e.Message || e.code || JSON.stringify(e);
  }
  if (d.data && d.data.Error) {
    const e = d.data.Error;
    return e.Message || e.Code || JSON.stringify(e);
  }
  return null;
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "访问口令错误" }, { status: 401 });

  const { imageUrl, assetType } = await req.json().catch(() => ({} as any));
  if (!imageUrl || typeof imageUrl !== "string") {
    return NextResponse.json({ error: "缺少 imageUrl" }, { status: 400 });
  }
  if (imageUrl.startsWith("data:")) {
    return NextResponse.json(
      { error: "素材库只接受公网图片地址，不接受 base64。请用生成的图，或先上传到图床。" },
      { status: 400 }
    );
  }
  if (!VIDEO_BASE_URL || !VIDEO_API_KEY) {
    return NextResponse.json({ error: "服务端未配置 MAAS_BASE_URL / MAAS_API_KEY" }, { status: 500 });
  }
  const type = assetType === "Video" || assetType === "Audio" ? assetType : "Image";

  try {
    // 1) 建素材组
    const g = await callAsset("CreateAssetGroup", {
      Name: "ai-canvas",
      Description: "AI 画布工作台参考素材",
    });
    const gErr = extractError(g);
    if (!g.httpOk || gErr) {
      return NextResponse.json(
        { error: `CreateAssetGroup 失败(${g.httpStatus}): ${gErr || g.text.slice(0, 160)}` },
        { status: 502 }
      );
    }
    const groupId = g.data?.data?.Id || g.data?.data?.id || g.data?.Id;
    if (!groupId) {
      return NextResponse.json(
        { error: `未拿到 GroupId: ${g.text.slice(0, 160)}` },
        { status: 502 }
      );
    }

    // 2) 建素材
    const a = await callAsset("CreateAsset", {
      GroupId: groupId,
      URL: imageUrl,
      AssetType: type,
      Name: "参考图",
    });
    const aErr = extractError(a);
    if (!a.httpOk || aErr) {
      return NextResponse.json(
        { error: `CreateAsset 失败(${a.httpStatus}): ${aErr || a.text.slice(0, 160)}` },
        { status: 502 }
      );
    }
    const assetId = a.data?.data?.Id || a.data?.data?.id || a.data?.Id;
    if (!assetId) {
      return NextResponse.json({ error: `未拿到 AssetId: ${a.text.slice(0, 160)}` }, { status: 502 });
    }

    // 3) 轮询到 Active（图片通常 < 30 秒）
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    let status = "";
    let lastDetail = "";
    for (let i = 0; i < 20; i++) {
      const q = await callAsset("GetAsset", { Id: assetId });
      const inner = q.data?.data || {};
      status = inner.Status || inner.status || "";
      if (status === "Active") {
        return NextResponse.json({ assetId, ref: `asset://${assetId}` });
      }
      if (status === "Failed") {
        const e = inner.Error || {};
        return NextResponse.json(
          { error: `素材审核失败: ${e.Message || e.Code || "asset process failed"}` },
          { status: 502 }
        );
      }
      lastDetail = status || q.text.slice(0, 80);
      await wait(3000);
    }
    return NextResponse.json(
      { error: `素材轮询超时（最后状态: ${lastDetail || "未知"}）` },
      { status: 504 }
    );
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
