import { getStore } from "@netlify/blobs";

const STORE = "image-jobs";

function cleanBase(b) {
  let s = (b || "").trim().replace(/\/+$/, "");
  s = s.replace(/\/v1$/, "");
  return s;
}

// 把图片（火山临时 URL 或 base64）转存到 ImgBB，拿永久公网 URL。
// 火山 TOS 的签名 URL 24 小时过期，转存后永不过期，后续参考图/首尾帧/remix 才不会 403。
// 返回 { url, diag }：url 是转存后地址（失败则原图），diag 是诊断信息（写进 blob 方便排查）。
async function rehostToImgbb(imageUrlOrB64) {
  const KEY = (process.env.IMGBB_API_KEY || "").trim();
  if (!KEY) return { url: imageUrlOrB64, diag: "no_key" };
  try {
    // 1) 统一拿到纯 base64：
    //    - 如果是 data: base64，去掉前缀；
    //    - 如果是 http URL（火山签名 URL），先下载成 base64（不让 ImgBB 自己去拉，避免防盗链/签名拒绝）。
    let base64 = "";
    const m = /^data:image\/[^;]+;base64,(.+)$/.exec(imageUrlOrB64 || "");
    if (m) {
      base64 = m[1];
    } else if (/^https?:\/\//.test(imageUrlOrB64 || "")) {
      const imgResp = await fetch(imageUrlOrB64);
      if (!imgResp.ok) {
        return { url: imageUrlOrB64, diag: `fetch_src_failed_${imgResp.status}` };
      }
      const buf = await imgResp.arrayBuffer();
      base64 = Buffer.from(buf).toString("base64");
    } else {
      return { url: imageUrlOrB64, diag: "unknown_input" };
    }

    if (!base64) return { url: imageUrlOrB64, diag: "empty_base64" };

    // 2) 传 ImgBB（纯 base64）
    const form = new URLSearchParams();
    form.append("image", base64);
    const resp = await fetch(`https://api.imgbb.com/1/upload?key=${KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const txt = await resp.text();
    let j = null;
    try {
      j = JSON.parse(txt);
    } catch {}
    const permanent = j && j.data && (j.data.url || j.data.display_url);
    if (resp.ok && permanent) {
      return { url: permanent, diag: "ok" };
    }
    // 失败：把 ImgBB 返回的状态和前 200 字记下来
    return {
      url: imageUrlOrB64,
      diag: `imgbb_${resp.status}: ${txt.slice(0, 200)}`,
    };
  } catch (e) {
    return { url: imageUrlOrB64, diag: `exception: ${String((e && e.message) || e)}` };
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
    const { url: permanentUrl, diag } = await rehostToImgbb(imageUrl);
    await write({ status: "done", imageUrl: permanentUrl, rehostDiag: diag });
  } catch (e) {
    await write({ status: "error", error: String((e && e.message) || e) });
  }
  return new Response("ok");
};
