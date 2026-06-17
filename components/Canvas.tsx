"use client";

import { useRef, useState, useCallback } from "react";
import {
  Tldraw,
  DefaultToolbar,
  TldrawUiMenuItem,
  useIsToolSelected,
  useTools,
  type Editor,
  type TLComponents,
  createShapeId,
} from "tldraw";
import "tldraw/tldraw.css";
import { PromptShapeUtil } from "./shapes/PromptShape";
import { ImageShapeUtil } from "./shapes/ImageShape";
import { VideoShapeUtil } from "./shapes/VideoShape";
import TaskPanel from "./TaskPanel";
import { rehostImage } from "@/lib/maas";

const customShapeUtils = [PromptShapeUtil, ImageShapeUtil, VideoShapeUtil];

// 底部工具栏只留「选择 + 抓手」两个工具，其余画笔/橡皮/文字等全部收掉
function MinimalToolbar() {
  const tools = useTools();
  const isSelect = useIsToolSelected(tools["select"]);
  const isHand = useIsToolSelected(tools["hand"]);
  return (
    <DefaultToolbar>
      <TldrawUiMenuItem {...tools["select"]} isSelected={isSelect} />
      <TldrawUiMenuItem {...tools["hand"]} isSelected={isHand} />
    </DefaultToolbar>
  );
}

// 收掉官方主菜单/分享面板/右侧样式面板，底部工具栏精简为两键
const components: TLComponents = {
  MenuPanel: null,
  StylePanel: null,
  Toolbar: MinimalToolbar,
  InFrontOfTheCanvas: TaskPanel,
};

export default function Canvas() {
  const editorRef = useRef<Editor | null>(null);
  const [ready, setReady] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const onMount = useCallback((editor: Editor) => {
    editorRef.current = editor;

    // 清扫「孤儿箭头」：两头没有都连着卡片的箭头一律清除
    const sweepOrphanArrows = () => {
      const arrows = editor.getCurrentPageShapes().filter((s) => s.type === "arrow");
      const orphans = arrows.filter(
        (a) => editor.getBindingsFromShape(a.id, "arrow").length < 2
      );
      if (orphans.length) editor.deleteShapes(orphans.map((s) => s.id));
    };

    // 删除任何卡片后，下一拍自动清扫一次。
    // 注：tldraw 删卡时会“先”拆掉箭头绑定、“后”触发删除钩子，
    // 所以不能在删除钩子里按绑定找箭头，而是事后统一清扫。
    let sweepScheduled = false;
    editor.sideEffects.registerAfterDeleteHandler("shape", (shape) => {
      if (shape.type === "arrow") return;
      if (sweepScheduled) return;
      sweepScheduled = true;
      setTimeout(() => {
        sweepScheduled = false;
        sweepOrphanArrows();
      }, 0);
    });

    // 打开画布先清一遍历史遗留
    sweepOrphanArrows();

    setReady(true);
  }, []);

  function centerPoint(editor: Editor) {
    const b = editor.getViewportPageBounds();
    return { x: b.center.x, y: b.center.y };
  }

  function addPromptCard() {
    const editor = editorRef.current;
    if (!editor) return;
    const c = centerPoint(editor);
    const id = createShapeId();
    editor.createShape({
      id,
      type: "prompt-card",
      x: c.x - 150,
      y: c.y - 115,
      props: {},
    });
    editor.select(id);
  }

  // 「生成视频」：直接放一张配置态的视频卡（选首尾帧、清晰度、秒数、模型后生成）
  function addVideoCard() {
    const editor = editorRef.current;
    if (!editor) return;
    const c = centerPoint(editor);
    const id = createShapeId();
    editor.createShape({
      id,
      type: "video-card",
      x: c.x - 170,
      y: c.y - 310,
      props: { w: 340, h: 656, status: "config" },
    });
    editor.select(id);
  }

  // 上传图压缩：长边压到 1600px、转 JPEG。
  // 手机原图几 MB 的 base64 会压垮提交链路（Netlify 6MB 上限 + 网关拒收），
  // 压缩后一般只有 200~500KB，直传 base64 没问题（网关原样转发给火山引擎）。
  async function fileToCompressedDataUrl(file: File): Promise<string> {
    const rawUrl: string = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string);
      r.onerror = () => rej(new Error("读取文件失败"));
      r.readAsDataURL(file);
    });
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("图片解析失败（HEIC 等格式请先转成 JPG/PNG）"));
      i.src = rawUrl;
    });
    const draw = (maxEdge: number, quality: number) => {
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("浏览器不支持画布压缩");
      ctx.fillStyle = "#ffffff"; // PNG 透明底转 JPEG 时垫白，避免变黑
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      return canvas.toDataURL("image/jpeg", quality);
    };
    let out = draw(1600, 0.85);
    if (out.length > 2_500_000) out = draw(1280, 0.75); // 仍偏大就再压一档
    return out;
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const editor = editorRef.current;
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!editor || !file) return;
    fileToCompressedDataUrl(file)
      .then(async (dataUrl) => {
        const c = centerPoint(editor);
        const id = createShapeId();
        // 先建卡占位（先用本地图显示，避免等待）
        editor.createShape({
          id,
          type: "image-card",
          x: c.x - 160,
          y: c.y - 200,
          props: { status: "done", imageUrl: dataUrl, prompt: "(上传)" },
        });
        editor.select(id);
        // 后台转存到 ImgBB 拿永久 URL：上传图(base64)平台不认，转存后才能做参考图/首尾帧
        try {
          const permanent = await rehostImage(dataUrl);
          if (permanent && editor.getShape(id)) {
            editor.updateShape({ id, type: "image-card", props: { imageUrl: permanent } });
          }
        } catch {
          // 转存失败就保留本地图（仍可看，只是不能做参考图/首尾帧）
        }
      })
      .catch((err) => {
        window.alert(String(err?.message || err));
      });
  }

  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column" }}>
      <header
        style={{
          height: 52,
          flexShrink: 0,
          background: "#0f1115",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "0 16px",
          zIndex: 300,
          fontFamily: "system-ui, -apple-system, 'Segoe UI', 'PingFang SC', sans-serif",
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: 0.3 }}>
          AI 画布工作台
        </span>
        <span
          style={{
            fontSize: 11,
            color: "#9ca3af",
            fontFamily: "ui-monospace, Menlo, monospace",
          }}
        >
          文字 → 图片 → 视频
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={addPromptCard} disabled={!ready} style={barBtn("#6366f1", ready)}>
          + 文生图片
        </button>
        <button onClick={() => fileRef.current?.click()} disabled={!ready} style={barBtn("#10b981", ready)}>
          + 上传图片
        </button>
        <button onClick={addVideoCard} disabled={!ready} style={barBtn("#8b5cf6", ready)}>
          + 生成视频
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={onPickFile}
        />
      </header>

      <div style={{ flex: 1, position: "relative" }}>
        <Tldraw
          persistenceKey="ai-canvas-v2"
          shapeUtils={customShapeUtils}
          components={components}
          onMount={onMount}
        />
      </div>
    </div>
  );
}

function barBtn(color: string, enabled: boolean): React.CSSProperties {
  return {
    appearance: "none",
    border: "none",
    borderRadius: 8,
    padding: "8px 14px",
    fontSize: 13,
    fontWeight: 600,
    color: "#fff",
    background: enabled ? color : "#374151",
    cursor: enabled ? "pointer" : "default",
    fontFamily: "system-ui, -apple-system, sans-serif",
  };
}
