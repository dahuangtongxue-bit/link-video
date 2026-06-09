import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI 画布工作台",
  description: "文字 → 图片 → 视频，自用 AI 生成画布",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
