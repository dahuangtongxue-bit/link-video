"use client";

import { useRef, useState, useCallback } from "react";
import { Tldraw, type Editor, type TLComponents, createShapeId } from "tldraw";
import "tldraw/tldraw.css";
import { PromptShapeUtil } from "./shapes/PromptShape";
import { ImageShapeUtil } from "./shapes/ImageShape";
import { VideoShapeUtil } from "./shapes/VideoShape";

const customShapeUtils = [PromptShapeUtil, ImageShapeUtil, VideoShapeUtil];

// 收掉右上角的官方主菜单/分享面板，让界面更干净（画布工具栏保留）
const components: TLComponents = {
  MenuPanel: null,
};

export default function Canvas() {
  const editorRef = useRef<Editor | null>(null);
  const [ready, setReady] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const onMount = useCallback((editor: Editor) => {
    editorRef.current = editor;

    // 清扫「孤儿箭头」：两头没有都连着卡片的箭头一律清除
    const sweepOrphanArrows = () => {
      const arrows = editor.getCurrentPageShapes().filter((s) => s.type === "arrow");
      const orphans = arrows.filter(
        (a) => editor.getBindingsFromShape(a.id, "arrow").length < 2
      );
      if (orphans.length) editor.deleteShapes(orphans.map((s) => s.id));
    };

    // 删除任何卡片后，下一拍自动清扫一次。
    // 注：tldraw 删卡时会“先”拆掉箭头绑定、“后”触发删除钩子，
    // 所以不能在删除钩子里按绑定找箭头，而是事后统一清扫。
    let sweepScheduled = false;
    editor.sideEffects.registerAfterDeleteHandler("shape", (shape) => {
      if (shape.type === "arrow") return;
      if (sweepScheduled) return;
      sweepScheduled = true;
      setTimeout(() => {
        sweepScheduled = false;
        sweepOrphanArrows();
      }, 0);
    });

    // 打开画布先清一遍历史遗留
    sweepOrphanArrows();

    setReady(true);
  }, []);

  function centerPoint(editor: Editor) {
    const b = editor.getViewportPageBounds();
    return { x: b.center.x, y: b.center.y };
  }

  function addPromptCard() {
    const editor = editorRef.current;
    if (!editor) return;
    const c = centerPoint(editor);
    const id = createShapeId();
    editor.createShape({
      id,
      type: "prompt-card",
      x: c.x - 150,
      y: c.y - 115,
      props: {},
    });
    editor.select(id);
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const editor = editorRef.current;
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!editor || !file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const c = centerPoint(editor);
      const id = createShapeId();
      editor.createShape({
        id,
        type: "image-card",
        x: c.x - 160,
        y: c.y - 200,
        props: { status: "done", imageUrl: dataUrl, prompt: "(上传)" },
      });
      editor.select(id);
    };
    reader.readAsDataURL(file);
  }

  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column" }}>
      <header
        style={{
          height: 52,
          flexShrink: 0,
          background: "#0f1115",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "0 16px",
          zIndex: 300,
          fontFamily: "system-ui, -apple-system, 'Segoe UI', 'PingFang SC', sans-serif",
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: 0.3 }}>
          AI 画布工作台
        </span>
        <span
          style={{
            fontSize: 11,
            color: "#9ca3af",
            fontFamily: "ui-monospace, Menlo, monospace",
          }}
        >
          文字 → 图片 → 视频
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={addPromptCard} disabled={!ready} style={barBtn("#6366f1", ready)}>
          + 文本生成图片
        </button>
        <button onClick={() => fileRef.current?.click()} disabled={!ready} style={barBtn("#10b981", ready)}>
          + 上传图片
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={onPickFile}
        />
      </header>

      <div style={{ flex: 1, position: "relative" }}>
        <Tldraw
          persistenceKey="ai-canvas-v1"
          shapeUtils={customShapeUtils}
          components={components}
          onMount={onMount}
        />
      </div>
    </div>
  );
}

function barBtn(color: string, enabled: boolean): React.CSSProperties {
  return {
    appearance: "none",
    border: "none",
    borderRadius: 8,
    padding: "8px 14px",
    fontSize: 13,
    fontWeight: 600,
    color: "#fff",
    background: enabled ? color : "#374151",
    cursor: enabled ? "pointer" : "default",
    fontFamily: "system-ui, -apple-system, sans-serif",
  };
}
