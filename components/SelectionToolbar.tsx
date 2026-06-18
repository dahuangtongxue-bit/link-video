"use client";

import { useEffect, useState } from "react";
import { useEditor } from "tldraw";

const OUR_TYPES = new Set(["prompt-card", "image-card", "video-card"]);

export default function SelectionToolbar() {
  const editor = useEditor();
  const [state, setState] = useState<{ left: number; top: number; id: string } | null>(null);
  const [dbg, setDbg] = useState("init");

  useEffect(() => {
    if (!editor) { setDbg("no editor"); return; }
    let raf = 0;
    const tick = () => {
      const sel = editor.getSelectedShapes();
      if (sel.length === 1 && OUR_TYPES.has((sel[0] as any).type)) {
        const sh = sel[0] as any;
        const b = editor.getShapePageBounds(sh.id);
        if (b) {
          const tc = editor.pageToScreen({ x: b.x + b.w / 2, y: b.y });
          setState({ left: tc.x, top: tc.y, id: sh.id as string });
          setDbg(`OK L=${Math.round(tc.x)} T=${Math.round(tc.y)}`);
        } else { setState(null); setDbg("no bounds"); }
      } else { setState(null); setDbg(`sel=${sel.length}`); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [editor]);

  const dup = () => state && editor.duplicateShapes([state.id as any], { x: 40, y: 40 });
  const toFront = () => state && editor.bringToFront([state.id as any]);
  const del = () => state && editor.deleteShapes([state.id as any]);

  const btnStyle = (danger = false): React.CSSProperties => ({
    height: 30, padding: "0 12px", border: "none", background: "transparent",
    color: danger ? "#fca5a5" : "#e5e7eb", fontSize: 12, fontWeight: 600,
    cursor: "pointer", pointerEvents: "all", whiteSpace: "nowrap", fontFamily: "system-ui, sans-serif",
  });

  const bar = (
    <div style={{
      display: "flex", alignItems: "center", gap: 2, padding: "0 6px", height: 38,
      borderRadius: 10, background: "rgba(15,17,21,0.92)",
      boxShadow: "0 6px 20px rgba(15,17,21,0.28)", pointerEvents: "all", whiteSpace: "nowrap",
    }}>
      <button onPointerDown={(e)=>e.stopPropagation()} onClick={(e)=>{e.stopPropagation();dup();}} style={btnStyle()}>⧉ 复制</button>
      <div style={{ width: 1, height: 16, background: "rgba(255,255,255,0.18)" }} />
      <button onPointerDown={(e)=>e.stopPropagation()} onClick={(e)=>{e.stopPropagation();toFront();}} style={btnStyle()}>⬆ 置顶</button>
      <div style={{ width: 1, height: 16, background: "rgba(255,255,255,0.18)" }} />
      <button onPointerDown={(e)=>e.stopPropagation()} onClick={(e)=>{e.stopPropagation();del();}} style={btnStyle(true)}>🗑 删除</button>
    </div>
  );

  return (
    <>
      {/* 调试区：常驻左上。绿块下方直接内联渲染工具条 → 验证 bar 能否渲染（不依赖坐标）*/}
      <div style={{ position: "absolute", left: 20, top: 80, zIndex: 99999, pointerEvents: "all" }}>
        <div style={{
          background: state ? "green" : "orange", color: "white", padding: "6px 12px",
          borderRadius: 8, fontSize: 12, fontWeight: 700, marginBottom: 8,
          fontFamily: "system-ui, sans-serif", display: "inline-block",
        }}>
          {dbg}（下方应有深色条↓）
        </div>
        <div>{bar}</div>
      </div>

      {/* 跟随卡片的工具条 */}
      {state && (
        <div style={{
          position: "absolute", left: state.left, top: state.top,
          transform: "translate(-50%, calc(-100% - 12px))", zIndex: 99999, pointerEvents: "all",
        }}>
          {bar}
        </div>
      )}
    </>
  );
}
