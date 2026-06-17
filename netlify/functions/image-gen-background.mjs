import { getStore } from "@netlify/blobs";

const STORE = "image-jobs";

function cleanBase(b) {
  let s = (b || "").trim().replace(/\/+$/, "");
  s = s.replace(/\/v1$/, "");
  return s;
}

// 把图片（火山临时 URL 或 base64）转存到 ImgBB，拿永久公网 URL。
// 火山 TOS 的签名 URL 24 小时过期，转存后永不过期，后续参考图/首尾帧/remix 才不会 403。
// 失败时返回原 URL（降级，不阻断生成）。
async function rehostToImgbb(imageUrlOrB64) {
  const KEY = (process.env.IMGBB_API_KEY || "").trim();
  if (!KEY) return imageUrlOrB64; // 没配 key 就不转存，用原图
  try {
    // ImgBB 的 image 参数：可以是图片 URL，也可以是纯 base64（去掉 data: 前缀）。
    let imageParam = imageUrlOrB64;
    const m = /^data:image\/[^;]+;base64,(.+)$/.exec(imageUrlOrB64 || "");
    if (m) imageParam = m[1]; // base64：去掉 data 前缀
    // 若是 http URL，ImgBB 支持直接传 URL 让它去拉
    const form = new URLSearchParams();
    form.append("image", imageParam);
    const resp = await fetch(`https://api.imgbb.com/1/upload?key=${KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const j = await resp.json().catch(() => null);
    const permanent = j && j.data && (j.data.url || j.data.display_url);
    if (resp.ok && permanent) return permanent;
    return imageUrlOrB64; // 转存失败，降级用原图
  } catch {
    return imageUrlOrB64; // 网络异常，降级用原图
  }
}

// 文件名以 -background 结尾 → Netlify 后台函数：调用方立刻收到 202，函数体在后台最多跑 15 分钟。
// 用途：Seedream 5.0 在 2K/4K 档生成时长远超普通函数 10~26 秒上限（之前的 504 就是这么来的）。
export default async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  let body = null;
  try {
    body = await req.json();
  } catch {}
  const { jobId, prompt, model, size } = body || {};
  const accessKey = req.headers.get("x-access-key") || (body && body.accessKey) || "";

  const PASS = (process.env.ACCESS_PASSWORD || "").trim();
  if (PASS && accessKey !== PASS) return new Response("unauthorized", { status: 401 });
  if (!jobId || !prompt) return new Response("missing jobId/prompt", { status: 400 });

  const store = getStore({ name: STORE, consistency: "strong" }); // 强一致：写完立刻读得到
  const write = (obj) => store.setJSON(String(jobId), { ...obj, at: Date.now() });

  await write({ status: "running" });

  const BASE =
    cleanBase(process.env.MAAS_IMAGE_BASE_URL || "") || cleanBase(process.env.MAAS_BASE_URL || "");
  const KEY =
    (process.env.MAAS_IMAGE_API_KEY || "").trim() || (process.env.MAAS_API_KEY || "").trim();
  if (!BASE || !KEY) {
    await write({ status: "error", error: "服务端未配置 MAAS_BASE_URL / MAAS_API_KEY" });
    return new Response("ok");
  }

  // 分辨率档位 → 像素。豆包全系下限 3686400 像素（2560x1440），所以没有 1K。
  const SIZE_MAP = { "2K": "2048x2048", "4K": "4096x4096" };
  const px = SIZE_MAP[String(size || "").toUpperCase()] || "2048x2048";

  try {
    const r = await fetch(`${BASE}/v1/images/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model,
        prompt,
        size: px,
        response_format: "url",
        watermark: false,
      }),
    });
    const text = await r.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {}
    if (!r.ok) {
      await write({ status: "error", error: `平台返回错误(${r.status}): ${text.slice(0, 300)}` });
      return new Response("ok");
    }
    const raw =
      (data && data.data && data.data[0] && (data.data[0].url || data.data[0].b64_json)) || "";
    if (!raw) {
      await write({ status: "error", error: `未从响应解析到图片: ${text.slice(0, 200)}` });
      return new Response("ok");
    }
    const imageUrl = String(raw).startsWith("http") ? raw : `data:image/png;base64,${raw}`;
    // 转存到 ImgBB 拿永久 URL（火山 URL 24h 过期，转存后参考图/首尾帧/remix 才不会 403）
    const permanentUrl = await rehostToImgbb(imageUrl);
    await write({ status: "done", imageUrl: permanentUrl });
  } catch (e) {
    await write({ status: "error", error: String((e && e.message) || e) });
  }
  return new Response("ok");
};
