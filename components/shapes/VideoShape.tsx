"use client";

import { useEffect, useRef } from "react";
import { BaseBoxShapeUtil, HTMLContainer, T, useEditor } from "tldraw";
import type { VideoShape } from "@/lib/types";
import { pollVideoUntilDone } from "@/lib/maas";
import { TOKENS, cardShell, labelStyle } from "./cardStyles";

function VideoCard({ shape }: { shape: VideoShape }) {
  const editor = useEditor();
  const startedRef = useRef(false);
  const { status, taskId, videoUrl, progress, error, model, w, h } = shape.props;
  const shapeId = shape.id;

  // 轮询：组件挂载时若任务还在跑就开始（刷新页面后也能续上）
  useEffect(() => {
    if (startedRef.current) return;
    if (status !== "generating" || !taskId || videoUrl) return;

    startedRef.current = true;
    let cancelled = false;
    const alive = () => !cancelled && !!editor.getShape(shapeId);

    (async () => {
      try {
        const url = await pollVideoUntilDone(
          taskId,
          model,
          (p) => {
            if (alive() && typeof p === "number") {
              editor.updateShape<VideoShape>({
                id: shapeId,
                type: "video-card",
                props: { progress: p },
              });
            }
          },
          () => !alive()
        );
        if (alive()) {
          editor.updateShape<VideoShape>({
            id: shapeId,
            type: "video-card",
            props: { status: "done", videoUrl: url, progress: 100 },
          });
        }
      } catch (e: any) {
        if (alive()) {
          editor.updateShape<VideoShape>({
            id: shapeId,
            type: "video-card",
            props: { status: "error", error: String(e?.message || e) },
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, taskId]);

  return (
    <HTMLContainer>
      <div style={cardShell(TOKENS.video, w, h)}>
        <div style={{ padding: "10px 12px 0" }}>
          <span style={labelStyle}>视频 · 图生视频</span>
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
              生成失败：{error}
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
  };

  getDefaultProps(): VideoShape["props"] {
    return {
      w: 320,
      h: 300,
      prompt: "",
      model: "",
      status: "submitting",
      taskId: "",
      videoUrl: "",
      progress: 0,
      error: "",
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
