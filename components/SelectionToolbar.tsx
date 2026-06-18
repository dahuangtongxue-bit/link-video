"use client";

import { useEffect, useState } from "react";
import { useEditor } from "tldraw";

// ===== 临时探针版：用于定位「为什么悬浮条不显示」=====
// 1) 屏幕左上角无条件显示一个红色「TOOLBAR LOADED」块 → 证明组件挂载成功
// 2) 选中卡片时，右侧追加显示选中信息 → 证明选中检测有效
// 定位完成后会改回正式版。

const OUR_TYPES = new Set(["prompt-card", "image-card", "video-card"]);

export default function SelectionToolbar() {
  const editor = useEditor();
  const [info, setInfo] = useState("no editor");

  useEffect(() => {
    if (!editor) {
      setInfo("editor is null");
      return;
    }
    let raf = 0;
    const tick = () => {
      const sel = editor.getSelectedShapes();
      if (sel.length === 0) {
        setInfo("选中:0");
      } else {
        const types = sel.map((s: any) => s.type).join(",");
        setInfo(`选中:${sel.length} 类型:${types}`);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [editor]);

  // 无条件显示探针
  return (
    <div
      style={{
        position: "absolute",
        left: 20,
        top: 80,
        zIndex: 9999,
        background: "red",
        color: "white",
        padding: "8px 14px",
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 700,
        pointerEvents: "none",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      TOOLBAR LOADED · {info}
    </div>
  );
}
