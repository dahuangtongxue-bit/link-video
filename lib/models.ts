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

// 文生图分辨率档位。豆包全系下限 3686400 像素（2560x1440），1K 不够格，直接不提供。
export const IMAGE_SIZES: ModelOption[] = [
  { id: "2K", label: "2K" },
  { id: "4K", label: "4K" },
];

// 文生图画面比例。决定生成图的形状，进而决定图生视频（adaptive 跟随首帧）的视频比例。
export const IMAGE_RATIOS: ModelOption[] = [
  { id: "16:9", label: "16:9 横屏" },
  { id: "9:16", label: "9:16 竖屏" },
  { id: "1:1", label: "1:1 方形" },
  { id: "4:3", label: "4:3" },
  { id: "3:4", label: "3:4" },
  { id: "21:9", label: "21:9 宽幅" },
];

// 档位 × 比例 → 实际生成尺寸（宽x高，发给平台的 size 字段）。
// 约束：豆包全系像素下限 3,686,400；单边上限 4096。下表各项均已满足，且为精确比例、边长对齐到 16。
// 注意：.netlify/functions/image-gen-background.mjs 内联了同一张表，改这里记得同步那边。
const SIZE_TABLE: Record<string, Record<string, string>> = {
  "2K": {
    "16:9": "2816x1584",
    "9:16": "1584x2816",
    "1:1": "2048x2048",
    "4:3": "2304x1728",
    "3:4": "1728x2304",
    "21:9": "2940x1260",
  },
  "4K": {
    "16:9": "4096x2304",
    "9:16": "2304x4096",
    "1:1": "4096x4096",
    "4:3": "4096x3072",
    "3:4": "3072x4096",
    "21:9": "4095x1755",
  },
};

export function imageSize(tier?: string, ratio?: string): string {
  const t = String(tier || "2K").toUpperCase();
  const r = String(ratio || "16:9");
  const tierTable = SIZE_TABLE[t] || SIZE_TABLE["2K"];
  return tierTable[r] || tierTable["16:9"] || "2816x1584";
}

// 图生视频（Seedance 2.0）
export const VIDEO_MODELS: ModelOption[] = [
  { id: "doubao-seedance-2-0-260128", label: "Seedance 2.0" },
  { id: "doubao-seedance-2-0-fast-260128", label: "Seedance 2.0 Fast" },
];
