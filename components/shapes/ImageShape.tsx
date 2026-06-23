"use client";

import { useState } from "react";
import { BaseBoxShapeUtil, HTMLContainer, T, useEditor, createShapePropsMigrationIds, createShapePropsMigrationSequence } from "tldraw";
import type { ImageShape } from "@/lib/types";
import { VIDEO_MODELS } from "@/lib/models";
import { TOKENS, cardShell, outerNameRowStyle, outerNameInputStyle } from "./cardStyles";

// 旧画布数据升级：给已存在的图片卡补上 videoRatio / name 字段，避免清空画布
const imageCardVersions = createShapePropsMigrationIds("image-card", {
  AddVideoRatio: 1,
  AddName: 2,
});
const imageCardMigrations = createShapePropsMigrationSequence({
  sequence: [
    {
      id: imageCardVersions.AddVideoRatio,
      up(props: any) {
        props.videoRatio = "adaptive";
      },
      down(props: any) {
        delete props.videoRatio;
      },
    },
    {
      id: imageCardVersions.AddName,
      up(props: any) {
        props.name = "";
      },
      down(props: any) {
        delete props.name;
      },
    },
  ],
});

// 图片卡：纯素材。生成/上传的图都只是画布上的一张图，等着被「制作视频」卡选作首尾帧/参考。
// 不带任何生成控制。按图片真实比例显示形状（不再强制方块）。
function ImageCard({ shape }: { shape: ImageShape }) {
  const editor = useEditor();
  const { status, imageUrl, error, prompt, w, h, name } = shape.props;
  // 显示高度：done 后按图片真实宽高比算；未出图时用方形占位
  const [dispH, setDispH] = useState<number>(h && h > 0 && h < w * 4 ? h : w);

  function update(props: Partial<ImageShape["props"]>) {
    editor.updateShape<ImageShape>({ id: shape.id, type: "image-card", props });
  }

  // 图片加载完成 → 按 naturalWidth/Height 定形，并同步 props.h（选框/连线箭头几何）
  function onImgLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget;
    if (!img.naturalWidth || !img.naturalHeight) return;
    const newH = Math.max(40, Math.round((w * img.naturalHeight) / img.naturalWidth));
    if (Math.abs(dispH - newH) > 1) setDispH(newH);
    const cur = editor.getShape(shape.id) as any;
    if (cur && cur.type === "image-card" && Math.abs((cur.props.h || 0) - newH) > 2) {
      update({ h: newH });
    }
  }

  const boxH = status === "done" && imageUrl ? dispH : w;

  return (
    <HTMLContainer>
      <div style={{ position: "relative", width: w, height: "auto", overflow: "visible" }}>
        <div style={outerNameRowStyle}>
          <input
            style={outerNameInputStyle}
            placeholder="图片 · 未命名"
            value={name}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => update({ name: e.target.value })}
          />
        </div>
        <div style={{ ...cardShell(TOKENS.image, w, boxH), height: "auto" }}>
          <div
            style={{
              width: "100%",
              height: boxH,
              background: "#f3f4f6",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              position: "relative",
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
                onLoad={onImgLoad}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                draggable={false}
              />
            )}
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
    name: T.string,
    prompt: T.string,
    model: T.string,
    videoModel: T.string,
    motion: T.string,
    videoResolution: T.string,
    videoDuration: T.string,
    videoRatio: T.string,
    status: T.string,
    imageUrl: T.string,
    error: T.string,
  };

  static migrations = imageCardMigrations;

  getDefaultProps(): ImageShape["props"] {
    return {
      name: "",
      w: 320,
      h: 320,
      prompt: "",
      model: "",
      videoModel: VIDEO_MODELS[0]?.id ?? "",
      motion: "",
      videoResolution: "720p",
      videoDuration: "5",
      videoRatio: "adaptive",
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
