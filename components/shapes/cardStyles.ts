import type { CSSProperties } from "react";

// 设计令牌：克制的工作台风格，用顶部色条编码卡片类型（提示词/图片/视频）。
export const TOKENS = {
  ink: "#16181d",
  muted: "#6b7280",
  border: "#e5e7eb",
  surface: "#ffffff",
  prompt: "#6366f1", // 靛蓝
  image: "#10b981", // 翠绿
  video: "#8b5cf6", // 紫
  error: "#ef4444",
  mono: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
  sans: "system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
};

// 卡片外壳：白底、圆角、柔和阴影、顶部一条类型色。
export function cardShell(accent: string, w: number, h: number): CSSProperties {
  return {
    width: w,
    height: h,
    boxSizing: "border-box",
    background: TOKENS.surface,
    // 整圈边框用类型色，一眼区分提示词/图片/视频；顶部更粗
    border: `2px solid ${accent}`,
    borderTop: `4px solid ${accent}`,
    borderRadius: 12,
    boxShadow: `0 6px 20px ${accent}22`,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    fontFamily: TOKENS.sans,
    color: TOKENS.ink,
    // 整体不接管指针：空白处可拖动卡片；具体控件再各自打开 pointerEvents
    pointerEvents: "none",
  };
}

// 控件通用：打开指针 + 阻止冒泡，避免点控件时触发画布拖拽
export const interactive = {
  style: { pointerEvents: "all" } as CSSProperties,
  onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
};

export const labelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: 0.4,
  textTransform: "uppercase",
  color: TOKENS.muted,
  fontFamily: TOKENS.mono,
};

export function primaryBtn(accent: string, disabled = false): CSSProperties {
  return {
    pointerEvents: "all",
    appearance: "none",
    border: "none",
    borderRadius: 8,
    padding: "8px 12px",
    fontSize: 13,
    fontWeight: 600,
    fontFamily: TOKENS.sans,
    color: "#fff",
    background: disabled ? "#cbd5e1" : accent,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

// 卡片名称输入框：低调、像标题不像表单，聚焦时才显边框
export const nameInputStyle: CSSProperties = {
  pointerEvents: "all",
  border: "1px solid transparent",
  borderRadius: 6,
  padding: "2px 6px",
  marginLeft: 8,
  fontSize: 12,
  fontWeight: 600,
  fontFamily: TOKENS.sans,
  color: TOKENS.ink,
  background: "transparent",
  outline: "none",
  flex: 1,
  minWidth: 0,
};

// 卡外名称行容器：绝对定位到卡片左上角外侧（卡片上方），不占用卡内空间
export const outerNameRowStyle: CSSProperties = {
  position: "absolute",
  top: -26,
  left: 2,
  right: 2,
  height: 22,
  display: "flex",
  alignItems: "center",
  pointerEvents: "none", // 容器不挡，内部 input 单独开 all
};

// 卡外名称输入框：透明、像标题，聚焦/悬停时给个浅底
export const outerNameInputStyle: CSSProperties = {
  pointerEvents: "all",
  border: "1px solid transparent",
  borderRadius: 6,
  padding: "1px 6px",
  fontSize: 12,
  fontWeight: 600,
  fontFamily: TOKENS.sans,
  color: TOKENS.ink,
  background: "transparent",
  outline: "none",
  maxWidth: "100%",
  minWidth: 60,
};

export const selectStyle: CSSProperties = {
  pointerEvents: "all",
  appearance: "none",
  border: `1px solid ${TOKENS.border}`,
  borderRadius: 8,
  padding: "6px 8px",
  fontSize: 12,
  fontFamily: TOKENS.mono,
  color: TOKENS.ink,
  background: "#fff",
  maxWidth: "100%",
};

export const textAreaStyle: CSSProperties = {
  pointerEvents: "all",
  width: "100%",
  boxSizing: "border-box",
  resize: "none",
  border: `1px solid ${TOKENS.border}`,
  borderRadius: 8,
  padding: 8,
  fontSize: 13,
  lineHeight: 1.45,
  fontFamily: TOKENS.sans,
  color: TOKENS.ink,
  outline: "none",
};
