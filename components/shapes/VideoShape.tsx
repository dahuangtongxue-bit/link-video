"use client";

import { useEffect, useState } from "react";
import { BaseBoxShapeUtil, HTMLContainer, T, useEditor, createShapePropsMigrationIds, createShapePropsMigrationSequence } from "tldraw";
import type { VideoShape } from "@/lib/types";
import { pollVideoUntilDone, submitVideo, optimizePrompt } from "@/lib/maas";
import { VIDEO_MODELS } from "@/lib/models";
import { connectShapes } from "@/lib/connect";
import { TOKENS, cardShell, labelStyle, nameInputStyle, primaryBtn, selectStyle, textAreaStyle } from "./cardStyles";

const RESOLUTIONS = [
  { v: "480p", label: "480P" },
  { v: "720p", label: "720P" },
  { v: "1080p", label: "1080P" },
];
const DURATIONS = ["3", "4", "5", "6", "7", "8", "9", "10"].map((v) => ({
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

// 旧画布数据升级：给已存在的视频卡补上 ratio 字段，避免清空画布
const videoCardVersions = createShapePropsMigrationIds("video-card", {
  AddRatio: 1,
  AddRefAndSrcVideo: 2,
  AddName: 3,
});
const videoCardMigrations = createShapePropsMigrationSequence({
  sequence: [
    {
      id: videoCardVersions.AddRatio,
      up(props: any) {
        props.ratio = "adaptive";
      },
      down(props: any) {
        delete props.ratio;
      },
    },
    {
      // 给旧视频卡补上参考图 / 源视频字段，避免清空画布
      id: videoCardVersions.AddRefAndSrcVideo,
      up(props: any) {
        props.referenceImageUrl = "";
        props.sourceVideoUrl = "";
      },
      down(props: any) {
        delete props.referenceImageUrl;
        delete props.sourceVideoUrl;
      },
    },
    {
      id: videoCardVersions.AddName,
      up(props: any) {
        props.name = "";
      },
      down(props: any) {
        delete props.name;
      },
    },
  ],
});

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
    prompt, firstImageUrl, lastImageUrl, referenceImageUrl, sourceVideoUrl,
    resolution, duration, ratio,
   name } = shape.props;
  const shapeId = shape.id;
  const [busy, setBusy] = useState(false);
  const [optBusy, setOptBusy] = useState(false);

  async function handleOptimize() {
    const text = (prompt || "").trim();
    if (!text || optBusy) return;
    setOptBusy(true);
    try {
      const better = await optimizePrompt(text, "video");
      if (editor.getShape(shapeId)) update({ prompt: better });
    } catch (e: any) {
      window.alert("优化失败：" + String(e?.message || e));
    } finally {
      setOptBusy(false);
    }
  }
  const [picking, setPicking] = useState<null | "first" | "last" | "ref" | "srcvideo">(null);
  // 当前编辑模式：frames(首尾帧) / ref(参考图) / srcvideo(源视频续编)。
  // 初值按已有数据推断，之后用户可手动切；切换时清掉其它模式的输入，保证互斥
  const [mode, setMode] = useState<"frames" | "ref" | "srcvideo">(
    sourceVideoUrl ? "srcvideo" : referenceImageUrl ? "ref" : "frames"
  );

  function switchMode(next: "frames" | "ref" | "srcvideo") {
    if (next === mode) return;
    setPicking(null);
    // 清掉非当前模式的输入（含拆掉首尾帧箭头），避免违反混用规则
    if (firstImageUrl) disconnectFrameByUrl(firstImageUrl, firstImageUrl === lastImageUrl);
    if (lastImageUrl) disconnectFrameByUrl(lastImageUrl, lastImageUrl === firstImageUrl);
    update({ firstImageUrl: "", lastImageUrl: "", referenceImageUrl: "", sourceVideoUrl: "" });
    setMode(next);
  }

  function update(props: Partial<VideoShape["props"]>) {
    editor.updateShape<VideoShape>({ id: shapeId, type: "video-card", props });
  }

  // 选图槽（首/尾/参考）扫画布上已出图的图片卡；选源视频槽扫已出片的视频卡
  const pickingImage = picking === "first" || picking === "last" || picking === "ref";
  const canvasImages = pickingImage
    ? editor
        .getCurrentPageShapes()
        .filter(
          (sh: any) =>
            sh.type === "image-card" && sh.props?.status === "done" && sh.props?.imageUrl
        )
        .map((sh: any) => ({ id: sh.id as string, url: sh.props.imageUrl as string }))
    : [];
  const canvasVideos =
    picking === "srcvideo"
      ? editor
          .getCurrentPageShapes()
          .filter(
            (sh: any) =>
              sh.type === "video-card" &&
              sh.props?.status === "done" &&
              sh.props?.videoUrl &&
              sh.id !== shapeId
          )
          .map((sh: any) => ({ id: sh.id as string, url: sh.props.videoUrl as string }))
      : [];

  // config 态点「生成视频」：提交后状态机和图生视频完全同一条管线（轮询防御全部复用）
  // 当前处于哪种模式：源视频 > 参考图 > 首尾帧（互斥，UI 也会互斥）
  const hasInput = !!(firstImageUrl || referenceImageUrl || sourceVideoUrl);

  async function startGenerate() {
    if (busy || !hasInput) return;
    setBusy(true);
    setPicking(null);
    update({ status: "submitting", error: "" });
    try {
      const newTaskId = await submitVideo({
        firstImageUrl: firstImageUrl || undefined,
        lastImageUrl: lastImageUrl || undefined,
        referenceImageUrl: referenceImageUrl || undefined,
        sourceVideoUrl: sourceVideoUrl || undefined,
        prompt: (prompt || "").trim() || "让画面自然地动起来，保持主体稳定、镜头平滑",
        model,
        resolution,
        duration,
        ratio,
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

  // 出片后让整张卡贴合视频真实比例：横屏宽 520、竖屏宽 360，高度按宽高比折算，不留黑边
  function fitToVideo(v: HTMLVideoElement) {
    const vw = v.videoWidth;
    const vh = v.videoHeight;
    if (!vw || !vh) return;
    const LABEL_H = 34; // 顶部标签条占高
    const targetW = vw >= vh ? 520 : 360;
    const targetH = Math.round((vh / vw) * targetW) + LABEL_H;
    if (Math.abs(w - targetW) > 2 || Math.abs(h - targetH) > 2) {
      editor.updateShape<VideoShape>({
        id: shapeId,
        type: "video-card",
        props: { w: targetW, h: targetH },
      });
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
          <div style={{ display: "flex", alignItems: "center" }}>
            <span style={labelStyle}>视频</span>
            <input
              style={nameInputStyle}
              placeholder="未命名"
              value={name}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => update({ name: e.target.value })}
            />
          </div>
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
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                display: "block",
                pointerEvents: "all",
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onLoadedMetadata={(e) => fitToVideo(e.currentTarget)}
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
              <select
                style={{ ...selectStyle, flex: 1 }}
                value={ratio}
                onPointerDown={(e) => e.stopPropagation()}
                onChange={(e) => update({ ratio: e.target.value })}
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
                  cursor: optBusy || !(prompt || "").trim() ? "default" : "pointer",
                  opacity: optBusy || !(prompt || "").trim() ? 0.5 : 1,
                  pointerEvents: "all",
                  flex: "0 0 auto",
                }}
                disabled={optBusy || !(prompt || "").trim()}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={handleOptimize}
              >
                {optBusy ? "优化中…" : "✨ 优化"}
              </button>
            </div>
            {/* 模式切换 */}
            <div style={{ display: "flex", gap: 6 }}>
              {([
                ["frames", "首尾帧"],
                ["ref", "参考图"],
                ["srcvideo", "续/编辑"],
              ] as const).map(([m, label]) => (
                <button
                  key={m}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => switchMode(m)}
                  style={{
                    flex: 1,
                    height: 28,
                    borderRadius: 8,
                    border: `1px solid ${mode === m ? TOKENS.video : TOKENS.border}`,
                    background: mode === m ? TOKENS.video : "#fff",
                    color: mode === m ? "#fff" : "#475569",
                    fontSize: 11,
                    cursor: "pointer",
                    pointerEvents: "all",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* 首尾帧模式 */}
            {mode === "frames" && (
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
            )}

            {/* 参考图模式：真人照片 / 角色一致性 */}
            {mode === "ref" && (
              <div style={{ display: "flex", gap: 8 }}>
                <FrameSlot
                  label="参考图（角色/物体一致性）"
                  url={referenceImageUrl}
                  active={picking === "ref"}
                  onPick={() => setPicking(picking === "ref" ? null : "ref")}
                  onClear={() => update({ referenceImageUrl: "" })}
                />
              </div>
            )}

            {/* 源视频模式：延续 / 编辑画布上已生成的视频 */}
            {mode === "srcvideo" && (
              <div>
                <div style={{ fontSize: 10, color: "#64748b", marginBottom: 4 }}>
                  源视频（从画布上已生成的视频里选）
                </div>
                <div
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => setPicking(picking === "srcvideo" ? null : "srcvideo")}
                  style={{
                    height: 56,
                    borderRadius: 8,
                    cursor: "pointer",
                    border: `2px ${picking === "srcvideo" ? "solid" : "dashed"} ${
                      picking === "srcvideo" ? TOKENS.video : "#cbd5e1"
                    }`,
                    background: "#f8fafc",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    position: "relative",
                    pointerEvents: "all",
                  }}
                >
                  {sourceVideoUrl ? (
                    <>
                      <video
                        src={sourceVideoUrl}
                        muted
                        style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 6 }}
                      />
                      <button
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          update({ sourceVideoUrl: "" });
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
                    <span style={{ fontSize: 11, color: "#94a3b8" }}>点击选择源视频</span>
                  )}
                </div>
              </div>
            )}
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
                {picking === "srcvideo" ? (
                  canvasVideos.length === 0 ? (
                    <span style={{ fontSize: 11, color: "#94a3b8", padding: "16px 8px" }}>
                      画布上还没有已生成的视频——先用首尾帧或图生视频做一个
                    </span>
                  ) : (
                    canvasVideos.map((v) => (
                      <video
                        key={v.id}
                        src={v.url}
                        muted
                        onClick={() => {
                          update({ sourceVideoUrl: v.url });
                          connectFrame(v.id as string);
                          setPicking(null);
                        }}
                        style={{
                          width: 64,
                          height: 48,
                          objectFit: "cover",
                          borderRadius: 6,
                          cursor: "pointer",
                          flex: "0 0 auto",
                          border: `1px solid ${TOKENS.border}`,
                          pointerEvents: "all",
                        }}
                      />
                    ))
                  )
                ) : canvasImages.length === 0 ? (
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
                          connectFrame(img.id as string);
                        } else if (picking === "last") {
                          disconnectFrameByUrl(
                            lastImageUrl,
                            lastImageUrl === firstImageUrl || lastImageUrl === img.url
                          );
                          update({ lastImageUrl: img.url });
                          connectFrame(img.id as string);
                        } else if (picking === "ref") {
                          update({ referenceImageUrl: img.url });
                          connectFrame(img.id as string);
                        }
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
                style={primaryBtn(TOKENS.video, busy || !hasInput)}
                disabled={busy || !hasInput}
                title={!hasInput ? "先选择图片或源视频" : ""}
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
    name: T.string,
    prompt: T.string,
    model: T.string,
    status: T.string,
    taskId: T.string,
    videoUrl: T.string,
    progress: T.number,
    error: T.string,
    firstImageUrl: T.string,
    lastImageUrl: T.string,
    referenceImageUrl: T.string,
    sourceVideoUrl: T.string,
    resolution: T.string,
    duration: T.string,
    ratio: T.string,
  };

  static migrations = videoCardMigrations;

  getDefaultProps(): VideoShape["props"] {
    return {
      name: "",
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
      referenceImageUrl: "",
      sourceVideoUrl: "",
      resolution: "720p",
      duration: "5",
      ratio: "adaptive",
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
