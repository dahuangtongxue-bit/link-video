"use client";

import { useEffect, useState } from "react";
import { useEditor } from "tldraw";

// 选中单个卡片时，在卡片上方（空间不足则下方）浮现操作条：复制 / 置顶 / 删除。
// rAF 轮询读取选中与坐标；用 editor.pageToScreen 转屏幕坐标（InFrontOfTheCanvas 在屏幕坐标系）。

const OUR_TYPES = new Set(["prompt-card", "image-card", "video-card"]);

export default function SelectionToolbar() {
  const editor = useEditor();
  const [st, setSt] = useState<{ left: number; top: number; bottom: number; id: string } | null>(null);

  useEffect(() => {
    if (!editor) return;
    let raf = 0;
    const tick = () => {
      const sel = editor.getSelectedShapes();
      if (sel.length === 1 && OUR_TYPES.has((sel[0] as any).type)) {
        const sh = sel[0] as any;
        const b = editor.getShapePageBounds(sh.id);
        if (b) {
          const topC = editor.pageToScreen({ x: b.x + b.w / 2, y: b.y });
          const botC = editor.pageToScreen({ x: b.x + b.w / 2, y: b.y + b.h });
          setSt({ left: topC.x, top: topC.y, bottom: botC.y, id: sh.id as string });
          raf = requestAnimationFrame(tick);
          return;
        }
      }
      setSt(null);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [editor]);

  if (!st) return null;

  const dup = () => editor.duplicateShapes([st.id as any], { x: 40, y: 40 });
  const toFront = () => editor.bringToFront([st.id as any]);
  const del = () => editor.deleteShapes([st.id as any]);

  // 上方空间不足（会被顶栏遮挡）则显示在卡片下方
  const showBelow = st.top < 60;
  const posTop = showBelow ? st.bottom + 12 : st.top - 12;
  const yTransform = showBelow ? "0" : "-100%";

  const btnStyle = (danger = false): React.CSSProperties => ({
    height: 30, padding: "0 12px", border: "none", background: "transparent",
    color: danger ? "#fca5a5" : "#e5e7eb", fontSize: 12, fontWeight: 600,
    cursor: "pointer", pointerEvents: "all", whiteSpace: "nowrap", fontFamily: "system-ui, sans-serif",
  });

  return (
    <div
      style={{
        position: "absolute",
        left: st.left,
        top: posTop,
        transform: `translate(-50%, ${yTransform})`,
        display: "flex", alignItems: "center", gap: 2, padding: "0 6px", height: 38,
        borderRadius: 10, background: "rgba(15,17,21,0.92)",
        boxShadow: "0 6px 20px rgba(15,17,21,0.28)", backdropFilter: "blur(8px)",
        pointerEvents: "all", zIndex: 99999, whiteSpace: "nowrap",
      }}
    >
      <button onPointerDown={(e)=>e.stopPropagation()} onClick={(e)=>{e.stopPropagation();dup();}} style={btnStyle()}>⧉ 复制</button>
      <div style={{ width: 1, height: 16, background: "rgba(255,255,255,0.18)" }} />
      <button onPointerDown={(e)=>e.stopPropagation()} onClick={(e)=>{e.stopPropagation();toFront();}} style={btnStyle()}>⬆ 置顶</button>
      <div style={{ width: 1, height: 16, background: "rgba(255,255,255,0.18)" }} />
      <button onPointerDown={(e)=>e.stopPropagation()} onClick={(e)=>{e.stopPropagation();del();}} style={btnStyle(true)}>🗑 删除</button>
    </div>
  );
}
