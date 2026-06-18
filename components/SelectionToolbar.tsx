"use client";

import { useEffect, useState } from "react";
import { useEditor } from "tldraw";

// 选中单个卡片时，在卡片顶部上方浮现操作条（复制 / 置顶 / 删除）；不选中不显示。
// 用 rAF 轮询（已验证可靠）读取选中与相机；InFrontOfTheCanvas 在屏幕坐标系，
// 用相机把页面坐标换算为屏幕坐标。

const OUR_TYPES = new Set(["prompt-card", "image-card", "video-card"]);

export default function SelectionToolbar() {
  const editor = useEditor();
  const [state, setState] = useState<{ left: number; top: number; id: string } | null>(null);

  useEffect(() => {
    if (!editor) return;
    let raf = 0;
    const tick = () => {
      const sel = editor.getSelectedShapes();
      if (sel.length === 1 && OUR_TYPES.has((sel[0] as any).type)) {
        const sh = sel[0] as any;
        const b = editor.getShapePageBounds(sh.id);
        if (b) {
          const cam = editor.getCamera();
          const z = cam.z || 1;
          const left = (b.x + b.w / 2 - cam.x) * z;
          const top = (b.y - cam.y) * z;
          setState({ left, top, id: sh.id as string });
        } else {
          setState(null);
        }
      } else {
        setState(null);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [editor]);

  if (!state) return null;
  const { left, top, id } = state;

  const dup = () => editor.duplicateShapes([id as any], { x: 40, y: 40 });
  const toFront = () => editor.bringToFront([id as any]);
  const del = () => editor.deleteShapes([id as any]);

  const btn = (label: string, onClick: () => void, danger = false) => (
    <button
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{
        height: 30,
        padding: "0 12px",
        border: "none",
        background: "transparent",
        color: danger ? "#fca5a5" : "#e5e7eb",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        pointerEvents: "all",
        whiteSpace: "nowrap",
        fontFamily: "system-ui, -apple-system, 'PingFang SC', sans-serif",
      }}
    >
      {label}
    </button>
  );

  const sep = () => (
    <div style={{ width: 1, height: 16, background: "rgba(255,255,255,0.18)" }} />
  );

  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        transform: "translate(-50%, calc(-100% - 12px))",
        display: "flex",
        alignItems: "center",
        gap: 2,
        padding: "0 6px",
        height: 38,
        borderRadius: 10,
        background: "rgba(15,17,21,0.92)",
        boxShadow: "0 6px 20px rgba(15,17,21,0.28)",
        backdropFilter: "blur(8px)",
        pointerEvents: "all",
        zIndex: 9999,
        whiteSpace: "nowrap",
      }}
    >
      {btn("⧉ 复制", dup)}
      {sep()}
      {btn("⬆ 置顶", toFront)}
      {sep()}
      {btn("🗑 删除", del, true)}
    </div>
  );
}
