"use client";

import { useEffect, useState } from "react";
import { useEditor } from "tldraw";
import {
  Hand,
  MousePointer2,
  Undo2,
  Redo2,
  Maximize,
  Trash2,
  Eraser,
} from "lucide-react";

// 底部居中操作工具栏：选择/手、撤销、重做、适应视图、删除选中、清空画布。
// 创建类操作（文生图/上传/视频）仍在顶部栏，这里只放操作。
// 放在 InFrontOfTheCanvas（屏幕坐标系），固定底部居中。

const OUR_TYPES = new Set(["prompt-card", "image-card", "video-card"]);

export default function BottomToolbar() {
  const editor = useEditor();
  const [tool, setTool] = useState("select");
  const [selCount, setSelCount] = useState(0);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  useEffect(() => {
    if (!editor) return;
    let raf = 0;
    const tick = () => {
      try {
        setTool(editor.getCurrentToolId());
        setSelCount(editor.getSelectedShapes().length);
        setCanUndo(editor.getCanUndo?.() ?? true);
        setCanRedo(editor.getCanRedo?.() ?? true);
      } catch {}
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [editor]);

  const safe = (fn: () => void) => { try { fn(); } catch (e) { console.warn("toolbar action failed", e); } };
  const selectTool = () => safe(() => (editor as any).setCurrentTool("select"));
  const handTool = () => safe(() => (editor as any).setCurrentTool("hand"));
  const undo = () => safe(() => (editor as any).undo());
  const redo = () => safe(() => (editor as any).redo());
  const zoomFit = () => safe(() => (editor as any).zoomToFit({ animation: { duration: 200 } }));
  const delSel = () => {
    const ids = editor.getSelectedShapes().map((s: any) => s.id);
    if (ids.length) editor.deleteShapes(ids as any);
  };
  const clearAll = () => {
    const all = editor
      .getCurrentPageShapes()
      .filter((s: any) => OUR_TYPES.has(s.type))
      .map((s: any) => s.id);
    if (!all.length) return;
    if (window.confirm(`确定清空画布上全部 ${all.length} 个卡片？此操作不可撤销恢复内容。`)) {
      editor.deleteShapes(all as any);
    }
  };

  const ICON = 18;
  const item = (
    key: string,
    label: string,
    Icon: any,
    onClick: () => void,
    opts: { active?: boolean; disabled?: boolean; danger?: boolean } = {}
  ) => {
    const { active, disabled, danger } = opts;
    return (
      <button
        key={key}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (!disabled) onClick();
        }}
        disabled={disabled}
        title={label}
        aria-label={label}
        style={{
          width: 38,
          height: 38,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 9,
          border: "none",
          background: active ? "rgba(99,102,241,0.16)" : "transparent",
          color: disabled
            ? "#cbd5e1"
            : danger
            ? "#ef4444"
            : active
            ? "#6366f1"
            : "#334155",
          cursor: disabled ? "default" : "pointer",
          pointerEvents: "all",
          transition: "background 0.15s, color 0.15s",
        }}
      >
        <Icon size={ICON} strokeWidth={2} />
      </button>
    );
  };

  const sep = (k: string) => (
    <div key={k} style={{ width: 1, height: 22, background: "#e5e7eb", margin: "0 2px" }} />
  );

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        bottom: 20,
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 2,
        padding: "6px 8px",
        borderRadius: 14,
        background: "rgba(255,255,255,0.97)",
        backdropFilter: "blur(10px)",
        border: "1px solid #e5e7eb",
        boxShadow: "0 8px 28px rgba(15,17,21,0.14)",
        pointerEvents: "all",
        zIndex: 500,
        fontFamily: "system-ui, -apple-system, 'PingFang SC', sans-serif",
      }}
    >
      {item("select", "选择", MousePointer2, selectTool, { active: tool === "select" })}
      {item("hand", "移动画布", Hand, handTool, { active: tool === "hand" })}
      {sep("s1")}
      {item("undo", "撤销", Undo2, undo, { disabled: !canUndo })}
      {item("redo", "重做", Redo2, redo, { disabled: !canRedo })}
      {item("fit", "适应视图", Maximize, zoomFit)}
      {sep("s2")}
      {item("del", "删除选中", Trash2, delSel, { disabled: selCount === 0, danger: true })}
      {item("clear", "清空画布", Eraser, clearAll, { danger: true })}
    </div>
  );
}
