"use client";

import { useEffect, useState } from "react";
import { BaseBoxShapeUtil, HTMLContainer, T, useEditor, createShapeId, createShapePropsMigrationIds, createShapePropsMigrationSequence } from "tldraw";
import type { VideoShape } from "@/lib/types";
import { pollVideoUntilDone, submitVideo, optimizePrompt, uploadAsset } from "@/lib/maas";
import { VIDEO_MODELS } from "@/lib/models";
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

// 旧画布数据升级：给已存在的视频卡补上 ratio 字段，避免清空画布
const videoCardVersions = createShapePropsMigrationIds("video-card", {
  AddRatio: 1,
  AddRefAndSrcVideo: 2,
  AddName: 3,
  AddRefArray: 4,
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
    {
      // 多参考图：把旧的单张 referenceImageUrl 迁进数组 referenceImageUrls
      id: videoCardVersions.AddRefArray,
      up(props: any) {
        props.referenceImageUrls = props.referenceImageUrl ? [props.referenceImageUrl] : [];
      },
      down(props: any) {
        delete props.referenceImageUrls;
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

// 提交前把 base64 图再压一道（长边 1024、JPEG 0.6），避免两张首尾帧 base64 撑爆
// Netlify 请求体上限导致 504。只压 data URL；http/asset 引用原样返回。
async function shrinkDataUrl(url: string): Promise<string> {
  if (!url || !url.startsWith("data:")) return url;
  try {
    const img = document.createElement("img");
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("图片解码失败"));
      img.src = url;
    });
    const maxEdge = 1024;
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return url;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.6);
  } catch {
    return url; // 压缩失败就用原图（可能还是会 504，但不至于直接崩）
  }
}

function VideoCard({ shape }: { shape: VideoShape }) {
  const editor = useEditor();
  const {
    status, taskId, videoUrl, progress, error, model, w, h,
    prompt, firstImageUrl, lastImageUrl, referenceImageUrl, referenceImageUrls, sourceVideoUrl,
    resolution, duration, ratio,
   name } = shape.props;
  const shapeId = shape.id;
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false); // done 视频右下角"更多"菜单
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
    sourceVideoUrl ? "srcvideo" : (referenceImageUrl || (referenceImageUrls && referenceImageUrls.length)) ? "ref" : "frames"
  );

  function switchMode(next: "frames" | "ref" | "srcvideo") {
    if (next === mode) return;
    setPicking(null);
    // 清掉非当前模式的输入（含拆掉首尾帧箭头），避免违反混用规则
    if (firstImageUrl) disconnectFrameByUrl(firstImageUrl, firstImageUrl === lastImageUrl);
    if (lastImageUrl) disconnectFrameByUrl(lastImageUrl, lastImageUrl === firstImageUrl);
    update({ firstImageUrl: "", lastImageUrl: "", referenceImageUrl: "", referenceImageUrls: [], sourceVideoUrl: "" });
    setMode(next);
  }

  function update(props: Partial<VideoShape["props"]>) {
    editor.updateShape<VideoShape>({ id: shapeId, type: "video-card", props });
  }

  // 多参考图列表（兼容旧单字段 referenceImageUrl）
  const refList: string[] =
    (referenceImageUrls && referenceImageUrls.length
      ? referenceImageUrls
      : referenceImageUrl
      ? [referenceImageUrl]
      : []) as string[];
  const MAX_REF = 9;
  function addRef(url: string) {
    if (!url) return;
    if (refList.includes(url)) return;
    if (refList.length >= MAX_REF) return;
    update({ referenceImageUrls: [...refList, url], referenceImageUrl: "" });
  }
  function removeRef(url: string) {
    update({ referenceImageUrls: refList.filter((u) => u !== url), referenceImageUrl: "" });
  }

  // 选图槽（首/尾/参考）扫画布上已出图的图片卡；选源视频槽扫已出片的视频卡
  const pickingImage = picking === "first" || picking === "last" || picking === "ref";
  const canvasImages = pickingImage
    ? editor
        .getCurrentPageShapes()
        .filter(
          (sh: any) =>
            sh.type === "image-card" &&
            sh.props?.status === "done" &&
            sh.props?.imageUrl &&
            // 参考图只能用有公网地址的图（生成图 http://），上传图(data:)平台不认，过滤掉
            (picking !== "ref" || String(sh.props.imageUrl).startsWith("http"))
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
  const hasInput = !!(firstImageUrl || refList.length || sourceVideoUrl);

  async function startGenerate() {
    if (busy || !hasInput) return;
    setBusy(true);
    setPicking(null);
    update({ status: "submitting", error: "" });
    try {
      // 参考图必须先入素材库换成 asset://（零克云只认这种形式，裸 URL 会被丢弃）。
      // 已经是 asset:// 的就不重复入库。
      // 多参考图：逐张入素材库换 asset://（裸 URL 会被丢弃）。已是 asset:// 的跳过。
      const refsForSubmit: string[] = [];
      for (const u of refList) {
        if (!u) continue;
        if (u.startsWith("asset://")) {
          refsForSubmit.push(u);
        } else {
          refsForSubmit.push(await uploadAsset(u, "Image"));
        }
      }
      // 源视频(remix)同样走素材库换 asset://（Video 类型），裸 URL 会被丢弃
      let srcVideoForSubmit = sourceVideoUrl || "";
      if (srcVideoForSubmit && !srcVideoForSubmit.startsWith("asset://")) {
        srcVideoForSubmit = await uploadAsset(srcVideoForSubmit, "Video");
      }
      // 上传图(base64)提交前再压缩，避免请求体过大导致 504
      const firstForSubmit = await shrinkDataUrl(firstImageUrl || "");
      const lastForSubmit = await shrinkDataUrl(lastImageUrl || "");
      // 多图编号注入：>1 张时，在提示词前加「参考图片编号：图片1、图片2…」，
      // 让模型能按编号理解提示词里的图片引用（借鉴 infinite-canvas）。
      let promptForSubmit = (prompt || "").trim() || "让画面自然地动起来，保持主体稳定、镜头平滑";
      if (refsForSubmit.length > 1) {
        const labels = refsForSubmit.map((_, i) => `图片${i + 1}`).join("、");
        promptForSubmit = `参考图片编号：${labels}。请按这些编号理解提示词中的图片引用。\n\n${promptForSubmit}`;
      }
      const newTaskId = await submitVideo({
        firstImageUrl: firstForSubmit || undefined,
        lastImageUrl: lastForSubmit || undefined,
        referenceImageUrls: refsForSubmit.length ? refsForSubmit : undefined,
        sourceVideoUrl: srcVideoForSubmit || undefined,
        prompt: promptForSubmit,
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
      <div style={{ position: "relative", width: w, height: h, overflow: "visible" }}>
        <div style={outerNameRowStyle}>
          <input
            style={outerNameInputStyle}
            placeholder="视频 · 未命名"
            value={name}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => update({ name: e.target.value })}
          />
        </div>
        <div style={cardShell(TOKENS.video, w, h)}>
        <div style={{ padding: "10px 12px 0" }}>
          <span style={labelStyle}>视频</span>
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
              {/* 停止：退回配置态，可改参数重来。注意：后端任务可能已在跑/已扣费，停止只停前端轮询 */}
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!confirm("停止本次生成？\n若任务已在后端运行可能仍会扣费，停止仅结束本卡的等待，可重新配置。")) return;
                  update({ status: "config", error: "", taskId: "", progress: 0 });
                  setBusy(false);
                }}
                style={{
                  marginTop: 14,
                  height: 28,
                  padding: "0 16px",
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.25)",
                  background: "rgba(255,255,255,0.08)",
                  color: "#e2e8f0",
                  fontSize: 12,
                  cursor: "pointer",
                  pointerEvents: "all",
                }}
              >
                停止
              </button>
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
            <div style={{ position: "relative", width: "100%", height: "100%" }}>
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
              {/* 右下角"更多"按钮 */}
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen((v) => !v);
                }}
                title="更多"
                style={{
                  position: "absolute",
                  right: 8,
                  bottom: 44,
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  border: "none",
                  background: "rgba(15,17,21,0.6)",
                  color: "#fff",
                  fontSize: 16,
                  lineHeight: "30px",
                  padding: 0,
                  cursor: "pointer",
                  pointerEvents: "all",
                  backdropFilter: "blur(4px)",
                }}
              >
                ⋯
              </button>
              {menuOpen && (
                <div
                  onPointerDown={(e) => e.stopPropagation()}
                  style={{
                    position: "absolute",
                    right: 8,
                    bottom: 80,
                    minWidth: 132,
                    background: "#fff",
                    borderRadius: 10,
                    boxShadow: "0 8px 24px rgba(15,17,21,0.18)",
                    border: `1px solid ${TOKENS.border}`,
                    overflow: "hidden",
                    pointerEvents: "all",
                    zIndex: 10,
                  }}
                >
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpen(false);
                      if (!videoUrl) return;
                      // 在当前卡右侧新建一个「续/编辑」视频卡，源视频填当前视频
                      const me = editor.getShape(shapeId);
                      const bounds = editor.getShapePageBounds(shapeId);
                      const nx = bounds ? bounds.x + bounds.w + 60 : (me as any)?.x + 400 || 0;
                      const ny = bounds ? bounds.y : (me as any)?.y || 0;
                      const newId = createShapeId();
                      editor.createShape({
                        id: newId,
                        type: "video-card",
                        x: nx,
                        y: ny,
                        props: {
                          status: "config",
                          sourceVideoUrl: videoUrl,
                        },
                      });
                      editor.select(newId);
                    }}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "9px 12px",
                      border: "none",
                      background: "#fff",
                      color: "#475569",
                      fontSize: 12,
                      cursor: "pointer",
                      pointerEvents: "all",
                    }}
                    title="基于这条视频续编辑/再生成"
                  >
                    🎬 Remix 这条视频
                  </button>
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpen(false);
                      // 把本卡提到最上层，解决多卡重叠时点不中的问题
                      editor.bringToFront([shapeId]);
                    }}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "9px 12px",
                      border: "none",
                      borderTop: `1px solid ${TOKENS.border}`,
                      background: "#fff",
                      color: "#475569",
                      fontSize: 12,
                      cursor: "pointer",
                      pointerEvents: "all",
                    }}
                  >
                    ⬆ 置于顶层
                  </button>
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpen(false);
                      window.open(videoUrl, "_blank");
                    }}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "9px 12px",
                      border: "none",
                      borderTop: `1px solid ${TOKENS.border}`,
                      background: "#fff",
                      color: "#475569",
                      fontSize: 12,
                      cursor: "pointer",
                      pointerEvents: "all",
                    }}
                  >
                    ⬇ 下载 / 新窗口打开
                  </button>
                </div>
              )}
            </div>
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
                ["frames", "首尾帧", false],
                ["ref", "参考图", false],
                ["srcvideo", "续/编辑", false],
              ] as const).map(([m, label, disabled]) => (
                <button
                  key={m}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    if (disabled) {
                      alert("当前版本暂无法生成。可用：首尾帧、图生视频、文生视频。");
                      return;
                    }
                    switchMode(m as "frames" | "ref" | "srcvideo");
                  }}
                  title={disabled ? "平台暂未支持，敬请期待" : ""}
                  style={{
                    flex: 1,
                    height: 28,
                    borderRadius: 8,
                    border: `1px solid ${mode === m ? TOKENS.video : TOKENS.border}`,
                    background: mode === m ? TOKENS.video : "#fff",
                    color: disabled ? "#b0b6c0" : mode === m ? "#fff" : "#475569",
                    fontSize: 11,
                    cursor: disabled ? "not-allowed" : "pointer",
                    pointerEvents: "all",
                    position: "relative",
                  }}
                >
                  {label}
                  {disabled ? "*" : ""}
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
              <div>
                <div style={{ fontSize: 10, color: "#64748b", marginBottom: 4 }}>
                  参考图（角色/物体/场景一致性，最多 {MAX_REF} 张）
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {refList.map((u) => (
                    <div
                      key={u}
                      style={{
                        position: "relative",
                        width: 60,
                        height: 60,
                        flex: "0 0 auto",
                      }}
                    >
                      <img
                        src={u}
                        alt=""
                        style={{
                          width: 60,
                          height: 60,
                          objectFit: "cover",
                          borderRadius: 8,
                          border: `1px solid ${TOKENS.border}`,
                        }}
                      />
                      <button
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeRef(u);
                        }}
                        style={{
                          position: "absolute",
                          top: -6,
                          right: -6,
                          width: 18,
                          height: 18,
                          borderRadius: 999,
                          border: "none",
                          background: "rgba(15,17,21,0.78)",
                          color: "#fff",
                          fontSize: 11,
                          lineHeight: "18px",
                          cursor: "pointer",
                          padding: 0,
                          pointerEvents: "all",
                        }}
                        title="移除"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {refList.length < MAX_REF && (
                    <button
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPicking(picking === "ref" ? null : "ref");
                      }}
                      style={{
                        width: 60,
                        height: 60,
                        flex: "0 0 auto",
                        borderRadius: 8,
                        border: `2px ${picking === "ref" ? "solid" : "dashed"} ${
                          picking === "ref" ? TOKENS.video : "#cbd5e1"
                        }`,
                        background: "#f8fafc",
                        color: picking === "ref" ? TOKENS.video : "#94a3b8",
                        fontSize: 22,
                        cursor: "pointer",
                        pointerEvents: "all",
                        lineHeight: 1,
                      }}
                      title="添加参考图"
                    >
                      +
                    </button>
                  )}
                </div>
                {refList.length > 1 && (
                  <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>
                    提交时会自动按「图片1、图片2…」编号，可在提示词里按编号引用
                  </div>
                )}
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
                    {picking === "ref"
                      ? "参考图只能用「文生图」生成的图（有公网链接）——上传的图平台暂不识别"
                      : "画布上还没有可用图片——先用「文生图」或「上传图片」弄一张"}
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
                          addRef(img.url);
                          connectFrame(img.id as string);
                          // 参考图可连选多张：不关闭选择器
                          return;
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
    referenceImageUrls: T.arrayOf(T.string),
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
      referenceImageUrls: [],
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
