"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useEditor, createShapeId } from "tldraw";
import { generateImage, submitVideo, getAccessKey } from "@/lib/maas";
import { IMAGE_MODELS, VIDEO_MODELS } from "@/lib/models";

// 画布助手：右侧驾驶舱。一条统一时间线 —— 你说的话、助手的回应、
// 以及画布上所有任务（图片 / 视频）的实时进度，都按时间流在这里。
// 「历史」就是往上滚；每条结果挂 复制 / remix / 定位。
// 任务状态全部实时来自 editor store（不额外存储），和画布上的卡片一一对应。

const IMG_MODEL = IMAGE_MODELS[0]?.id || "doubao-seedream-5-0-260128";
const IMG_SIZE = "2K";
const VID_MODEL = VIDEO_MODELS[0]?.id || "doubao-seedance-2-0-260128";
const VID_MODEL_FAST = VIDEO_MODELS[1]?.id || VID_MODEL;

const STATUS_LABEL: Record<string, { text: string; color: string }> = {
  config: { text: "待生成", color: "#94a3b8" },
  submitting: { text: "提交中", color: "#f59e0b" },
  generating: { text: "生成中", color: "#8b5cf6" },
  done: { text: "完成", color: "#10b981" },
  error: { text: "失败", color: "#ef4444" },
};

type Msg = { kind: "msg"; id: string; ts: number; role: "user" | "assistant"; text: string };
type ImgJob = { kind: "img"; id: string; ts: number; cardId: string; prompt: string };

export default function ChatPanel() {
  const editor = useEditor();
  const [open, setOpen] = useState(true);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [imgJobs, setImgJobs] = useState<ImgJob[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0); // store 变化 → 强制刷新，读最新任务状态
  const [copied, setCopied] = useState<string | null>(null);
  const seenRef = useRef<Record<string, number>>({}); // 视频卡首次出现时间，用于排序
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const placeRef = useRef(0); // 新建卡片落点的错位计数，避免叠在一起

  // 订阅画布 store：任何卡片状态变了都刷新（任务进度实时跟手）
  useEffect(() => {
    if (!editor) return;
    const unsub = editor.store.listen(() => setTick((t) => t + 1), {
      source: "all",
      scope: "document",
    });
    return () => unsub();
  }, [editor]);

  // 有新内容自动滚到底
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  });

  function pushMsg(role: "user" | "assistant", text: string) {
    setMsgs((m) => [
      ...m,
      { kind: "msg", id: `m_${Date.now()}_${Math.random().toString(16).slice(2)}`, ts: Date.now(), role, text },
    ]);
  }

  // 新建卡片落点：画布视口中心附近，按计数错位排开
  function centerSpot(dy: number) {
    const n = placeRef.current++;
    const b = editor.getViewportPageBounds();
    return { x: b.center.x - 160 + (n % 6) * 34, y: b.center.y + dy + (n % 6) * 34 };
  }

  // 当前选中卡片摘要：用于「当前对象」芯片 + 传给大脑解析「这张 / 它」
  function selSummary() {
    const ids = editor.getSelectedShapeIds();
    if (ids.length !== 1) return null;
    const s = editor.getShape(ids[0]) as any;
    if (!s) return null;
    if (!["image-card", "video-card", "prompt-card"].includes(s.type)) return null;
    const p = s.props || {};
    const typeLabel =
      s.type === "image-card" ? "图片卡" : s.type === "video-card" ? "视频卡" : "提示词卡";
    return {
      id: s.id as string,
      type: s.type as string,
      typeLabel,
      name: (p.name as string) || "",
      prompt: (p.prompt as string) || "",
      imageUrl: (p.imageUrl as string) || "",
    };
  }

  // 在画布上建一张「生成中」图片卡，跑文生图，结果回填卡片
  async function runGenerate(prompt: string) {
    const o = centerSpot(-200);
    const cardId = createShapeId();
    editor.createShape({
      id: cardId,
      type: "image-card",
      x: o.x,
      y: o.y,
      props: { status: "generating", prompt, model: IMG_MODEL, imageUrl: "" },
    });
    editor.select(cardId);
    setImgJobs((j) => [
      ...j,
      { kind: "img", id: `j_${Date.now()}_${Math.random().toString(16).slice(2)}`, ts: Date.now(), cardId, prompt },
    ]);
    try {
      const url = await generateImage(prompt, IMG_MODEL, IMG_SIZE);
      if (editor.getShape(cardId))
        editor.updateShape({ id: cardId, type: "image-card", props: { status: "done", imageUrl: url } });
    } catch (e: any) {
      if (editor.getShape(cardId))
        editor.updateShape({
          id: cardId,
          type: "image-card",
          props: { status: "error", error: String(e?.message || e) },
        });
    }
  }

  // 视频生成：firstImageUrl 为空 → 文生视频(16:9 横屏)；有值 → 图生视频，用它当首帧(比例 adaptive 跟随原图)。
  // 拿到 taskId 后设 generating，剩下的轮询交给视频卡自己（它有续查/看门狗逻辑）。
  async function runVideo(prompt: string, fast: boolean, firstImageUrl: string) {
    const model = fast ? VID_MODEL_FAST : VID_MODEL;
    const ratio = firstImageUrl ? "adaptive" : "16:9";
    const o = centerSpot(-150);
    const cardId = createShapeId();
    editor.createShape({
      id: cardId,
      type: "video-card",
      x: o.x,
      y: o.y,
      props: {
        status: "submitting",
        prompt,
        model,
        resolution: "720p",
        duration: "5",
        ratio,
        firstImageUrl: firstImageUrl || "",
      },
    });
    editor.select(cardId);
    try {
      const taskId = await submitVideo({
        prompt,
        model,
        resolution: "720p",
        duration: "5",
        ratio,
        firstImageUrl: firstImageUrl || undefined,
      });
      if (editor.getShape(cardId))
        editor.updateShape({ id: cardId, type: "video-card", props: { status: "generating", taskId } });
    } catch (e: any) {
      if (editor.getShape(cardId))
        editor.updateShape({ id: cardId, type: "video-card", props: { status: "error", error: String(e?.message || e) } });
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    pushMsg("user", text);
    const sel = selSummary();
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-access-key": getAccessKey() },
        body: JSON.stringify({
          message: text,
          context: sel ? { selected: { type: sel.type, name: sel.name, prompt: sel.prompt } } : null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        pushMsg("assistant", `出错了：${data?.error || `HTTP ${res.status}`}`);
        return;
      }
      const action = data.action || { action: "answer", text: "（没听懂）" };
      if (action.action === "generate_image" && action.prompt) {
        pushMsg("assistant", "好，正在生成图片，已放到画布上 →");
        runGenerate(String(action.prompt)); // 不 await：任务卡在时间线里自己跑
      } else if (action.action === "make_video" && action.prompt) {
        const fast = !!action.fast;
        // 选中的是图片卡 + 大脑判定要用它 → 图生视频(首帧)；否则文生视频
        const useImg = !!action.use_selected && !!sel && sel.type === "image-card" && !!sel.imageUrl;
        if (useImg) {
          pushMsg("assistant", `好，正在把选中的图做成视频（${fast ? "Seedance 2.0 Fast" : "Seedance 2.0"}）→`);
          runVideo(String(action.prompt), fast, sel!.imageUrl); // 不 await：交给视频卡自己轮询
        } else {
          pushMsg("assistant", `好，正在用 ${fast ? "Seedance 2.0 Fast" : "Seedance 2.0"} 生成视频 →`);
          runVideo(String(action.prompt), fast, "");
        }
      } else if (action.action === "answer") {
        pushMsg("assistant", String(action.text || ""));
      } else {
        pushMsg("assistant", String(action.text || "这个动作我还在接入中。"));
      }
    } catch (e: any) {
      pushMsg("assistant", `网络错误：${String(e?.message || e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function copyText(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch {}
  }

  function focusCard(cardId: string) {
    const s = editor.getShape(cardId as any);
    if (!s) return;
    editor.select(cardId as any);
    editor.zoomToSelection({ animation: { duration: 300 } });
  }

  // ---- 组合统一时间线：聊天 + 图片任务 + 视频任务，按时间排序 ----
  const shapes = editor.getCurrentPageShapes();
  const vidItems = shapes
    .filter((s: any) => s.type === "video-card")
    .map((s: any) => {
      const p = s.props || {};
      const id = s.id as string;
      if (!seenRef.current[id]) seenRef.current[id] = Date.now();
      return {
        kind: "vid" as const,
        id,
        ts: seenRef.current[id],
        cardId: id,
        status: (p.status as string) || "config",
        progress: (p.progress as number) || 0,
        prompt: (p.prompt as string) || "",
        error: (p.error as string) || "",
        name: (p.name as string) || "",
      };
    })
    .filter((t) => t.status !== "config" || t.prompt);

  const imgItems = imgJobs.map((j) => {
    const s = editor.getShape(j.cardId as any) as any;
    const p = s?.props || {};
    return {
      ...j,
      status: (p.status as string) || (s ? "generating" : "error"),
      imageUrl: (p.imageUrl as string) || "",
      name: (p.name as string) || "",
      error: (p.error as string) || (s ? "" : "卡片已删除"),
    };
  });

  const timeline = [...msgs, ...imgItems, ...vidItems].sort((a: any, b: any) => a.ts - b.ts);
  const sel = selSummary();

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={fab}>
        💬 画布助手
      </button>
    );
  }

  return (
    <div style={panel}>
      <div style={head}>
        <span style={{ fontWeight: 700, fontSize: 13, color: "#16181d", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: "#8b5cf6" }}>✦</span> 画布助手
        </span>
        <button onClick={() => setOpen(false)} title="收起" style={closeBtn}>
          ×
        </button>
      </div>

      <div ref={scrollRef} style={scroll}>
        {timeline.length === 0 ? (
          <div style={empty}>
            试着说：
            <br />
            「生成一个赛博朋克女孩」
            <br />
            「做一段下雨赛博城市的视频」
            <br />
            选中一张图 →「把这张做成视频」
          </div>
        ) : (
          timeline.map((it: any) => {
            if (it.kind === "msg") {
              return it.role === "user" ? (
                <div key={it.id} style={{ display: "flex", justifyContent: "flex-end" }}>
                  <div style={userBubble}>{it.text}</div>
                </div>
              ) : (
                <div key={it.id} style={{ display: "flex", gap: 7, alignItems: "flex-start" }}>
                  <span style={{ fontSize: 13, color: "#c4b5fd", marginTop: 1 }}>✦</span>
                  <div style={asstText}>{it.text}</div>
                </div>
              );
            }
            const isImg = it.kind === "img";
            const sl = STATUS_LABEL[it.status] || STATUS_LABEL.config;
            return (
              <div key={it.id} style={taskCard}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <span onClick={() => focusCard(it.cardId)} style={taskTitle} title="点击定位到画布上的卡片">
                    {(it.name || "未命名") + " · " + (isImg ? "图片" : "视频")}
                  </span>
                  <span style={{ ...badge, background: sl.color }}>
                    {sl.text}
                    {it.kind === "vid" && it.status === "generating" && it.progress ? ` ${it.progress}%` : ""}
                  </span>
                </div>

                {isImg && (
                  <div style={thumb}>
                    {it.status === "done" && it.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} draggable={false} />
                    ) : it.status === "error" ? (
                      <span style={{ fontSize: 11, color: "#ef4444", padding: 8, textAlign: "center", lineHeight: 1.5 }}>
                        {it.error || "生成失败"}
                      </span>
                    ) : (
                      <span style={{ fontSize: 11, color: "#94a3b8" }}>生成中…</span>
                    )}
                  </div>
                )}

                {it.kind === "vid" && it.status === "generating" && (
                  <div style={bar}>
                    <div style={{ height: "100%", width: `${it.progress || 0}%`, background: "#8b5cf6", transition: "width .4s" }} />
                  </div>
                )}
                {it.kind === "vid" && it.status === "error" && it.error && <div style={errBox}>{it.error}</div>}

                {it.prompt && <div style={promptBox}>{it.prompt}</div>}

                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  {it.prompt && (
                    <button
                      onClick={() => copyText(it.id, it.prompt)}
                      style={{ ...miniBtn, color: copied === it.id ? "#fff" : "#475569", background: copied === it.id ? "#10b981" : "#fff" }}
                    >
                      {copied === it.id ? "✓ 已复制" : "复制提示词"}
                    </button>
                  )}
                  {isImg && it.status === "done" && it.prompt && (
                    <button onClick={() => runGenerate(it.prompt)} style={miniBtn} title="用同一提示词再生成一张">
                      remix
                    </button>
                  )}
                  <button onClick={() => focusCard(it.cardId)} style={miniBtn}>
                    定位
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div style={footer}>
        {sel && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: "#94a3b8" }}>当前</span>
            <span style={chip} title={sel.prompt}>
              {sel.typeLabel + (sel.name ? ` · ${sel.name}` : sel.prompt ? ` · ${sel.prompt.slice(0, 12)}…` : "")}
            </span>
          </div>
        )}
        <div style={inputWrap}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            onPointerDown={(e) => e.stopPropagation()}
            placeholder="描述你想生成的图片，或问我点什么…"
            rows={2}
            style={textArea}
          />
          <button
            onClick={send}
            disabled={busy || !input.trim()}
            style={{ ...sendBtn, opacity: busy || !input.trim() ? 0.5 : 1, cursor: busy || !input.trim() ? "default" : "pointer" }}
          >
            {busy ? "…" : "↑"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- styles ----
const FONT = "system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif";
const panel: CSSProperties = {
  position: "absolute",
  top: 12,
  right: 12,
  bottom: 12,
  width: 360,
  zIndex: 250,
  background: "rgba(255,255,255,0.98)",
  backdropFilter: "blur(8px)",
  borderRadius: 14,
  border: "1px solid #e5e7eb",
  boxShadow: "0 10px 34px rgba(15,17,21,0.14)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  fontFamily: FONT,
};
const head: CSSProperties = {
  height: 44,
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0 14px",
  borderBottom: "1px solid #f0f0f0",
};
const closeBtn: CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: 6,
  border: "none",
  background: "transparent",
  color: "#94a3b8",
  fontSize: 16,
  cursor: "pointer",
  lineHeight: "24px",
  padding: 0,
};
const scroll: CSSProperties = {
  flex: 1,
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  gap: 12,
  padding: 12,
};
const empty: CSSProperties = { margin: "auto", color: "#b0b6c0", fontSize: 12, textAlign: "center", lineHeight: 1.7 };
const userBubble: CSSProperties = {
  maxWidth: "80%",
  background: "#eef2ff",
  color: "#3730a3",
  borderRadius: 12,
  padding: "8px 12px",
  fontSize: 13,
  lineHeight: 1.5,
  wordBreak: "break-word",
};
const asstText: CSSProperties = { fontSize: 13, lineHeight: 1.55, color: "#475569", flex: 1, wordBreak: "break-word" };
const taskCard: CSSProperties = { border: "1px solid #eef0f2", borderRadius: 10, padding: 10, background: "#fff" };
const taskTitle: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "#16181d",
  cursor: "pointer",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  maxWidth: 200,
};
const badge: CSSProperties = { fontSize: 10, fontWeight: 600, color: "#fff", borderRadius: 999, padding: "2px 8px", flexShrink: 0 };
const thumb: CSSProperties = {
  height: 160,
  borderRadius: 8,
  background: "#f3f4f6",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  overflow: "hidden",
  marginBottom: 8,
};
const bar: CSSProperties = { height: 3, borderRadius: 999, background: "#eef0f2", overflow: "hidden", marginBottom: 8 };
const errBox: CSSProperties = {
  fontSize: 11,
  color: "#ef4444",
  background: "#fef2f2",
  borderRadius: 6,
  padding: "6px 8px",
  marginBottom: 8,
  wordBreak: "break-all",
  maxHeight: 80,
  overflow: "auto",
};
const promptBox: CSSProperties = {
  fontSize: 11,
  color: "#475569",
  lineHeight: 1.5,
  background: "#f8fafc",
  borderRadius: 6,
  padding: "6px 8px",
  maxHeight: 72,
  overflow: "auto",
  wordBreak: "break-word",
};
const miniBtn: CSSProperties = {
  flex: 1,
  height: 26,
  borderRadius: 6,
  border: "1px solid #e5e7eb",
  background: "#fff",
  color: "#475569",
  fontSize: 11,
  cursor: "pointer",
};
const footer: CSSProperties = { flexShrink: 0, padding: 12, borderTop: "1px solid #f0f0f0" };
const chip: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  fontSize: 11,
  padding: "3px 9px",
  borderRadius: 8,
  background: "#eef2ff",
  color: "#4338ca",
  maxWidth: 270,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const inputWrap: CSSProperties = {
  display: "flex",
  alignItems: "flex-end",
  gap: 8,
  border: "1px solid #d1d5db",
  borderRadius: 10,
  padding: 8,
  pointerEvents: "all",
};
const textArea: CSSProperties = {
  flex: 1,
  border: "none",
  outline: "none",
  resize: "none",
  fontSize: 13,
  lineHeight: 1.4,
  fontFamily: FONT,
  color: "#16181d",
  background: "transparent",
};
const sendBtn: CSSProperties = {
  width: 30,
  height: 30,
  flexShrink: 0,
  borderRadius: "50%",
  border: "none",
  background: "#16181d",
  color: "#fff",
  fontSize: 15,
  lineHeight: "30px",
  padding: 0,
};
const fab: CSSProperties = {
  position: "absolute",
  top: 12,
  right: 12,
  zIndex: 250,
  height: 34,
  padding: "0 14px",
  borderRadius: 8,
  border: "1px solid #e5e7eb",
  background: "#fff",
  color: "#475569",
  fontSize: 12,
  cursor: "pointer",
  boxShadow: "0 4px 14px rgba(15,17,21,0.1)",
  fontFamily: FONT,
};
