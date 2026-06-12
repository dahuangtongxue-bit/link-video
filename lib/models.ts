// 模型清单。中文名写在代码里（不要塞进 env，Netlify 上中文环境变量会乱码）。
// id = 发给平台的真实模型调用名（取自 零克云 模型广场，注意带日期后缀）。
// label = 界面显示名。一个能力下可挂多个，界面会出下拉。

export interface ModelOption {
  id: string;
  label: string;
}

// 文生图（豆包图像 Seedream）——默认 5.0，质量更好
export const IMAGE_MODELS: ModelOption[] = [
  { id: "doubao-seedream-5-0-260128", label: "豆包图像 · Seedream 5.0" },
  { id: "doubao-seedream-4-5-251128", label: "豆包图像 · Seedream 4.5" },
  { id: "doubao-seedream-4-0-250828", label: "豆包图像 · Seedream 4.0" },
];

// 文生图分辨率档位（具体哪档可用以平台支持为准；不支持时错误会显示在卡片上）
export const IMAGE_SIZES: ModelOption[] = [
  { id: "1K", label: "1K" },
  { id: "2K", label: "2K" },
  { id: "4K", label: "4K" },
];

// 图生视频（Seedance 2.0）
export const VIDEO_MODELS: ModelOption[] = [
  { id: "doubao-seedance-2-0-260128", label: "Seedance 2.0" },
  { id: "doubao-seedance-2-0-fast-260128", label: "Seedance 2.0 Fast" },
];
