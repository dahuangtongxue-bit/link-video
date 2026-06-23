"use client";

import { useState, useEffect } from "react";
import { BaseBoxShapeUtil, HTMLContainer, T, useEditor, createShapeId, createShapePropsMigrationIds, createShapePropsMigrationSequence } from "tldraw";
import type { ShotShape } from "@/lib/types";
import { generateImage, rehostImage, submitVideo } from "@/lib/maas";
import { IMAGE_MODELS, IMAGE_SIZES, IMAGE_RATIOS, VIDEO_MODELS } from "@/lib/models";
import { connectShapes } from "@/lib/connect";
import {
  TOKENS,
  cardShell,
  labelStyle,
  outerNameRowStyle,
  outerNameInputStyle,
  primaryBtn,
  selectStyle,
  textAreaStyle,
} from "./cardStyles";

// 镜头卡主色：天蓝，区别于提示词(靛)/图片(绿)/视频(紫)
const SHOT = "#0ea5e9";

// 旋钮：value 直接是要拼进提示词的中文片段；空字符串 = 自动(不加这一项)
const SHOT_SIZES = [
  { v: "", label: "景别 · 自动" },
  { v: "远景", label: "远景" },
  { v: "全景", label: "全景" },
  { v: "中景", label: "中景" },
  { v: "近景", label: "近景" },
  { v: "特写", label: "特写" },
];
const MOVES = [
  { v: "", label: "运镜 · 自动" },
  { v: "固定镜头", label: "固定" },
  { v: "镜头缓慢推近", label: "推" },
  { v: "镜头缓慢拉远", label: "拉" },
  { v: "镜头横向摇移", label: "摇" },
  { v: "镜头平移跟随", label: "移" },
  { v: "镜头升降运动", label: "升降" },
  { v: "镜头环绕主体", label: "环绕" },
  { v: "手持轻微晃动", label: "手持" },
];
const LIGHTS = [
  { v: "", label: "光线 · 自动" },
  { v: "自然光", label: "自然光" },
  { v: "明亮白天", label: "白天" },
  { v: "黄金时刻暖光", label: "黄昏" },
  { v: "夜晚氛围光", label: "夜晚" },
  { v: "逆光剪影", label: "逆光" },
  { v: "柔和散射光", label: "柔光" },
  { v: "强烈硬光", label: "硬光" },
];
const TEXTURES = [
  { v: "", label: "质感 · 自动" },
  { v: "电影质感", label: "电影感" },
  { v: "写实摄影质感", label: "写实" },
  { v: "胶片颗粒质感", label: "胶片" },
  { v: "通透干净的画面", label: "通透" },
  { v: "油画质感", label: "油画" },
  { v: "3D 动画质感", label: "动画" },
];
const COLORS = [
  { v: "", label: "色调 · 自动" },
  { v: "自然色调", label: "自然" },
  { v: "暖色调", label: "暖调" },
  { v: "冷色调", label: "冷调" },
  { v: "高对比色彩", label: "高对比" },
  { v: "低饱和色调", label: "低饱和" },
  { v: "黑白", label: "黑白" },
];
const DURATIONS = ["5", "6", "8", "10"].map((v) => ({ v, label: `${v}秒` }));

function knob(
  value: string,
  opts: { v: string; label: string }[],
  onChange: (v: string) => void
) {
  return (
    <select
      style={{ ...selectStyle, flex: 1, minWidth: 0 }}
      value={value}
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value)}
    >
      {opts.map((o) => (
        <option key={o.v} value={o.v}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function ShotCard({ shape }: { shape: ShotShape }) {
  const editor = useEditor();
  const {
    w, h, shotNo, title, shotSize, cameraMove, light, texture, color,
    duration, content, imageModel, size, ratio, videoModel, srcImageUrl, refFrameUrl,
  } = shape.props;
  const shapeId = shape.id;
  const [busy, setBusy] = useState<null | "frame" | "video">(null);
  // 「选画布图片做图生图」：点按钮进入拾取态，再点画布上任意一张已完成的图片卡即捕获为源图
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    if (!editor || !picking) return;
    let raf = 0;
    const tick = () => {
      try {
        const sel = editor.getSelectedShapes?.() ?? [];
        const img = sel.find(
          (s: any) => s.type === "image-card" && s.props?.status === "done" && s.props?.imageUrl
        );
        if (img) {
          editor.updateShape({ id: shapeId, type: "shot-card", props: { srcImageUrl: (img as any).props.imageUrl } } as any);
          setPicking(false);
          return; // 命中即停，不再续帧
        }
      } catch {}
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [editor, picking, shapeId]);

  function update(props: Partial<ShotShape["props"]>) {
    editor.updateShape<ShotShape>({ id: shapeId, type: "shot-card", props });
  }

  // 参考帧提示词：内容 + 景别 + 质感 + 色调 + 光线（控制"看起来怎么样"）
  function imagePrompt(): string {
    return [content, shotSize, texture, color, light].map((s) => (s || "").trim()).filter(Boolean).join("，");
  }
  // 视频提示词：内容 + 运镜 + 光线（控制"怎么动"；画面观感由参考帧承载）
  function videoPrompt(): string {
    const p = [content, cameraMove, light].map((s) => (s || "").trim()).filter(Boolean).join("，");
    return p || "让画面自然地动起来，保持主体稳定、镜头平滑";
  }

  function belowPos() {
    const b = editor.getShapePageBounds(shapeId);
    return b ? { x: b.x, y: b.y + b.h + 44 } : { x: (shape as any).x, y: (shape as any).y + h + 44 };
  }
  function rightPos() {
    const b = editor.getShapePageBounds(shapeId);
    return b ? { x: b.x + b.w + 56, y: b.y } : { x: (shape as any).x + w + 56, y: (shape as any).y };
  }

  // 「生参考帧」：在镜头卡下方生出一张图片卡，复用现成出图管线
  async function genFrame() {
    const p = imagePrompt().trim();
    if (!p) {
      window.alert("先填「画面内容」");
      return;
    }
    if (busy) return;
    setBusy("frame");
    const pos = belowPos();
    const imgId = createShapeId();
    editor.createShape({
      id: imgId,
      type: "image-card",
      x: pos.x,
      y: pos.y,
      props: { status: "generating", prompt: p, model: imageModel },
    });
    connectShapes(editor, shapeId as any, imgId as any);
    try {
      // 选了画布源图 → 图生图（复用本卡提示词+参数，按 ratio 重绘）；没选 → 普通文生关键帧
      let url = await generateImage(p, imageModel, size, ratio, srcImageUrl || undefined);
      try {
        url = await rehostImage(url); // 转永久 URL，便于后面当首帧/参考图
      } catch {
        /* 转存失败就用原 URL（24h 内仍可用作首帧） */
      }
      if (editor.getShape(imgId)) {
        editor.updateShape({ id: imgId, type: "image-card", props: { status: "done", imageUrl: url } });
      }
      if (editor.getShape(shapeId)) update({ refFrameUrl: url });
    } catch (e: any) {
      if (editor.getShape(imgId)) {
        editor.updateShape({ id: imgId, type: "image-card", props: { status: "error", error: String(e?.message || e) } });
      }
    } finally {
      setBusy(null);
    }
  }

  // 「生视频」：在镜头卡右侧生出一张视频卡，有参考帧就当首帧，没有则文生视频
  async function genVideo() {
    if (busy) return;
    setBusy("video");
    const pos = rightPos();
    const vidId = createShapeId();
    const useFrame = !!refFrameUrl;
    editor.createShape({
      id: vidId,
      type: "video-card",
      x: pos.x,
      y: pos.y,
      props: {
        status: "submitting",
        prompt: videoPrompt(),
        model: videoModel,
        firstImageUrl: useFrame ? refFrameUrl : "",
        resolution: "720p",
        duration,
        ratio: useFrame ? "adaptive" : (ratio || "16:9"),
      },
    });
    connectShapes(editor, shapeId as any, vidId as any);
    try {
      const taskId = await submitVideo({
        firstImageUrl: useFrame ? refFrameUrl : undefined,
        prompt: videoPrompt(),
        model: videoModel,
        resolution: "720p",
        duration,
        ratio: useFrame ? "adaptive" : (ratio || "16:9"),
      });
      if (editor.getShape(vidId)) {
        // 切到 generating + taskId → 视频卡自己接管轮询
        editor.updateShape({ id: vidId, type: "video-card", props: { status: "generating", taskId } });
      }
    } catch (e: any) {
      if (editor.getShape(vidId)) {
        editor.updateShape({ id: vidId, type: "video-card", props: { status: "error", error: String(e?.message || e) } });
      }
    } finally {
      setBusy(null);
    }
  }

  const preview = imagePrompt();

  return (
    <HTMLContainer>
      <div style={{ position: "relative", width: w, height: h, overflow: "visible" }}>
        <div style={outerNameRowStyle}>
          <input
            style={outerNameInputStyle}
            placeholder="镜头 · 未命名"
            value={title}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => update({ title: e.target.value })}
          />
        </div>
        <div style={cardShell(SHOT, w, h)}>
          {/* 头部：标签 + 镜号 */}
          <div style={{ padding: "10px 12px 0", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={labelStyle}>镜头</span>
            <input
              value={shotNo}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => update({ shotNo: e.target.value })}
              placeholder="镜号"
              style={{
                pointerEvents: "all",
                width: 48,
                border: `1px solid ${TOKENS.border}`,
                borderRadius: 6,
                padding: "2px 6px",
                fontSize: 12,
                fontFamily: TOKENS.mono,
                color: TOKENS.ink,
                outline: "none",
              }}
            />
          </div>

          <div style={{ padding: "8px 12px 12px", display: "flex", flexDirection: "column", gap: 8, overflowY: "auto" }}>
            {/* 画面内容 */}
            <textarea
              placeholder="画面内容：主体 + 行为 + 环境（如：一个少年站在天台边缘，俯瞰雨夜霓虹城市）"
              value={content}
              style={{ ...textAreaStyle, minHeight: 70 }}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => update({ content: e.target.value })}
            />

            {/* 旋钮：景别/运镜/光线/质感/色调/时长 */}
            <div style={{ display: "flex", gap: 6 }}>
              {knob(shotSize, SHOT_SIZES, (v) => update({ shotSize: v }))}
              {knob(cameraMove, MOVES, (v) => update({ cameraMove: v }))}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {knob(light, LIGHTS, (v) => update({ light: v }))}
              {knob(texture, TEXTURES, (v) => update({ texture: v }))}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {knob(color, COLORS, (v) => update({ color: v }))}
              {knob(duration, DURATIONS, (v) => update({ duration: v }))}
            </div>

            {/* 参考帧提示词预览（让"可控"看得见） */}
            {preview ? (
              <div
                style={{
                  fontSize: 10,
                  lineHeight: 1.4,
                  color: "#94a3b8",
                  fontFamily: TOKENS.mono,
                  background: "#f8fafc",
                  border: `1px dashed ${TOKENS.border}`,
                  borderRadius: 6,
                  padding: "5px 7px",
                  maxHeight: 48,
                  overflow: "hidden",
                }}
              >
                参考帧提示：{preview}
              </div>
            ) : null}

            {/* 第一阶段：生参考帧 */}
            <div style={{ display: "flex", gap: 6 }}>
              {knob(imageModel, IMAGE_MODELS.map((m) => ({ v: m.id, label: m.label.replace("豆包图像 · ", "") })), (v) => update({ imageModel: v }))}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {knob(size, IMAGE_SIZES.map((s) => ({ v: s.id, label: s.label })), (v) => update({ size: v }))}
              {knob(ratio, IMAGE_RATIOS.map((r) => ({ v: r.id, label: r.label })), (v) => update({ ratio: v }))}
            </div>
            {/* 图生图源图（可选）：从画布选一张图当参考，复用本卡提示词与参数重绘 */}
            {srcImageUrl ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#f0f9ff", border: `1px solid ${SHOT}`, borderRadius: 6, padding: "5px 7px" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={srcImageUrl} alt="" style={{ width: 32, height: 32, objectFit: "cover", borderRadius: 4, border: `1px solid ${TOKENS.border}` }} />
                <span style={{ fontSize: 11, color: "#0369a1", flex: 1 }}>已选源图 · 将走图生图</span>
                <button
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); update({ srcImageUrl: "" }); }}
                  style={{ height: 22, padding: "0 8px", borderRadius: 6, border: `1px solid ${TOKENS.border}`, background: "#fff", color: "#64748b", fontSize: 11, cursor: "pointer", pointerEvents: "all" }}
                >
                  ✕ 清除
                </button>
              </div>
            ) : picking ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#fffbeb", border: "1px dashed #f59e0b", borderRadius: 6, padding: "6px 8px" }}>
                <span style={{ fontSize: 11, color: "#b45309", flex: 1 }}>👉 点选画布上的一张图片卡作源图…</span>
                <button
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); setPicking(false); }}
                  style={{ height: 22, padding: "0 8px", borderRadius: 6, border: `1px solid ${TOKENS.border}`, background: "#fff", color: "#64748b", fontSize: 11, cursor: "pointer", pointerEvents: "all" }}
                >
                  取消
                </button>
              </div>
            ) : (
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); setPicking(true); }}
                style={{ height: 30, borderRadius: 8, border: `1px dashed ${TOKENS.border}`, background: "#fafafa", color: TOKENS.muted, fontSize: 12, cursor: "pointer", pointerEvents: "all", textAlign: "left", padding: "0 10px", fontFamily: TOKENS.sans }}
                title="从画布选一张图作源图 → 生关键帧时走图生图（复用本卡提示词与参数）"
              >
                ＋ 选画布图片做图生图（可选）
              </button>
            )}

            <button
              style={{ ...primaryBtn(SHOT, busy === "frame"), width: "100%" }}
              disabled={busy === "frame"}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={genFrame}
            >
              {busy === "frame"
                ? "生成关键帧…"
                : refFrameUrl
                ? "重新生成 ↓"
                : srcImageUrl
                ? "图生关键帧 ↓"
                : "生成关键帧 ↓"}
            </button>

            {refFrameUrl ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={refFrameUrl}
                  alt=""
                  style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6, border: `1px solid ${TOKENS.border}` }}
                />
                <span style={{ fontSize: 11, color: "#64748b" }}>参考帧已就绪 · 将作首帧</span>
              </div>
            ) : null}

            {/* 第二阶段：生视频 */}
            <div style={{ display: "flex", gap: 6 }}>
              {knob(videoModel, VIDEO_MODELS.map((m) => ({ v: m.id, label: m.label })), (v) => update({ videoModel: v }))}
            </div>
            <button
              style={{ ...primaryBtn(TOKENS.video, busy === "video"), width: "100%" }}
              disabled={busy === "video"}
              title={refFrameUrl ? "用参考帧当首帧生成视频" : "未生成参考帧，将用文生视频"}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={genVideo}
            >
              {busy === "video" ? "提交视频…" : refFrameUrl ? "生视频（首帧） →" : "生视频（文生） →"}
            </button>
          </div>
        </div>
      </div>
    </HTMLContainer>
  );
}

// 旧画布数据升级：给已存在的镜头卡补上 ratio 字段，避免清空画布。
// 注意：ShotShape 此前没有迁移序列，这是第一条 —— 别删，否则老画布加载会校验失败。
const shotCardVersions = createShapePropsMigrationIds("shot-card", { AddRatio: 1, AddSrcImage: 2 });
const shotCardMigrations = createShapePropsMigrationSequence({
  sequence: [
    {
      id: shotCardVersions.AddRatio,
      up(props: any) {
        props.ratio = "16:9";
      },
      down(props: any) {
        delete props.ratio;
      },
    },
    {
      id: shotCardVersions.AddSrcImage,
      up(props: any) {
        props.srcImageUrl = "";
      },
      down(props: any) {
        delete props.srcImageUrl;
      },
    },
  ],
});

export class ShotShapeUtil extends BaseBoxShapeUtil<ShotShape> {
  static override type = "shot-card" as const;
  static override migrations = shotCardMigrations;
  static override props = {
    w: T.number,
    h: T.number,
    shotNo: T.string,
    title: T.string,
    shotSize: T.string,
    cameraMove: T.string,
    light: T.string,
    texture: T.string,
    color: T.string,
    duration: T.string,
    content: T.string,
    imageModel: T.string,
    size: T.string,
    ratio: T.string,
    videoModel: T.string,
    srcImageUrl: T.string,
    refFrameUrl: T.string,
    status: T.string,
  };

  getDefaultProps(): ShotShape["props"] {
    return {
      w: 300,
      h: 540,
      shotNo: "",
      title: "",
      shotSize: "",
      cameraMove: "",
      light: "",
      texture: "电影质感",
      color: "",
      duration: "5",
      content: "",
      imageModel: IMAGE_MODELS[0]?.id ?? "",
      size: "2K",
      ratio: "16:9",
      videoModel: VIDEO_MODELS[0]?.id ?? "",
      srcImageUrl: "",
      refFrameUrl: "",
      status: "idle",
    };
  }

  override canResize() {
    return false;
  }
  override canEdit() {
    return false;
  }

  component(shape: ShotShape) {
    return <ShotCard shape={shape} />;
  }

  indicator(shape: ShotShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={12} ry={12} />;
  }
}
