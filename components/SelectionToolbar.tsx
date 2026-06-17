"use client";

import { useEffect, useState } from "react";
import { useEditor } from "tldraw";

// 选中卡片时，在卡片顶部上方浮现一排操作按钮（复制 / 置顶 / 删除）。
// 不选中时不显示，保持画面干净。只在选中「单个」我们的卡片时出现。
// 放在 InFrontOfTheCanvas 中：处于画布坐标系，按页面坐标定位，会自动跟随平移/缩放。

const OUR_TYPES = new Set(["prompt-card", "image-card", "video-card"]);

export default function SelectionToolbar() {
  const editor = useEditor();
  const [tick, setTick] = useState(0);

  // 任何 document/相机/选中变化都重渲染，保证浮条位置实时跟随
  useEffect(() => {
    const rerender = () => setTick((n) => (n + 1) % 1_000_000);
    const unsub = editor.store.listen(rerender, { source: "all", scope: "all" });
    return () => unsub();
  }, [editor]);
  void tick;

  const selected = editor.getSelectedShapes();
  if (selected.length !== 1) return null;
  const shape = selected[0] as any;
  if (!OUR_TYPES.has(shape.type)) return null;

  const bounds = editor.getShapePageBounds(shape.id);
  if (!bounds) return null;

  const dup = () => editor.duplicateShapes([shape.id], { x: 40, y: 40 });
  const toFront = () => editor.bringToFront([shape.id]);
  const del = () => editor.deleteShapes([shape.id]);

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
        left: bounds.x + bounds.w / 2,
        top: bounds.y,
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
