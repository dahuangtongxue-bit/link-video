"use client";

import { useEffect, useState } from "react";
import { useEditor } from "tldraw";

// 任务记录区：汇总画布上所有视频卡的状态，自下而上流式（最新在底部）。
// 显示任务名、状态、进度、提示词（可一键复制复用）。
// 数据实时来自 editor store（video-card 的 props），不额外存储。

type Task = {
  id: string;
  name: string;
  status: string; // config / submitting / generating / done / error
  progress: number;
  prompt: string;
  error: string;
  videoUrl: string;
  mode: string; // 首尾帧 / 参考图 / 续编辑 / 文/图生视频
};

const STATUS_LABEL: Record<string, { text: string; color: string }> = {
  config: { text: "待生成", color: "#94a3b8" },
  submitting: { text: "提交中", color: "#f59e0b" },
  generating: { text: "生成中", color: "#8b5cf6" },
  done: { text: "完成", color: "#10b981" },
  error: { text: "失败", color: "#ef4444" },
};

function deriveMode(p: any): string {
  if (p.sourceVideoUrl) return "续编辑";
  if (p.referenceImageUrl) return "参考图";
  if (p.firstImageUrl && p.lastImageUrl) return "首尾帧";
  if (p.firstImageUrl) return "图生视频";
  return "视频";
}

export default function TaskPanel() {
  const editor = useEditor();
  const [open, setOpen] = useState(true);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (!editor) return;
    const refresh = () => {
      const shapes = editor.getCurrentPageShapes();
      const vids = shapes
        .filter((s: any) => s.type === "video-card")
        .map((s: any) => {
          const p = s.props || {};
          return {
            id: s.id as string,
            name: (p.name as string) || "",
            status: (p.status as string) || "config",
            progress: (p.progress as number) || 0,
            prompt: (p.prompt as string) || "",
            error: (p.error as string) || "",
            videoUrl: (p.videoUrl as string) || "",
            mode: deriveMode(p),
          } as Task;
        });
      // 只展示已经在跑或完成的（config 态的空卡不进记录）
      const active = vids.filter(
        (t) => t.status !== "config" || t.prompt
      );
      setTasks(active);
    };
    refresh();
    // 订阅 store 变化，实时刷新
    const unsub = editor.store.listen(refresh, { source: "all", scope: "document" });
    return () => unsub();
  }, [editor]);

  const copyPrompt = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500);
    } catch {
      // 降级：选中提示
    }
  };

  const focusCard = (id: string) => {
    const shape = editor.getShape(id as any);
    if (!shape) return;
    editor.select(id as any);
    editor.zoomToSelection({ animation: { duration: 300 } });
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
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
          fontFamily: "system-ui, -apple-system, 'PingFang SC', sans-serif",
        }}
      >
        📋 任务记录 ({tasks.length})
      </button>
    );
  }

  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        right: 12,
        bottom: 12,
        width: 320,
        zIndex: 250,
        background: "rgba(255,255,255,0.97)",
        backdropFilter: "blur(8px)",
        borderRadius: 14,
        border: "1px solid #e5e7eb",
        boxShadow: "0 10px 34px rgba(15,17,21,0.14)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontFamily: "system-ui, -apple-system, 'PingFang SC', sans-serif",
      }}
    >
      <div
        style={{
          height: 44,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 14px",
          borderBottom: "1px solid #f0f0f0",
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 13, color: "#16181d" }}>
          任务记录
        </span>
        <button
          onClick={() => setOpen(false)}
          style={{
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
          }}
          title="收起"
        >
          ×
        </button>
      </div>

      {/* 自下而上流式：列表反向，最新在底部，初始滚到底 */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          padding: 12,
        }}
      >
        {tasks.length === 0 ? (
          <div
            style={{
              margin: "auto",
              color: "#b0b6c0",
              fontSize: 12,
              textAlign: "center",
              lineHeight: 1.6,
            }}
          >
            还没有视频任务
            <br />
            点「+ 生成视频」开始
          </div>
        ) : (
          tasks.map((t) => {
            const sl = STATUS_LABEL[t.status] || STATUS_LABEL.config;
            return (
              <div
                key={t.id}
                style={{
                  border: "1px solid #eef0f2",
                  borderRadius: 10,
                  padding: 10,
                  background: "#fff",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 6,
                  }}
                >
                  <span
                    onClick={() => focusCard(t.id)}
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "#16181d",
                      cursor: "pointer",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: 170,
                    }}
                    title="点击定位到画布上的卡片"
                  >
                    {t.name || "未命名"} · {t.mode}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: "#fff",
                      background: sl.color,
                      borderRadius: 999,
                      padding: "2px 8px",
                      flexShrink: 0,
                    }}
                  >
                    {sl.text}
                    {t.status === "generating" && t.progress ? ` ${t.progress}%` : ""}
                  </span>
                </div>

                {/* 进度条 */}
                {t.status === "generating" && (
                  <div
                    style={{
                      height: 3,
                      borderRadius: 999,
                      background: "#eef0f2",
                      overflow: "hidden",
                      marginBottom: 8,
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${t.progress || 0}%`,
                        background: "#8b5cf6",
                        transition: "width 0.4s ease",
                      }}
                    />
                  </div>
                )}

                {/* 错误信息 */}
                {t.status === "error" && t.error && (
                  <div
                    style={{
                      fontSize: 11,
                      color: "#ef4444",
                      background: "#fef2f2",
                      borderRadius: 6,
                      padding: "6px 8px",
                      marginBottom: 8,
                      wordBreak: "break-all",
                      maxHeight: 80,
                      overflow: "auto",
                    }}
                  >
                    {t.error}
                  </div>
                )}

                {/* 提示词（可复制） */}
                {t.prompt && (
                  <div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "#475569",
                        lineHeight: 1.5,
                        background: "#f8fafc",
                        borderRadius: 6,
                        padding: "6px 8px",
                        maxHeight: 72,
                        overflow: "auto",
                        wordBreak: "break-word",
                      }}
                    >
                      {t.prompt}
                    </div>
                    <button
                      onClick={() => copyPrompt(t.id, t.prompt)}
                      style={{
                        marginTop: 6,
                        height: 26,
                        width: "100%",
                        borderRadius: 6,
                        border: "1px solid #e5e7eb",
                        background: copiedId === t.id ? "#10b981" : "#fff",
                        color: copiedId === t.id ? "#fff" : "#475569",
                        fontSize: 11,
                        cursor: "pointer",
                        transition: "all 0.15s",
                      }}
                    >
                      {copiedId === t.id ? "✓ 已复制" : "复制提示词"}
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
