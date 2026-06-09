import type { NextRequest } from "next/server";

export const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || "";

// 共享配置：一个平台 + 一个无限制 key 的情况，填这两个就够。
const BASE = process.env.MAAS_BASE_URL || "";
const KEY = process.env.MAAS_API_KEY || "";

// 文生图：默认用共享的 base+key；除非单独设了 MAAS_IMAGE_* 覆盖。
export const IMAGE_BASE_URL = process.env.MAAS_IMAGE_BASE_URL || BASE;
export const IMAGE_API_KEY = process.env.MAAS_IMAGE_API_KEY || KEY;

// 图生视频：默认也用共享的；只有当视频在「另一个平台 / 另一个 key」时才设 MAAS_VIDEO_*。
export const VIDEO_BASE_URL = process.env.MAAS_VIDEO_BASE_URL || BASE;
export const VIDEO_API_KEY = process.env.MAAS_VIDEO_API_KEY || KEY;

// 各自独立判断是否走 mock：没配齐就走 mock，互不影响。
export const imageIsMock = !IMAGE_BASE_URL || !IMAGE_API_KEY;
export const videoIsMock = !VIDEO_BASE_URL || !VIDEO_API_KEY;

export function checkAuth(req: NextRequest): boolean {
  if (!ACCESS_PASSWORD) return true;
  return req.headers.get("x-access-key") === ACCESS_PASSWORD;
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
