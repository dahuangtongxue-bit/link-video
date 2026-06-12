"use client";

import { useEffect, useState } from "react";
import { BaseBoxShapeUtil, HTMLContainer, T, useEditor } from "tldraw";
import type { VideoShape } from "@/lib/types";
import { pollVideoUntilDone, submitVideo } from "@/lib/maas";
import { VIDEO_MODELS } from "@/lib/models";
import { connectShapes } from "@/lib/connect";
import { TOKENS, cardShell, labelStyle, primaryBtn, selectStyle, textAreaStyle } from "./cardStyles";

const RESOLUTIONS = [
  { v: "480p", label: "480P" },
  { v: "720p", label: "720P" },
  { v: "1080p", label: "1080P" },
];
const DURATIONS = ["3", "4", "5", "6", "7", "8", "9", "10"].map((v) => ({
  v,
  label: `${v} 秒`,
}));

// 首帧/尾帧选择槽：有图显示缩略图（带 × 清除），无图显示「点击选择」
function FrameSlot({
  label,
  url,
  active,
  onPick,
  onClear,
}: {
  label: string;
  url: string;
  active: boolean;
  onPick: () => void;
  onClear: () => void;
}) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 10, color: "#64748b", marginBottom: 4 }}>{label}</div>
      <div
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onPick}
        style={{
          height: 56,
          borderRadius: 8,
          overflow: "hidden",
          cursor: "pointer",
          border: `2px ${active ? "solid" : "dashed"} ${active ? TOKENS.video : "#cbd5e1"}`,
          background: "#f8fafc",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          pointerEvents: "all",
        }}
      >
        {url ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
              draggable={false}
            />
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onClear();
              }}
              style={{
                position: "absolute",
                top: 2,
                right: 2,
                width: 18,
                height: 18,
                borderRadius: 9,
                border: "none",
                background: "rgba(15,17,21,0.75)",
                color: "#fff",
                fontSize: 11,
                lineHeight: "18px",
                padding: 0,
                cursor: "pointer",
                pointerEvents: "all",
              }}
            >
              ×
            </button>
          </>
        ) : (
          <span style={{ fontSize: 11, color: "#94a3b8" }}>点击选择</span>
        )}
      </div>
    </div>
  );
}

function VideoCard({ shape }: { shape: VideoShape }) {
  const editor = useEditor();
  const {
    status, taskId, videoUrl, progress, error, model, w, h,
    prompt, firstImageUrl, lastImageUrl, resolution, duration,
  } = shape.props;
  const shapeId = shape.id;
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState<null | "first" | "last">(null);

  function update(props: Partial<VideoShape["props"]>) {
    editor.updateShape<VideoShape>({ id: shapeId, type: "video-card", props });
  }

  // 选帧时扫一遍画布上所有可用的图片卡（已出图的）
  const canvasImages = picking
    ? editor
        .getCurrentPageShapes()
        .filter(
          (sh: any) =>
            sh.type === "image-card" && sh.props?.status === "done" && sh.props?.imageUrl
        )
        .map((sh: any) => ({ id: sh.id as string, url: sh.props.imageUrl as string }))
    : [];

  // config 态点「生成视频」：提交后状态机和图生视频完全同一条管线（轮询防御全部复用）
  async function startGenerate() {
    if (busy || !firstImageUrl) return;
    setBusy(true);
    setPicking(null);
    update({ status: "submitting", error: "" });
    try {
      const newTaskId = await submitVideo({
        imageUrl: firstImageUrl,
        lastImageUrl: lastImageUrl || undefined,
        prompt: (prompt || "").trim() || "让画面自然地动起来，保持主体稳定、镜头平滑",
        model,
        resolution,
        duration,
      });
      if (editor.getShape(shapeId)) {
        editor.updateShape<VideoShape>({
          id: shapeId,
          type: "video-card",
          props: { status: "generating", taskId: newTaskId },
        });
      }
    } catch (e: any) {
      if (editor.getShape(shapeId)) {
        // 提交失败回到配置态，错误显示在表单里，参数都还在，改完可直接重试
        editor.updateShape<VideoShape>({
          id: shapeId,
          type: "video-card",
          props: { status: "config", error: String(e?.message || e) },
        });
      }
    } finally {
      setBusy(false);
    }
  }

  // ---- 首尾帧 ↔ 图片卡 的关系箭头 ----
  // 找出「图片卡 srcId → 本视频卡」之间已有的箭头
  function arrowsBetween(srcId: string): string[] {
    const out: string[] = [];
    const bindings = (editor.getBindingsToShape(shapeId, "arrow") as any[]) || [];
    for (const b of bindings) {
      const arrowId = b.fromId;
      const ends = (editor.getBindingsFromShape(arrowId, "arrow") as any[]) || [];
      if (ends.some((x: any) => x.toId === srcId)) out.push(arrowId);
    }
    return out;
  }
  function connectFrame(srcId: string) {
    if (arrowsBetween(srcId).length === 0) {
      connectShapes(editor, srcId as any, shapeId as any);
    }
  }
  // 按图片地址拆箭头；若另一个槽位还在用同一张图则保留
  function disconnectFrameByUrl(url: string, stillUsed: boolean) {
    if (!url || stillUsed) return;
    const candidates = editor
      .getCurrentPageShapes()
      .filter((sh: any) => sh.type === "image-card" && sh.props?.imageUrl === url);
    for (const c of candidates) {
      const ids = arrowsBetween(c.id as string);
      if (ids.length) editor.deleteShapes(ids as any);
    }
  }

  // 轮询：只要卡片处于「生成中」且有任务号，就保证有一个轮询循环在跑。
  // 首次挂载、刷新页面、画布滚回视野（组件重建）都会自动续上；组件卸载时停掉旧循环。
  useEffect(() => {
    if (status !== "generating" || !taskId || videoUrl) return;

    let cancelled = false;
    const shapeExists = () => !!editor.getShape(shapeId);

    (async () => {
      try {
        const url = await pollVideoUntilDone(
          taskId,
          model,
          (p) => {
            if (!cancelled && typeof p === "number" && shapeExists()) {
              editor.updateShape<VideoShape>({
                id: shapeId,
                type: "video-card",
                props: { progress: p },
              });
            }
          },
          () => cancelled
        );
        if (!cancelled && shapeExists()) {
          editor.updateShape<VideoShape>({
            id: shapeId,
            type: "video-card",
            props: { status: "done", videoUrl: url, progress: 100 },
          });
        }
      } catch (e: any) {
        const msg = String(e?.message || e);
        if (msg === "已取消") return; // 卸载/删除导致的正常停止，不写状态
        if (!cancelled && shapeExists()) {
          editor.updateShape<VideoShape>({
            id: shapeId,
            type: "video-card",
            props: { status: "error", error: msg },
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, taskId, videoUrl]);

  // 看门狗：卡片停留在「提交任务…」超过 30 秒（多半是提交时被刷新打断），给出明确提示
  useEffect(() => {
    if (status !== "submitting") return;
    const timer = setTimeout(() => {
      const s = editor.getShape(shapeId) as VideoShape | undefined;
      if (s && s.props.status === "submitting") {
        editor.updateShape<VideoShape>({
          id: shapeId,
          type: "video-card",
          props: { status: "error", error: "提交未完成（可能被刷新打断），请删除后重新生成" },
        });
      }
    }, 30000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  return (
    <HTMLContainer>
      <div style={cardShell(TOKENS.video, w, h)}>
        <div style={{ padding: "10px 12px 0" }}>
          <span style={labelStyle}>{status === "config" ? "视频 · 生成视频" : "视频 · 图生视频"}</span>
        </div>
        <div
          style={{
            flex: 1,
            margin: 10,
            borderRadius: 8,
            overflow: "hidden",
            background: "#0f1115",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 0,
          }}
        >
          {status === "config" && (
            <div style={{ fontSize: 12, color: "#64748b", fontFamily: TOKENS.mono }}>
              视频将在这里生成
            </div>
          )}
          {(status === "submitting" || status === "generating") && (
            <div style={{ textAlign: "center", color: "#cbd5e1", width: "80%" }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  margin: "0 auto 10px",
                  border: "3px solid rgba(255,255,255,0.18)",
                  borderTopColor: TOKENS.video,
                  borderRadius: "50%",
                  animation: "ac-spin 0.8s linear infinite",
                }}
              />
              <div style={{ fontSize: 12, fontFamily: TOKENS.mono }}>
                {status === "submitting" ? "提交任务…" : `生成中 ${progress || 0}%`}
              </div>
              {status === "generating" && (
                <div
                  style={{
                    marginTop: 8,
                    height: 4,
                    borderRadius: 999,
                    background: "rgba(255,255,255,0.15)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${progress || 0}%`,
                      background: TOKENS.video,
                      transition: "width 0.4s ease",
                    }}
                  />
                </div>
              )}
            </div>
          )}
          {status === "error" && (
            <div style={{ padding: 16, fontSize: 12, color: "#fca5a5", textAlign: "center" }}>
              <div>生成失败：{error}</div>
              {taskId ? (
                <button
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    // 只是继续查询已有任务，不会重新提交、不会重新扣费
                    editor.updateShape<VideoShape>({
                      id: shapeId,
                      type: "video-card",
                      props: { status: "generating", error: "" },
                    });
                  }}
                  style={{
                    marginTop: 10,
                    appearance: "none",
                    border: "none",
                    borderRadius: 6,
                    padding: "6px 12px",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#fff",
                    background: TOKENS.video,
                    cursor: "pointer",
                    pointerEvents: "all",
                  }}
                >
                  重试查询（不重新扣费）
                </button>
              ) : null}
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => {
                  const url = window.prompt(
                    "粘贴视频地址（mp4 链接）：\n可在零克云控制台 → 任务日志 → 任务记录 JSON 的 fail_reason 字段复制"
                  );
                  if (!url) return;
                  const v = url.trim();
                  if (!/^https?:\/\//i.test(v)) {
                    window.alert("这不是有效链接（需以 http(s):// 开头）");
                    return;
                  }
                  editor.updateShape<VideoShape>({
                    id: shapeId,
                    type: "video-card",
                    props: { status: "done", videoUrl: v, progress: 100, error: "" },
                  });
                }}
                style={{
                  marginTop: 8,
                  appearance: "none",
                  border: "none",
                  borderRadius: 6,
                  padding: "6px 12px",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#e2e8f0",
                  background: "#475569",
                  cursor: "pointer",
                  pointerEvents: "all",
                }}
              >
                粘贴视频地址
              </button>
            </div>
          )}
          {status === "done" && videoUrl && (
            <video
              src={videoUrl}
              controls
              loop
              playsInline
              style={{ width: "100%", height: "100%", objectFit: "contain", pointerEvents: "all" }}
              onPointerDown={(e) => e.stopPropagation()}
            />
          )}
        </div>

        {/* 配置面板：仅 config 态显示；提交后整张卡变成播放器 */}
        {status === "config" && (
          <div
            style={{
              padding: "0 10px 10px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <textarea
              placeholder="描述画面如何运动、镜头如何走、节奏快慢…（不填则用默认提示词）"
              value={prompt}
              style={{ ...textAreaStyle, minHeight: 92, flex: "0 0 auto" }}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => update({ prompt: e.target.value })}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <FrameSlot
                label="首帧（必选）"
                url={firstImageUrl}
                active={picking === "first"}
                onPick={() => setPicking(picking === "first" ? null : "first")}
                onClear={() => {
                  disconnectFrameByUrl(firstImageUrl, firstImageUrl === lastImageUrl);
                  update({ firstImageUrl: "" });
                }}
              />
              <FrameSlot
                label="尾帧（可选）"
                url={lastImageUrl}
                active={picking === "last"}
                onPick={() => setPicking(picking === "last" ? null : "last")}
                onClear={() => {
                  disconnectFrameByUrl(lastImageUrl, lastImageUrl === firstImageUrl);
                  update({ lastImageUrl: "" });
                }}
              />
            </div>
            {picking && (
              <div
                onPointerDown={(e) => e.stopPropagation()}
                style={{
                  border: `1px solid ${TOKENS.border}`,
                  borderRadius: 8,
                  background: "#fff",
                  padding: 6,
                  display: "flex",
                  gap: 6,
                  overflowX: "auto",
                  pointerEvents: "all",
                }}
              >
                {canvasImages.length === 0 ? (
                  <span style={{ fontSize: 11, color: "#94a3b8", padding: "16px 8px" }}>
                    画布上还没有可用图片——先用「文生图」或「上传图片」弄一张
                  </span>
                ) : (
                  canvasImages.map((img) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={img.id}
                      src={img.url}
                      alt=""
                      draggable={false}
                      onClick={() => {
                        if (picking === "first") {
                          disconnectFrameByUrl(
                            firstImageUrl,
                            firstImageUrl === lastImageUrl || firstImageUrl === img.url
                          );
                          update({ firstImageUrl: img.url });
                        } else {
                          disconnectFrameByUrl(
                            lastImageUrl,
                            lastImageUrl === firstImageUrl || lastImageUrl === img.url
                          );
                          update({ lastImageUrl: img.url });
                        }
                        connectFrame(img.id as string);
                        setPicking(null);
                      }}
                      style={{
                        width: 48,
                        height: 48,
                        objectFit: "cover",
                        borderRadius: 6,
                        cursor: "pointer",
                        flex: "0 0 auto",
                        border: `1px solid ${TOKENS.border}`,
                      }}
                    />
                  ))
                )}
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <select
                style={{ ...selectStyle, flex: 1 }}
                value={resolution}
                onPointerDown={(e) => e.stopPropagation()}
                onChange={(e) => update({ resolution: e.target.value })}
              >
                {RESOLUTIONS.map((r) => (
                  <option key={r.v} value={r.v}>
                    {r.label}
                  </option>
                ))}
              </select>
              <select
                style={{ ...selectStyle, flex: 1 }}
                value={duration}
                onPointerDown={(e) => e.stopPropagation()}
                onChange={(e) => update({ duration: e.target.value })}
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
                value={model}
                onPointerDown={(e) => e.stopPropagation()}
                onChange={(e) => update({ model: e.target.value })}
              >
                {VIDEO_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
              <button
                style={primaryBtn(TOKENS.video, busy || !firstImageUrl)}
                disabled={busy || !firstImageUrl}
                title={!firstImageUrl ? "先选择首帧图片" : ""}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={startGenerate}
              >
                {busy ? "提交中…" : "生成视频"}
              </button>
            </div>
            {error ? (
              <div style={{ fontSize: 11, color: TOKENS.error, lineHeight: 1.4, wordBreak: "break-all" }}>
                提交失败：{error}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </HTMLContainer>
  );
}

export class VideoShapeUtil extends BaseBoxShapeUtil<VideoShape> {
  static override type = "video-card" as const;
  static override props = {
    w: T.number,
    h: T.number,
    prompt: T.string,
    model: T.string,
    status: T.string,
    taskId: T.string,
    videoUrl: T.string,
    progress: T.number,
    error: T.string,
    firstImageUrl: T.string,
    lastImageUrl: T.string,
    resolution: T.string,
    duration: T.string,
  };

  getDefaultProps(): VideoShape["props"] {
    return {
      w: 320,
      h: 300,
      prompt: "",
      model: VIDEO_MODELS[0]?.id ?? "",
      status: "submitting",
      taskId: "",
      videoUrl: "",
      progress: 0,
      error: "",
      firstImageUrl: "",
      lastImageUrl: "",
      resolution: "720p",
      duration: "5",
    };
  }

  override canResize() {
    return false;
  }
  override canEdit() {
    return false;
  }

  component(shape: VideoShape) {
    return <VideoCard shape={shape} />;
  }

  indicator(shape: VideoShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={12} ry={12} />;
  }
}
