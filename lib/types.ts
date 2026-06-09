import type { TLBaseShape } from "tldraw";

// 提示词卡片：输入文字 + 选图片模型 -> 生成图片
export type PromptShape = TLBaseShape<
  "prompt-card",
  {
    w: number;
    h: number;
    prompt: string;
    imageModel: string;
  }
>;

// 图片卡片：来自文生图结果，或用户上传
export type ImageShape = TLBaseShape<
  "image-card",
  {
    w: number;
    h: number;
    prompt: string; // 生成它的提示词（上传的为空）
    model: string; // 生成它的模型
    videoModel: string; // 下一步图生视频要用的模型
    motion: string; // 图生视频的运动提示词
    status: string; // generating | done | error
    imageUrl: string;
    error: string;
  }
>;

// 视频卡片：来自图生视频
export type VideoShape = TLBaseShape<
  "video-card",
  {
    w: number;
    h: number;
    prompt: string;
    model: string;
    status: string; // submitting | generating | done | error
    taskId: string;
    videoUrl: string;
    progress: number;
    error: string;
  }
>;
