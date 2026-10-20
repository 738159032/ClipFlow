# ClipFlow



商品 3D 展示与短视频制作工具。浏览器内完成「上传 GLB → 套模板 → 加图文 → 导出 MP4」。



**当前状态：阶段 0（工程初始化 + 关键技术验证）已完成；阶段 1 的图层交互已落地。** 验证台为 `/lab`。

已可用：GLB 加载与自动定框、材质/灯光/模板、参数化动画、2D 图层（文字/价格/水印/**图片**）、
**图层的点选 / 拖动 / 四角缩放 / 键盘微调**、**图片素材上传（PNG/JPEG/WEBP，≤50MB，点击或拖拽）**、
**6 个模板卡片的选型流程 + 可见的工作流状态机**（素材 → 模板 → 编辑 → 预览 → 导出）、
实时合成、PNG 静帧与 MP4 导出。图片素材既能做 2D 图层，也能作为商品 baseColor 贴图（沿用模型自带 UV）。



## 快速开始



```bash

npm install

npm run dev            # http://localhost:3000  →  进入 /lab

```



需要桌面版 Chrome / Edge（WebCodecs H.264 编码）。移动端未验证。



## 常用命令



| 命令 | 作用 |

|---|---|

| `npm run dev` | 开发服务器（3000） |

| `npm run build` / `npm run start` | 生产构建 / 启动 |

| `npm run typecheck` | `tsc --noEmit` |

| `npm run lint` | ESLint（flat config） |

| `npm run test` | Vitest 纯逻辑单测（坐标、时间轴、MP4 解析、场景资源） |

| `npm run test:e2e` | Playwright + 本地 Chrome，真实渲染并导出 MP4（先 `npm run build`） |

| `npm run verify` | typecheck + lint + test + build |



e2e 需要先用 `npm run build` 生成产物，它会自动在 3100 端口启动 `next start`。

验证产物（静帧 PNG、MP4、解码帧、JSON 报告）写入 `.verification/`（已 gitignore，可重复生成）。



## 目录



```

src/app/            路由（/ 概览页，/lab 验证台，/api/health）

src/components/lab/     左侧检查器、右侧导出面板

src/components/stage/   舞台：3D Canvas + 2D 覆盖层 + 时间轴

src/components/scene/   灯光、环境、模型、相机、导出桥

src/lib/                纯逻辑：坐标、时间轴、图层光栅器、编码、MP4 校验

src/store/              编辑器状态（zustand）

tests/unit  tests/e2e

docs/                   PRD / ARCHITECTURE / DECISIONS / TASKS / ACCEPTANCE

```



## 文档



- [AGENTS.md](AGENTS.md) — 编码与验收规则

- [docs/PRD.md](docs/PRD.md) — 产品目标与 MVP 范围

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 模块边界、数据流、资源生命周期

- [docs/DECISIONS.md](docs/DECISIONS.md) — 技术选型、备选方案与风险

- [docs/TASKS.md](docs/TASKS.md) — 阶段计划与待办

- [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md) — 验收标准与真实验证结果



## 示例资源



`public/models/astronaut.glb` 来自 modelviewer.dev 公开示例，仅用于阶段 0 的技术验证；商用前必须替换为自有商品模型。

