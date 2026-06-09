# AI 画布工作台

一个 tldraw 无限画布：文字生成图片，图片（或上传的图片）再生成视频。卡片可自由拖放，自动连线表示血缘。Next.js 14 + tldraw，可直接部署到 Netlify。

## 先跑起来（mock 模式，30 秒）

```bash
npm install
npm run dev
```

打开 http://localhost:3000 ，点顶部「+ 文本生成图片」放一张提示词卡，输入文字点「生成图片」，图片卡出现后点「生成视频」。**没配任何 key 的情况下默认走 mock**：图片用占位图，视频用一段示例片，但异步轮询是真的，方便你先把交互体验跑顺。

## 接你的平台（改 3 个文件 + 填 env）

1. 复制 `.env.example` 为 `.env.local`。零克云这种「一个平台 + 一个无限制 key」的情况，填这两个就够（图片、视频共用）：
   ```
   MAAS_BASE_URL=https://api-model.gpulink.cc   # 按你控制台/文档的实际 API 地址
   MAAS_API_KEY=sk-你的key
   ```
   只有当图生视频在另一个平台/另一个 key 时，才额外填 `MAAS_VIDEO_BASE_URL` / `MAAS_VIDEO_API_KEY`（留空就复用上面的）。图片和视频**各自独立判断 mock**，配齐哪个哪个就走真实。

2. 三个 route 已按**豆包图像 + Seedance 2.0 的公开标准格式**预接好（不是空 TODO，是基本能用的版本）。若 零克云 文档的 path/字段不同，按代码里标了 `←` 的几行核对即可：
   - `app/api/image/route.ts` —— 豆包图像（OpenAI 兼容同步接口，取 `data[0].url`）
   - `app/api/video/submit/route.ts` —— Seedance 创建任务（异步，`/api/v3/contents/generations/tasks`，content 数组，返回 id）
   - `app/api/video/poll/route.ts` —— Seedance 查询任务（按状态映射 done/pending/error，出片取 `content.video_url`）

3. 模型名清单在 `lib/models.ts`，把 `id` 换成你平台的真实模型名（文生图 / 图生视频各一个列表，界面上分别下拉。中文显示名写在这里，不要塞 env，Netlify 上中文环境变量会乱码）。

> 关键的 key 只在服务端（`/api` 路由）使用，前端永远拿不到，朋友用也安全。

## 给朋友用：加访问口令

在 env 里设 `ACCESS_PASSWORD=某个口令`，前端打开时就要先输入它才能调生成接口，防止额度被陌生人刷。留空 = 不设防。

## 部署到 Netlify

照你平时的 Next 流程推上去即可。在 Netlify 后台 → Site settings → Environment variables 配上 `MAAS_BASE_URL` / `MAAS_API_KEY` / `ACCESS_PASSWORD`（都是 ASCII，没有中文乱码问题）。视频若用不同平台再加 `MAAS_VIDEO_BASE_URL` / `MAAS_VIDEO_API_KEY`。

## 几个要知道的点

- **视频是异步任务**：本项目按「提交拿 task_id → 前端每 4 秒轮询」实现，每次函数调用都很短，不会撞 serverless 超时。如果你平台的「提交」接口是一直阻塞到出片（不返回 task_id），告诉我，那种要换成后台函数写法。
- **生成结果的 URL 可能会过期**：很多平台返回临时链接，画布里的图/视频隔几天可能裂掉。要长期保存，需要在 `/api` 路由里把结果转存到对象存储（R2/S3/Netlify Blobs）再返回永久地址 —— 需要的话我帮你加。
- **画布数据存在浏览器本地**（tldraw 的 `persistenceKey`，走 IndexedDB），换设备/清缓存会丢。要做多人共享画布或云端保存，得加后端（Supabase 最省事）。
- **额度保护**：当前只有口令 + 按钮防连点。要做"每人每天 N 次"这种硬配额，需要一个 KV（Upstash/Netlify Blobs）记次数，需要的话我加。
- **刷新续传**：图生视频刷新页面后会自动继续轮询；文生图刷新时若还没返回，那张图卡会停在"生成中"。

## 文件地图

```
app/
  page.tsx                客户端壳：口令门 + 画布
  layout.tsx / globals.css
  api/
    auth/route.ts         口令校验
    image/route.ts        文生图（改这里接平台）
    video/submit/route.ts 图生视频-提交（改这里）
    video/poll/route.ts   图生视频-查询（改这里）
components/
  Canvas.tsx              tldraw 编辑器 + 顶部工具条
  Gate.tsx               口令门
  shapes/                三种卡片（提示词/图片/视频）
lib/
  maas.ts                前端调用封装
  models.ts              模型清单（改这里）
  types.ts / connect.ts / serverAuth.ts
```
