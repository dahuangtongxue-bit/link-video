"use client";

import { useState } from "react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  useEditor,
  createShapeId,
} from "tldraw";
import type { PromptShape } from "@/lib/types";
import { IMAGE_MODELS, IMAGE_SIZES } from "@/lib/models";
import { generateImage, optimizePrompt } from "@/lib/maas";
import { connectShapes } from "@/lib/connect";
import {
  TOKENS,
  cardShell,
  labelStyle,
  primaryBtn,
  selectStyle,
  textAreaStyle,
} from "./cardStyles";

let spawnSeq = 0; // 并发生成时让新卡逐张错开摆放

function PromptCard({ shape }: { shape: PromptShape }) {
  const editor = useEditor();
  const [busy, setBusy] = useState(false);
  const [optBusy, setOptBusy] = useState(false);

  async function handleOptimize() {
    const text = prompt.trim();
    if (!text || optBusy) return;
    setOptBusy(true);
    try {
      const better = await optimizePrompt(text, "image");
      if (editor.getShape(shape.id)) update({ prompt: better });
    } catch (e: any) {
      window.alert("优化失败：" + String(e?.message || e));
    } finally {
      setOptBusy(false);
    }
  }
  const { prompt, imageModel, size, w, h } = shape.props;

  function update(props: Partial<PromptShape["props"]>) {
    editor.updateShape<PromptShape>({ id: shape.id, type: "prompt-card", props });
  }

  function handleGenerate() {
    const text = prompt.trim();
    if (!text || busy) return;
    // 只锁 2 秒防手抖双击；之后自动放开，可并发再生成（每张卡各自转圈、互不影响）
    setBusy(true);
    window.setTimeout(() => setBusy(false), 2000);

    spawnSeq += 1;
    const off = (spawnSeq % 5) * 56; // 并发的新卡逐张错开，避免完全叠在一起
    const id = createShapeId();
    editor.createShape({
      id,
      type: "image-card",
      x: shape.x + w + 80 + off,
      y: shape.y + off,
      props: { status: "generating", prompt: text, model: imageModel },
    });
    connectShapes(editor, shape.id, id);
    editor.select(id);

    (async () => {
      try {
        const url = await generateImage(text, imageModel, size);
        if (editor.getShape(id)) {
          editor.updateShape({ id, type: "image-card", props: { status: "done", imageUrl: url } });
        }
      } catch (e: any) {
        if (editor.getShape(id)) {
          editor.updateShape({
            id,
            type: "image-card",
            props: { status: "error", error: String(e?.message || e) },
          });
        }
      }
    })();
  }

  return (
    <HTMLContainer>
      <div style={{ ...cardShell(TOKENS.prompt, w, h), padding: 12, gap: 8 }}>
        <span style={labelStyle}>提示词 · 文生图</span>
        <textarea
          style={{ ...textAreaStyle, flex: 1 }}
          placeholder="描述你想要的画面…"
          value={prompt}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => update({ prompt: e.target.value })}
        />
        <button
          style={{
            height: 28,
            borderRadius: 8,
            border: "1px solid " + TOKENS.border,
            background: "#fff",
            color: "#475569",
            fontSize: 11,
            cursor: optBusy || !prompt.trim() ? "default" : "pointer",
            opacity: optBusy || !prompt.trim() ? 0.5 : 1,
            pointerEvents: "all",
          }}
          disabled={optBusy || !prompt.trim()}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={handleOptimize}
        >
          {optBusy ? "优化中…" : "✨ 优化提示词"}
        </button>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select
            style={{ ...selectStyle, flex: 1 }}
            value={imageModel}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => update({ imageModel: e.target.value })}
          >
            {IMAGE_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <select
            style={{ ...selectStyle, width: 72 }}
            title="生成分辨率（以平台支持为准）"
            value={size}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => update({ size: e.target.value })}
          >
            {IMAGE_SIZES.map((sz) => (
              <option key={sz.id} value={sz.id}>
                {sz.label}
              </option>
            ))}
          </select>
        </div>
        <button
          style={{ ...primaryBtn(TOKENS.prompt, busy || !prompt.trim()), width: "100%" }}
          disabled={busy || !prompt.trim()}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={handleGenerate}
        >
          {busy ? "生成中…" : "生成图片"}
        </button>
      </div>
    </HTMLContainer>
  );
}

export class PromptShapeUtil extends BaseBoxShapeUtil<PromptShape> {
  static override type = "prompt-card" as const;
  static override props = {
    w: T.number,
    h: T.number,
    prompt: T.string,
    imageModel: T.string,
    size: T.string,
  };

  getDefaultProps(): PromptShape["props"] {
    return {
      w: 300,
      h: 304,
      prompt: "",
      imageModel: IMAGE_MODELS[0]?.id ?? "",
      size: "2K",
    };
  }

  override canResize() {
    return false;
  }
  override canEdit() {
    return false;
  }

  component(shape: PromptShape) {
    return <PromptCard shape={shape} />;
  }

  indicator(shape: PromptShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={12} ry={12} />;
  }
}
