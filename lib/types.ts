import type { TLBaseShape } from "tldraw";

// 提示词卡片：输入文字 + 选图片模型/分辨率 -> 生成图片
export type PromptShape = TLBaseShape<
  "prompt-card",
  {
    w: number;
    h: number;
    name: string;
    prompt: string;
    imageModel: string;
    size: string; // 1K / 2K / 4K
  }
>;

// 图片卡片：来自文生图结果，或用户上传
export type ImageShape = TLBaseShape<
  "image-card",
  {
    w: number;
    h: number;
    name: string;
    prompt: string; // 生成它的提示词（上传的为空）
    model: string; // 生成它的模型
    videoModel: string; // 下一步图生视频要用的模型
    motion: string; // 图生视频的运动提示词
    videoResolution: string; // 480p / 720p / 1080p
    videoDuration: string; // 秒数，如 "5"
    videoRatio: string; // adaptive / 16:9 / 9:16 / 1:1 / 4:3 / 3:4
    status: string; // generating | done | error
    imageUrl: string;
    error: string;
  }
>;

// 视频卡片：来自图生视频，或工具栏「生成视频」直接创建（config 配置态）
export type VideoShape = TLBaseShape<
  "video-card",
  {
    w: number;
    h: number;
    name: string;
    prompt: string;
    model: string;
    status: string; // config | submitting | generating | done | error
    taskId: string;
    videoUrl: string;
    progress: number;
    error: string;
    firstImageUrl: string; // 首帧（config 态选择）
    lastImageUrl: string; // 尾帧（可选）
    referenceImageUrl: string; // 参考图（旧单字段，保留兼容）
    referenceImageUrls: string[]; // 多参考图（角色/物体/场景一致性），最多 9 张
    sourceVideoUrl: string; // 源视频（延续 / 编辑）
    resolution: string; // 480p / 720p / 1080p
    duration: string; // 秒数 "3"~"10"
    ratio: string; // adaptive / 16:9 / 9:16 / 1:1 / 4:3 / 3:4
  }
>;
