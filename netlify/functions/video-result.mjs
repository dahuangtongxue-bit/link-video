import { getStore } from "@netlify/blobs";

const STORE = "video-jobs";

const json = (obj) =>
  new Response(JSON.stringify(obj), { headers: { "content-type": "application/json" } });

// 普通函数：按 jobId 读后台函数写入的结果。没写入就当作进行中，让前端继续轮询。
export default async (req) => {
  const jobId = new URL(req.url).searchParams.get("jobId") || "";
  if (!jobId) return json({ status: "error", error: "缺少 jobId" });
  try {
    const store = getStore(STORE);
    const data = await store.get(jobId, { type: "json" });
    if (!data) return json({ status: "pending" });
    return json(data);
  } catch (e) {
    return json({ status: "pending" });
  }
};
