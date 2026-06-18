"use client";

import { useEffect, useState } from "react";
import { useEditor } from "tldraw";

const OUR_TYPES = new Set(["prompt-card", "image-card", "video-card"]);

export default function SelectionToolbar() {
  const editor = useEditor();
  const [state, setState] = useState<{ left: number; top: number; id: string } | null>(null);
  const [dbg, setDbg] = useState("init");

  useEffect(() => {
    if (!editor) {
      setDbg("no editor");
      return;
    }
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
          setDbg(`OK id=${String(sh.id).slice(0, 12)} L=${Math.round(left)} T=${Math.round(top)} z=${z.toFixed(2)}`);
        } else {
          setState(null);
          setDbg("no bounds");
        }
      } else {
        setState(null);
        setDbg(`sel=${sel.length} types=${sel.map((s: any) => s.type).join(",")}`);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [editor]);

  const dup = () => state && editor.duplicateShapes([state.id as any], { x: 40, y: 40 });
  const toFront = () => state && editor.bringToFront([state.id as any]);
  const del = () => state && editor.deleteShapes([state.id as any]);

  const btn = (label: string, onClick: () => void, danger = false) => (
    <button
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{
        height: 30, padding: "0 12px", border: "none", background: "transparent",
        color: danger ? "#fca5a5" : "#e5e7eb", fontSize: 12, fontWeight: 600,
        cursor: "pointer", pointerEvents: "all", whiteSpace: "nowrap",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {label}
    </button>
  );
  const sep = () => <div style={{ width: 1, height: 16, background: "rgba(255,255,255,0.18)" }} />;

  return (
    <>
      {/* 调试块：常驻左上，显示 state 实时情况 */}
      <div style={{
        position: "absolute", left: 20, top: 80, zIndex: 99999,
        background: state ? "green" : "orange", color: "white",
        padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700,
        pointerEvents: "none", fontFamily: "system-ui, sans-serif",
      }}>
        {state ? "条应显示" : "条隐藏"} · {dbg}
      </div>

      {/* 真工具条 */}
      {state && (
        <div style={{
          position: "absolute", left: state.left, top: state.top,
          transform: "translate(-50%, calc(-100% - 12px))",
          display: "flex", alignItems: "center", gap: 2, padding: "0 6px", height: 38,
          borderRadius: 10, background: "rgba(15,17,21,0.92)",
          boxShadow: "0 6px 20px rgba(15,17,21,0.28)", backdropFilter: "blur(8px)",
          pointerEvents: "all", zIndex: 99999, whiteSpace: "nowrap",
        }}>
          {btn("⧉ 复制", dup)}
          {sep()}
          {btn("⬆ 置顶", toFront)}
          {sep()}
          {btn("🗑 删除", del, true)}
        </div>
      )}
    </>
  );
}
