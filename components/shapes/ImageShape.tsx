"use client";

import { useState, useEffect } from "react";
import { BaseBoxShapeUtil, HTMLContainer, T, useEditor, createShapeId, createShapePropsMigrationIds, createShapePropsMigrationSequence } from "tldraw";
import type { ImageShape } from "@/lib/types";
import { VIDEO_MODELS, IMAGE_MODELS, IMAGE_RATIOS } from "@/lib/models";
import { submitVideo, optimizePrompt, describeImage, generateImage } from "@/lib/maas";
import { connectShapes } from "@/lib/connect";
import { TOKENS, cardShell, labelStyle, nameInputStyle, outerNameRowStyle, outerNameInputStyle, primaryBtn, selectStyle, textAreaStyle } from "./cardStyles";

const RESOLUTIONS = [
  { v: "480p", label: "480P" },
  { v: "720p", label: "720P" },
  { v: "1080p", label: "1080P" },
];
const DURATIONS = ["5", "6", "8", "10"].map((v) => ({
  v,
  label: `${v} 秒`,
}));
const RATIOS = [
  { v: "adaptive", label: "自动比例" },
  { v: "16:9", label: "16:9" },
  { v: "9:16", label: "9:16" },
  { v: "1:1", label: "1:1" },
  { v: "4:3", label: "4:3" },
  { v: "3:4", label: "3:4" },
];

// 旧画布数据升级：给已存在的图片卡补上 videoRatio 字段，避免清空画布
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

function ImageCard({ shape }: { shape: ImageShape }) {
  const editor = useEditor();
  const [busy, setBusy] = useState(false);
  const [optBusy, setOptBusy] = useState(false);
  const [revBusy, setRevBusy] = useState(false);
  // 图生图（换比例/重绘）：源图就是本卡，目标比例 + 可选提示词 → 新建一张目标比例的图片卡。
  // 用本地 state，不持久化（属于一次性动作输入），避免给 ImageShape 再加 migration。
  const [i2iOpen, setI2iOpen] = useState(false);
  const [i2iRatio, setI2iRatio] = useState("16:9");
  const [i2iPrompt, setI2iPrompt] = useState("");
  const [i2iBusy, setI2iBusy] = useState(false);
  // 运动提示文本框：默认收起，点击展开（有内容时默认展开）
  const [motionOpen, setMotionOpen] = useState(false);
  // 是否选中本卡：选中才展开下方控制区，平时收起让卡片清爽
  const [selected, setSelected] = useState(false);
  useEffect(() => {
    if (!editor) return;
    let raf = 0;
    const tick = () => {
      try {
        const ids = editor.getSelectedShapeIds?.() ?? editor.getSelectedShapes().map((x: any) => x.id);
        const isSel = ids.includes(shape.id);
        setSelected(isSel);
        // 同步 props.h 给 tldraw 做选框/连线几何（渲染已自适应，不依赖它）
        const cur = editor.getShape(shape.id) as any;
        if (cur && cur.type === "image-card") {
          const wantH = isSel ? cur.props.w + 250 : cur.props.w;
          if (Math.abs((cur.props.h || 0) - wantH) > 2) {
            editor.updateShape({ id: shape.id, type: "image-card", props: { h: wantH } });
          }
        }
      } catch {}
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [editor, shape.id]);

  async function handleOptimize() {
    const text = (motion || "").trim();
    if (!text || optBusy) return;
    setOptBusy(true);
    try {
      const better = await optimizePrompt(text, "video");
      if (editor.getShape(shape.id)) update({ motion: better });
    } catch (e: any) {
      window.alert("优化失败：" + String(e?.message || e));
    } finally {
      setOptBusy(false);
    }
  }
  const {
    status, imageUrl, error, videoModel, motion, prompt,
    videoResolution, videoDuration, videoRatio, w, h,
   name } = shape.props;

  function update(props: Partial<ImageShape["props"]>) {
    editor.updateShape<ImageShape>({ id: shape.id, type: "image-card", props });
  }

  // 反推提示词：把这张图丢给视觉模型反推出文生图提示词，
  // 结果新建一个「文生图」提示词卡填入，方便直接拿去再生图或修改。
  async function reversePrompt() {
    if (revBusy || status !== "done" || !imageUrl) return;
    setRevBusy(true);
    try {
      const text = await describeImage(imageUrl);
      const id = createShapeId();
      editor.createShape({
        id,
        type: "prompt-card",
        // 紧贴原图右侧；向下错开 180，避免和「图生视频」卡（建在正右侧）重叠
        x: shape.x + w + 80,
        y: shape.y + 180,
        props: { prompt: text, name: "反推提示词" },
      });
      editor.select(id);
      editor.zoomToSelection({ animation: { duration: 300 } });
    } catch (e: any) {
      window.alert(`反推失败：${String(e?.message || e)}`);
    } finally {
      if (editor.getShape(shape.id)) setRevBusy(false);
    }
  }

  // 图生图：拿本卡当源图，按目标比例重绘出一张新图片卡（下方生出，自动连线）。
  // 典型用途：上传的 1:1 图 → 重绘成 16:9 → 再图生视频得到 16:9 视频。
  async function handleImg2Img() {
    if (i2iBusy || status !== "done" || !imageUrl) return;
    setI2iBusy(true);
    const text =
      i2iPrompt.trim() ||
      "保持原图的主体、风格与构图，自然扩展画面到新的画面比例，主体不变形、不裁切";
    const model = IMAGE_MODELS[0]?.id ?? "";
    const id = createShapeId();
    editor.createShape({
      id,
      type: "image-card",
      // 生在本卡正下方（图片区高度≈卡宽，留 80 间距）
      x: shape.x,
      y: shape.y + w + 80,
      props: { status: "generating", prompt: text, model },
    });
    connectShapes(editor, shape.id, id);
    editor.select(id);
    (async () => {
      try {
        // size 给 2K 档；ratio 决定形状；imageUrl 作为源图 → 图生图
        const url = await generateImage(text, model, "2K", i2iRatio, imageUrl);
        if (editor.getShape(id)) {
          editor.updateShape({
            id,
            type: "image-card",
            // 新图已是目标比例，顺手把它的「图生视频比例」也设成同值
            props: { status: "done", imageUrl: url, videoRatio: i2iRatio },
          });
        }
      } catch (e: any) {
        if (editor.getShape(id)) {
          editor.updateShape({ id, type: "image-card", props: { status: "error", error: String(e?.message || e) } });
        }
      } finally {
        setI2iBusy(false);
      }
    })();
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
        ratio: videoRatio,
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
        <div style={{ ...cardShell(TOKENS.image, w, h), height: "auto" }}>
        {/* 图片区：固定高度=卡片宽（正方形），不用 flex:1 抢空间，控制区显隐不影响它 */}
        <div
          style={{
            width: "100%",
            height: w,
            flexShrink: 0,
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
              style={{ width: "100%", height: "100%", objectFit: "contain" }}
              draggable={false}
            />
          )}
        </div>

        {/* 控制区：图生视频 —— 仅选中卡片时展开 */}
        {selected && (
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
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span style={labelStyle}>图片</span>
            {status === "done" && imageUrl && (
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  reversePrompt();
                }}
                disabled={revBusy}
                style={{
                  height: 24,
                  padding: "0 10px",
                  borderRadius: 6,
                  border: `1px solid ${TOKENS.image}`,
                  background: revBusy ? "#f1f5f9" : "#fff",
                  color: revBusy ? "#94a3b8" : TOKENS.image,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: revBusy ? "default" : "pointer",
                  pointerEvents: "all",
                }}
                title="用 AI 反推这张图的提示词，生成一个文生图卡片"
              >
                {revBusy ? "反推中…" : "🔍 反推提示词"}
              </button>
            )}
          </div>

          {/* 图生图：换比例 / 重绘 —— 上传/生成的图在这里改成目标比例，再去图生视频 */}
          {status === "done" && imageUrl && (
            <div
              style={{
                border: `1px solid ${TOKENS.border}`,
                borderRadius: 8,
                background: "#f8fafc",
                padding: 8,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setI2iOpen((v) => !v);
                }}
                style={{
                  height: 26,
                  borderRadius: 6,
                  border: "none",
                  background: "transparent",
                  color: TOKENS.image,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  pointerEvents: "all",
                  textAlign: "left",
                  padding: 0,
                }}
                title="把这张图重绘成别的比例（如 1:1 → 16:9），结果生成一张新图片卡"
              >
                🖼 图生图 · 换比例 / 重绘 {i2iOpen ? "▾" : "▸"}
              </button>
              {i2iOpen && (
                <>
                  <textarea
                    placeholder="可选：想保留/改动什么（留空=保留主体与风格，仅扩展到新比例）"
                    value={i2iPrompt}
                    style={{ ...textAreaStyle, minHeight: 56 }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onChange={(e) => setI2iPrompt(e.target.value)}
                  />
                  <div style={{ display: "flex", gap: 8 }}>
                    <select
                      style={{ ...selectStyle, flex: 1 }}
                      value={i2iRatio}
                      title="目标比例 → 决定后续视频比例"
                      onPointerDown={(e) => e.stopPropagation()}
                      onChange={(e) => setI2iRatio(e.target.value)}
                    >
                      {IMAGE_RATIOS.map((r) => (
                        <option key={r.id} value={r.id}>
                          比例 {r.label}
                        </option>
                      ))}
                    </select>
                    <button
                      style={{ ...primaryBtn(TOKENS.image, i2iBusy), flex: "0 0 auto" }}
                      disabled={i2iBusy}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleImg2Img();
                      }}
                    >
                      {i2iBusy ? "重绘中…" : "生成新图 ↓"}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {motionOpen || motion ? (
            <textarea
              placeholder="运动 / 镜头提示（可选）：主体怎么动、镜头怎么走、节奏快慢…"
              value={motion}
              autoFocus={motionOpen && !motion}
              style={{ ...textAreaStyle, minHeight: 92, flex: "0 0 auto" }}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => update({ motion: e.target.value })}
            />
          ) : (
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setMotionOpen(true);
              }}
              style={{
                height: 34,
                borderRadius: 8,
                border: `1px dashed ${TOKENS.border}`,
                background: "#fafafa",
                color: TOKENS.muted,
                fontSize: 12,
                cursor: "text",
                textAlign: "left",
                padding: "0 10px",
                pointerEvents: "all",
                fontFamily: TOKENS.sans,
              }}
            >
              + 添加运动 / 镜头提示（可选）
            </button>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <select
              style={{ ...selectStyle, flex: 1 }}
              value={videoRatio}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => update({ videoRatio: e.target.value })}
            >
              {RATIOS.map((r) => (
                <option key={r.v} value={r.v}>
                  {r.label}
                </option>
              ))}
            </select>
            <button
              style={{
                height: 28,
                padding: "0 10px",
                borderRadius: 8,
                border: "1px solid " + TOKENS.border,
                background: "#fff",
                color: "#475569",
                fontSize: 11,
                cursor: optBusy || !(motion || "").trim() ? "default" : "pointer",
                opacity: optBusy || !(motion || "").trim() ? 0.5 : 1,
                pointerEvents: "all",
                flex: "0 0 auto",
              }}
              disabled={optBusy || !(motion || "").trim()}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={handleOptimize}
            >
              {optBusy ? "优化中…" : "✨ 优化"}
            </button>
          </div>
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
        )}
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
      h: 556,
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
