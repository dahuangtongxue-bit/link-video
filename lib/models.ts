// 模型清单。中文名写在代码里（不要塞进 env，Netlify 上中文环境变量会乱码）。
// id = 发给平台的真实模型调用名，务必去 零克云「模型广场」核对！
//      （下面是按豆包/Seedance 命名猜的，不一定和平台完全一致）
// label = 界面显示名。一个能力下可挂多个，界面会出下拉。

export interface ModelOption {
  id: string;
  label: string;
}

// 文生图（豆包图像 Seedream）
export const IMAGE_MODELS: ModelOption[] = [
  { id: "doubao-seedream-4-0", label: "豆包图像 · Seedream" }, // ← 去模型广场核对真实调用名
];

// 图生视频（Seedance 2.0）
export const VIDEO_MODELS: ModelOption[] = [
  { id: "doubao-seedance-2-0", label: "Seedance 2.0" }, // ← 去模型广场核对真实调用名
];
