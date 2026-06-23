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
    size: string; // 2K / 4K（清晰度档）
    ratio: string; // 16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9（画面比例 → 决定下游视频比例）
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

// 镜头卡：电影流水线的原子单位。结构化旋钮(景别/运镜/光线/质感/色调/时长) + 画面内容，
// 旋钮自动拼成 Seedance 提示词。「生参考帧」→ 下方生出图片卡；「生视频」→ 右侧生出视频卡。
export type ShotShape = TLBaseShape<
  "shot-card",
  {
    w: number;
    h: number;
    shotNo: string; // 镜号，如 "01"
    title: string; // 镜头标题
    shotSize: string; // 景别（存提示词片段，空=自动）
    cameraMove: string; // 运镜
    light: string; // 光线/时间
    texture: string; // 质感/风格（参考帧用）
    color: string; // 色彩调性（参考帧用）
    duration: string; // 时长秒
    content: string; // 画面内容（核心提示词）
    imageModel: string; // 生参考帧用的图像模型
    size: string; // 参考帧分辨率 2K / 4K
    ratio: string; // 参考帧比例 16:9 / 9:16 / ...（决定首帧形状 → 视频比例）
    videoModel: string; // 生视频用的视频模型
    srcImageUrl: string; // 图生图源图（画布上选中的图片，可选）：有值则生关键帧走图生图
    refFrameUrl: string; // 已生成的参考帧 URL（用作首帧）
    status: string; // idle（镜头卡本身只是控制器）
  }
>;
