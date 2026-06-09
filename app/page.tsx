"use client";

import dynamic from "next/dynamic";
import Gate from "@/components/Gate";

// tldraw 用到浏览器 API，必须只在客户端渲染
const Canvas = dynamic(() => import("@/components/Canvas"), { ssr: false });

export default function Home() {
  return (
    <Gate>
      <Canvas />
    </Gate>
  );
}
