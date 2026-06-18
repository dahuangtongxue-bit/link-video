"use client";

import { useEffect, useState } from "react";
import { useEditor } from "tldraw";

// 选中卡片时，在卡片顶部上方浮现一排操作按钮（复制 / 置顶 / 删除）。
// 不选中时不显示。
// 用轻量轮询读取选中/相机状态（最稳，不依赖特定响应式 API）。
// InFrontOfTheCanvas 处于屏幕坐标系，所以用相机把页面坐标换算成屏幕坐标。

const OUR_TYPES = new Set(["prompt-card", "image-card", "video-card"]);

type Box = { left: number; top: number };

export default function SelectionToolbar() {
  const editor = useEditor();
  const [pos, setPos] = useState<Box | null>(null);
  const [shapeId, setShapeId] = useState<string | null>(null);

  useEffect(() => {
    if (!editor) return;
    let raf = 0;
    const tick = () => {
      const selected = editor.getSelectedShapes();
      if (selected.length === 1 && OUR_TYPES.has((selected[0] as any).type)) {
        const sh = selected[0] as any;
        const b = editor.getShapePageBounds(sh.id);
        if (b) {
          const cam = editor.getCamera();
          const z = cam.z;
          setPos({
            left: (b.x + b.w / 2 - cam.x) * z,
            top: (b.y - cam.y) * z,
          });
          setShapeId(sh.id as string);
          raf = requestAnimationFrame(tick);
          return;
        }
      }
      setPos(null);
      setShapeId(null);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [editor]);

  if (!pos || !shapeId) return null;

  const dup = () => editor.duplicateShapes([shapeId as any], { x: 40, y: 40 });
  const toFront = () => editor.bringToFront([shapeId as any]);
  const del = () => editor.deleteShapes([shapeId as any]);

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
        color: danger ? "#ef4444" : "#e5e7eb",
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
        left: pos.left,
        top: pos.top,
        transform: "translate(-50%, calc(-100% - 10px))",
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
        zIndex: 400,
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
