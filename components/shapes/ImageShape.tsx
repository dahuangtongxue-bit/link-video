"use client";

import { useState } from "react";
import { BaseBoxShapeUtil, HTMLContainer, T, useEditor, createShapeId } from "tldraw";
import type { ImageShape } from "@/lib/types";
import { VIDEO_MODELS } from "@/lib/models";
import { submitVideo } from "@/lib/maas";
import { connectShapes } from "@/lib/connect";
import { TOKENS, cardShell, labelStyle, primaryBtn, selectStyle } from "./cardStyles";

const RESOLUTIONS = [
  { v: "480p", label: "480P" },
  { v: "720p", label: "720P" },
  { v: "1080p", label: "1080P" },
];
const DURATIONS = [
  { v: "5", label: "5 秒" },
  { v: "10", label: "10 秒" },
];

function ImageCard({ shape }: { shape: ImageShape }) {
  const editor = useEditor();
  const [busy, setBusy] = useState(false);
  const {
    status, imageUrl, error, videoModel, motion, prompt,
    videoResolution, videoDuration, w, h,
  } = shape.props;

  function update(props: Partial<ImageShape["props"]>) {
    editor.updateShape<ImageShape>({ id: shape.id, type: "image-card", props });
  }

  async function handleMakeVideo() {
    if (busy || status !== "done" || !imageUrl) return;
    setBusy(true);
    const motionPrompt = (motion || prompt || "").trim();

    const id = createShapeId();
    editor.createShape({
      id,
      type: "video-card",
      x: shape.x + w + 80,
      y: shape.y,
      props: { status: "submitting", prompt: motionPrompt, model: videoModel },
    });
    connectShapes(editor, shape.id, id);
    editor.select(id);

    try {
      const taskId = await submitVideo({
        imageUrl,
        prompt: motionPrompt,
        model: videoModel,
        resolution: videoResolution,
        duration: videoDuration,
      });
      if (editor.getShape(id)) {
        editor.updateShape({ id, type: "video-card", props: { status: "generating", taskId } });
      }
    } catch (e: any) {
      if (editor.getShape(id)) {
        editor.updateShape({
          id,
          type: "video-card",
          props: { status: "error", error: String(e?.message || e) },
        });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <HTMLContainer>
      <div style={cardShell(TOKENS.image, w, h)}>
        {/* 图片区 */}
        <div
          style={{
            flex: 1,
            background: "#f3f4f6",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
            minHeight: 0,
          }}
        >
          {status === "generating" && (
            <div style={{ textAlign: "center", color: TOKENS.muted }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  margin: "0 auto 8px",
                  border: `3px solid ${TOKENS.border}`,
                  borderTopColor: TOKENS.image,
                  borderRadius: "50%",
                  animation: "ac-spin 0.8s linear infinite",
                }}
              />
              <div style={{ fontSize: 12, fontFamily: TOKENS.mono }}>生成中…</div>
            </div>
          )}
          {status === "error" && (
            <div
              style={{
                padding: 14,
                fontSize: 12,
                lineHeight: 1.5,
                color: TOKENS.error,
                textAlign: "left",
                overflow: "auto",
                maxHeight: "100%",
                pointerEvents: "all",
                wordBreak: "break-all",
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              生成失败：{error}
            </div>
          )}
          {status === "done" && imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt={prompt}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
              draggable={false}
            />
          )}
        </div>

        {/* 控制区：图生视频 */}
        <div
          style={{
            padding: 10,
            borderTop: `1px solid ${TOKENS.border}`,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            background: "#fff",
          }}
        >
          <span style={labelStyle}>图片 · 下一步生成视频</span>
          <input
            type="text"
            placeholder="运动 / 镜头提示（可选）"
            value={motion}
            style={{ ...selectStyle, width: "100%", boxSizing: "border-box", fontFamily: TOKENS.sans }}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => update({ motion: e.target.value })}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <select
              style={{ ...selectStyle, flex: 1 }}
              value={videoResolution}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => update({ videoResolution: e.target.value })}
            >
              {RESOLUTIONS.map((r) => (
                <option key={r.v} value={r.v}>
                  {r.label}
                </option>
              ))}
            </select>
            <select
              style={{ ...selectStyle, flex: 1 }}
              value={videoDuration}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => update({ videoDuration: e.target.value })}
            >
              {DURATIONS.map((d) => (
                <option key={d.v} value={d.v}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select
              style={{ ...selectStyle, flex: 1 }}
              value={videoModel}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => update({ videoModel: e.target.value })}
            >
              {VIDEO_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <button
              style={primaryBtn(TOKENS.video, busy || status !== "done")}
              disabled={busy || status !== "done"}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={handleMakeVideo}
            >
              {busy ? "提交中…" : "生成视频"}
            </button>
          </div>
        </div>
      </div>
    </HTMLContainer>
  );
}

export class ImageShapeUtil extends BaseBoxShapeUtil<ImageShape> {
  static override type = "image-card" as const;
  static override props = {
    w: T.number,
    h: T.number,
    prompt: T.string,
    model: T.string,
    videoModel: T.string,
    motion: T.string,
    videoResolution: T.string,
    videoDuration: T.string,
    status: T.string,
    imageUrl: T.string,
    error: T.string,
  };

  getDefaultProps(): ImageShape["props"] {
    return {
      w: 320,
      h: 450,
      prompt: "",
      model: "",
      videoModel: VIDEO_MODELS[0]?.id ?? "",
      motion: "",
      videoResolution: "720p",
      videoDuration: "5",
      status: "generating",
      imageUrl: "",
      error: "",
    };
  }

  override canResize() {
    return false;
  }
  override canEdit() {
    return false;
  }

  component(shape: ImageShape) {
    return <ImageCard shape={shape} />;
  }

  indicator(shape: ImageShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={12} ry={12} />;
  }
}
