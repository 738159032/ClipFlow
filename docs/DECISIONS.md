# DECISIONS

记录关键技术决策、被否方案与风险。状态字段只写**实测**结果：`已验证` / `未通过` / `待验证`。

| # | 决策 | 状态 |
|---|---|---|
| D1 | Next.js 15.5（App Router）+ React 19 + TS strict | 已验证（build 通过） |
| D2 | 3D 用 `@react-three/fiber`，不手写 renderer 生命周期 | 已验证 |
| D3 | 导出复用**同一个** R3F renderer（改 drawing buffer 尺寸），不新建第二个 renderer | 已验证（静帧/MP4 抽帧一致） |
| D4 | 2D 图层用**单一 Canvas2D 光栅器**同时服务预览与导出，不用 DOM/CSS 预览 | 已验证 |
| D5 | 视频编码：WebCodecs `VideoEncoder`(avc1) + `mp4-muxer`，失败即报错，不降级 WebM | 已验证（真实 MP4 + 浏览器播放） |
| D6 | 图层坐标归一化（0–1）+ 设计基准宽 1080 | 已验证（单测） |
| D7 | GLB 用命令式 `GLTFLoader` + 显式 dispose，不用 `useGLTF` 缓存 | 已验证 |
| D8 | 模板 = 单向风格 patch，用户修改后脱离模板 | 已验证 |
| D9 | 阶段 0 不使用 Worker / OffscreenCanvas 编码 | 已验证够用：57ms/帧 @1080p |
| D10 | 阶段 0 不做工程持久化 | 有意延后 |
| D11 | 示例模型随仓库提供（`public/models/astronaut.glb`），仅用于验证 | 已验证 |
| D12 | 图层交互：自研（捕获式命中测试 + DOM 选择框），不引入 Konva/Pixi | 已验证（单测 + e2e） |
| D13 | 图片素材：浏览器内存 + 元数据/运行时分离；两条消费路径（2D 图层 / 商品贴图） | 已验证（11 条 e2e） |
| D14 | 模板画廊 + 显式工作流状态机；预览快照作为导出前置；不写 localStorage | 已验证（6 模板 / 6 条 e2e） |

---

## D1 · 框架版本：Next.js 15.5 而不是 16

- **背景**：仓库为空，需新建工程。当前 npm 上最新为 Next 16.4。
- **选择**：`next@15.5.28` + `react@19.3`。
- **理由**：R3F 9 在 Next 15 上有大量生产验证；Next 16 默认 Turbopack 构建对 three 体量大的 ESM 图仍有偶发问题。阶段 0 的目标是"可靠的开发基础"，不是"最新版本"。
- **备选**：Next 16（更新，风险高）；Vite + React（更轻，但失去 App Router/服务端路由能力）。
- **风险**：落后一个大版本；阶段 2 前需评估升级成本。
- **实测**：`next build` 通过，`next start` 可服务页面。

## D2 · 3D 框架：R3F（不引入 drei）

- **选择**：`@react-three/fiber@9` + `three` 官方 addon（`OrbitControls`、`RoomEnvironment`）+ 内置 `shadowMaterial`。
- **理由**：声明式描述 scene graph，组件卸载即资源回收语义清晰；`useThree` 能拿到 `gl/scene/camera`，让导出器"借用"同一渲染器成为可能。
- **为什么不用 drei**：阶段 0 只需要 OrbitControls 与接触阴影，而 drei 会连带安装 `three-stdlib`、`rapier3d`、`mediapipe`、`hls.js` 等重量级可选依赖（本次实测安装体积/时间显著上升）。用官方 addon 手写 ~40 行即可，依赖更可控。
- **备选**：原生 three + 自管生命周期（样板代码多，React 状态同步容易出错）。
- **风险**：R3F 与 React 版本强耦合；升级 React 需同步升级 R3F。
- **实测**：Canvas 挂载、OrbitControls、方向光阴影均正常。

## D3 · 导出复用同一个 renderer

- **背景**：导出需要 1080×1920 的帧，而预览 canvas 只有几百像素。
- **选择**：`gl.setPixelRatio(1)` + `gl.setSize(w,h,false)` 临时切换 drawing buffer，逐帧 `gl.render(scene,camera)` 后立刻 `drawImage` 到合成 canvas，结束后恢复。CSS 尺寸不变（`updateStyle=false`），用遮罩隐藏形变。
- **理由**：零分叉。场景、相机、灯光、材质、动画全部天然一致。
- **备选**：
  - 新建离屏 `WebGLRenderer` 复制场景：显存翻倍、需维护两套材质，且 GLB 资源要 clone，容易与预览不一致。
  - `canvas.captureStream()` + MediaRecorder：非确定性时间戳，不能精确控制帧数。
- **风险**：导出期间预览 canvas 的绘制缓冲被改变；若用户在导出中拖拽相机会污染帧。当前遮罩只覆盖视觉，鼠标事件仍可能落到 canvas 上（阶段 1 需用 `pointer-events` 彻底阻断）。
- **实测**：`.verification/still.png`（预览侧合成）与 `.verification/mp4-frame.png`（从 MP4 解码的第 2.1s 帧）构图、图层位置一致。

## D4 · 单一 Canvas2D 光栅器

- **选择**：预览图层不是 DOM，而是一张与舞台同尺寸的 canvas；`drawLayers()` 同时被预览和导出调用。
- **理由**：DOM 文本与 Canvas2D 文本的度量不同（字距、字重、回退字体、连字）。如果预览用 DOM、导出用 Canvas，导出必然出现错位，且难以自动比对。
- **备选**：
  - DOM 覆盖层 + `html2canvas`：依赖布局与字体加载时机，跨浏览器不稳定。
  - DOM 覆盖层 + SVG foreignObject 截图：Chrome 限制外部字体。
- **代价**：图层编辑不能直接点选拖拽（阶段 0 用属性面板），文字不能就地输入。
- **风险**：与设计稿（Figma）字距有 1–2px 级差异；解决方案是后续引入统一字体文件并固定字距策略。
- **实测**：预览与导出的 `drawLayers` 是同一函数、同一 stage 尺寸，位置逐像素一致。

## D5 · 编码方案

- **主选**：`VideoEncoder`（`avc1.640028` / `4d0028` / `42e01f`，按能力降级）+ `mp4-muxer`（`fastStart: 'in-memory'`，`codec: 'avc'`）。
- **备选 1**：`MediaRecorder` + `video/mp4;codecs=avc1`（Safari 可用；Chrome 视版本/平台而定）。作为**第二候选**在能力面板中探测展示，未作为默认路径。
- **备选 2**：服务端 ffmpeg / ffmpeg.wasm。前者违背"纯前端出片"，后者体积大（~30MB）且性能差。
- **明确拒绝**：录制 WebM 后改扩展名为 `.mp4`，或用静态图 + 假进度条模拟导出。这类做法在验收中视为**失败**。
- **约束**：H.264 要求宽高为偶数（代码已强制校验）；`VideoEncoder` 的 `isConfigSupported` 必须在目标浏览器实测，不能假设。
- **风险**：Chromium 无专有编解码器（部分 Linux/自动化环境）时不可用；此时 UI 明确报"无可用 H.264 编码器"，而不是产出坏文件。
- **实测（Chrome 155 / Windows）**：High@L4.0 与 Main@L4.0 支持，Baseline@L3.1 返回不支持；导出 1080×1920@30fps/5s 得到 `moov` + `mdat` 的 4.86MB MP4，`<video>` `readyState=4` 且可 seek，抽帧确认 2D 文字与 3D 主体均已编码。编码耗时 8.5s / 150 帧 ≈ 57ms/帧。

## D6 · 坐标与字号

- 归一化 `rect` + `DESIGN_WIDTH=1080` 的字号基准。
- **理由**：同一套模板要能输出 9:16 / 1:1 / 16:9。绝对像素会让横屏时文字变得很小。
- **风险**：`h` 很高的图层在不同画幅下换行数会变化（宽度比例变化导致），文字可能溢出。缓解：`wrapText` 按图层宽度换行，溢出时由用户调整 `h`/字号。
- **实测**：单测验证 1080×1920 → 1920×1080 时 `rect` 换算符合比例、位置不变。

## D7 · GLB 加载方式

- **选择**：`new GLTFLoader().load(url, ...)` + `useEffect` cleanup 中 `disposeObject3D`。
- **理由**：`useGLTF` 内部有全局 cache，替换模型后旧资源不会释放（阶段 0 要验证生命周期，不能让缓存掩盖泄漏）。
- **风险**：同一 URL 重复加载会重复解析（当前场景下可接受，模型 ~2.9MB）。

## D8 · 模板语义

- **选择**：模板只 patch `material/lighting/animation/camera`；应用后记录 `templateId`；任一风格字段被手动修改则 `templateId=null`。
- **理由**：用户上传的商品和写的文案不能被模板吞掉；同时需要让 UI 知道"当前是否仍在模板状态"。
- **未决**：是否要"模板参数联动"（改模板即改所有关联字段）。`[待验证]` 阶段 1 与设计确认。

## D9 · 不使用 Worker（阶段 0）

- **理由**：先证明"能出真 MP4"，再优化卡顿。编码循环里每 5 帧 `await sleep(0)` 让出主线程，进度条可更新。
- **风险**：1080p 长视频导出时页面明显卡顿；`VideoEncoder` 本身多在 GPU/独立线程编码，但 `drawImage` 回读在主线程。
- **实测指标**：1080×1920 / 150 帧 ≈ **57ms/帧**（整段 8.5s）。低于 80ms 阈值，因此阶段 0 不迁移 Worker；但导出期间主线程仍明显被占用（UI 只在每 5 帧让出一次），60fps/长视频仍需在阶段 1 复测。

## D10 · 不做持久化

- 刷新即回到默认项目。避免在数据契约未稳定时引入迁移逻辑。
- 影响：验收需在一次会话内完成导出。

## D11 · 示例模型

- `public/models/astronaut.glb`（2.87MB，来自 modelviewer.dev 共享示例资源）仅用于阶段 0 验证加载/居中/材质链路。
- **风险**：示例资源授权不等同于商用授权。上线前必须替换为自有商品模型，或改为用户上传。

## D12 · 图层交互方案（命中测试 / 拖动 / 缩放）

- **背景**：阶段 1 需要点选、拖动、缩放，且不能改动 Canvas2D 光栅器与导出链路。
- **选择**：自研交互层，零新增依赖。
  - 命中测试：`hitTestLayers()`（`src/lib/layers/transform.ts`）在**归一化坐标**上工作，内部换算到 stage 像素判断旋转；按 `zIndex` 取最上层，跳过隐藏/锁定图层。
  - 事件：在 `.stage-frame` 上用**捕获阶段**监听 `pointerdown`（原生 `addEventListener(..., true)`）。命中图层时 `stopPropagation()` + `preventDefault()`，并把 OrbitControls 同步置为 `enabled = false`；未命中时完全不干预，事件照常交给 3D 轨道。
  - 拖动过程不写 store：本地 `DragSession` 只更新 canvas 的 "draft rect" 与选择框的 inline style，`pointerup` 才提交一次 `updateLayer`。
  - 选择框/缩放手柄是 DOM 覆盖层（`pointer-events: none`，手柄单独开启），因此**永远不可能进入导出画面**（e2e 用"选中导出 vs 取消选中导出"逐像素比对证明）。
- **备选与否决理由**：
  - **Konva**（~150KB gzip）：自带 Transformer，但它的场景模型与现有 Canvas2D 光栅器重复；导出仍要走 `drawLayers()`，等于维护两套图层几何，违背 D4。
  - **PixiJS**（~450KB gzip）：WebGL 2D 渲染器，为几十个文字图层引入整个渲染栈，收益不成比例。
  - **每图层一个透明 DOM 命中区**：更简单，但旋转图层的命中只能是外接矩形（与光栅器不一致），且图层区域会完全挡住 OrbitControls。
- **风险/代价**：
  - 拖拽时每次 pointermove 都要重绘覆盖层 Canvas（4 个图层，实测单帧 < 2ms），因此用 rAF 合并到每帧一次。
  - 图层区域覆盖的 3D 视角内无法旋转商品（与 Figma 等编辑器行为一致）；空白区域仍可旋转。
  - 键盘删除（Delete/Backspace）**故意未实现**：当前没有撤销栈，误删不可恢复。删除仍走属性面板。
- **实测**：拖动 1px 级偏移在 342px 宽的预览上按比例换算，归一化偏差 < 0.3%；9:16 / 1:1 / 16:9 与窗口 resize 后 `left%` 不变；导出 PNG 中图层位置与编辑器偏差 < 2%。

## D13 · 图片素材（上传 / 校验 / 生命周期 / 与模型纹理的边界）

- **背景**：需要真实的图片素材入口（PNG / JPEG / WEBP，≤50MB），不接数据库、对象存储或第三方服务；上传后必须能真正"作为图片图层使用"。
- **校验分层**（全部在客户端，先便宜后昂贵）：
  1. `validateImageFile()`（纯函数）：扩展名 → MIME → 扩展名/MIME 一致性 → 大小。读字节之前就把 51MB 的文件挡住。
  2. `sniffImageType()`：PNG/JPEG/WEBP 的魔数。改名的 ZIP、纯文本会在这里失败，而不是抛出一个含糊的解码错误。
  3. `decodeBlob()`：`createImageBitmap()`，失败再回退 `HTMLImageElement.decode()`（两条解码路径在部分 WEBP/JPEG 变体上行为不同）。
  4. `checkDecodedSize()`：0×0 或 >16384px 拒绝（GPU/纹理上限）。
- **元数据与运行时分离**：
  - store：`images: Record<id, ImageAssetMeta>`（name/mime/bytes/width/height/createdAt），纯 JSON。
  - `imageRegistry`（模块单例）：Object URL + `ImageBitmap`（或回退用的 `HTMLImageElement`）。预览光栅器与导出合成器都通过 `imageRegistry.source` 取图 —— 这是"预览与 MP4 一致"的保证。
- **两条消费路径，所有权互不重叠**：
  - **2D 图层**：`ImageLayer.assetId` → `drawLayers()` 的 `images` 解析器（预览与导出同一解析器）。
  - **商品贴图**：`MaterialConfig.mapAssetId` → `applyMaterialTexture()` 把图片写成模型的 baseColor `map`。
  - 同一张素材可以同时被两边使用，`image-usage` 显示「n 个图层 · 商品贴图」；两条路径互不影响：删图层不会动贴图，恢复贴图不会动图层。
- **贴图的纹理所有权**（本轮最关键的一块）：
  - 纹理由 `ProductModel` 的 texture effect 创建（`createTextureFromSource`），因此也只由它 `dispose()`。
  - 创建时打 `texture.userData.external = true`；`disposeObject3D()` **跳过** external 纹理，避免卸载模型时误删仍在使用的素材纹理。
  - 换贴图时把模型原有的 `map` / `color` 停放到 `material.userData.__originalMap` / `__originalColor`，恢复时放回；`disposeObject3D()` 会显式释放这个"停放"的原始贴图，否则在贴着图时替换模型会泄漏它。
  - 应用贴图时把 baseColor 置白（`map` 与 `color` 相乘，残留色调会压暗纹理），恢复时还原原色。
  - 只在"有无 map"真正翻转时才 `needsUpdate`（触发 shader 重编译）；仅换图不重编译。
  - 模板与材质预设都保留 `mapAssetId`，不会把用户贴图悄悄清掉。
  - 素材被贴图占用时，`移除素材` 与"重复上传释放旧素材"都会跳过它，并给出中文提示。
- **不做投影/UV 编辑**：贴图沿用 GLB 自带 UV。不同模型 UV 不同，"投影贴图/UV 编辑"是独立功能；当前提供的是"替换 baseColor map"，对带 UV 的模型即可见效果。
- **代价**：切换贴图会触发一次材质更新，导出帧在 8bit 上可能出现 ±1~2 的舍入差异（e2e 用 `maxDelta ≤ 2` + 平均差 < 0.2 判定"视觉一致"，而不是逐字节相等）。
- **释放矩阵**（e2e 实测）：

  | 场景 | 行为 |
  |---|---|
  | 再次上传，旧素材**未被**任何图层引用 | 旧 URL `revokeObjectURL` + 旧 `ImageBitmap.close()` + 删元数据 |
  | 再次上传，旧素材仍被图层引用 **或正作为商品贴图** | 旧素材保留（仍可达，可继续导出），不误删 |
  | 解码失败 / 尺寸超限 | 立即 revoke 本次创建的 URL、close 已解码位图，元数据不写入 |
  | 移除素材（无图层引用） | 释放运行时对象 + 删元数据；有引用时拒绝并提示 |
  | 重置工程 | `resetProject()` + `imageRegistry.clear()` |
  | 离开编辑器（客户端路由） | `LabShell` 卸载 effect → `clear()` + 清空元数据 |
  | 导出取消 | 与图片无关（导出只读位图，不接管所有权）；导出自身的 URL/编码器按原逻辑释放 |

- **代价与风险**：
  - 为拿到真实读取进度，文件被读成 `ArrayBuffer`（≤50MB）；峰值内存 ≈ 文件 + Blob 拷贝 + 解码位图。极大图片（如 8000×8000）解码后占用可达数百 MB，目前只靠 16384px 上限与 50MB 文件上限兜底。`[待验证]` 是否要引入 `createImageBitmap(blob, { resizeWidth })` 的降采样。
  - 上传取消：`AbortController` 贯穿 `loadImageFile` + `FileReader`，面板提供「取消上传」；取消后不写元数据、不残留 URL（单测覆盖 ABORTED 分支）。
  - 素材库按会话存在，刷新即丢失（与 D10 一致）。

## D14 · 模板画廊与工作流状态机

- **背景**：模板能力已经有 `applyTemplate()`（只 patch `material/lighting/animation/camera`），但入口是三颗按钮，没有选型、没有预览、没有"现在能做什么"的约束；用户也不知道导出与预览是否一致。
- **模板仍是一套语义**（不改领域类型）：`TemplateDefinition.patch` 的结构与 `applyTemplate()` 的行为一字未改，只把模板扩到 6 个，并给每个模板加一个 `backgroundSummary` 文案。
- **缩略图不是图片资源**：`TemplateThumb` 用模板自己的背景渐变 + 材质颜色/粗糙度 + 灯光预设**在 canvas 上现画**。好处是没有需要随模板变更而失效的静态图；坏处是它是"风格示意"而非真实商品渲染（真实渲染需要加载 GLB，代价太高）。
- **三个入口的真实语义**：
  - **应用模板**：把选中卡片的 patch 应用到当前工程。应用前把用户**自己的**风格快照存进 `restorePoint`（只在第一次应用时记录；A→B 切换不覆盖，否则"恢复"会退到上一个模板而不是用户自己的状态）。
  - **恢复当前编辑**：把 `restorePoint` 写回 config、`templateId` 还原、状态回 `editing`。一旦用户手动改过任何风格字段，快照即被丢弃 —— 此时"当前编辑"就是用户刚做的修改，没有更早的状态可回。按钮在不可用时给出具体原因，而不是静默失效。
  - **重新开始**：内联 `alertdialog`（Esc 取消）二次确认 → `resetProject()` + `imageRegistry.clear()` + 清预览快照；重置后若模型仍就绪会回到 `asset-ready` 而不是假装"待开始"。
- **状态机**（`src/lib/workflow/machine.ts`）：8 个状态、纯函数 `transition(state, event) → { state, accepted, message, tone }`。UI **同时**用它判断按钮可否点击、以及执行动作，所以"禁用原因"和"实际行为"在结构上不可能不一致。非法跳转返回中文原因（如"请先生成预览，再导出 MP4"）。
- **预览快照**：`PreviewSnapshot`（Object URL + 尺寸/体积/时间点/模板/图层数/耗时）由 `captureStillFrame()` 生成 —— 与导出**同一个合成器**，所以它确实是"导出的那一帧"。离开 `preview-ready` 后快照标记为"已过期"，但仍展示（带提示），不会假装还有效。
- **不写 localStorage**：本轮明确不做持久化。e2e 断言 `localStorage` 中没有 `clipflow` 相关键。若将来要持久化，需要先单独提设计（schema 版本、迁移、资产 Blob 不能进 localStorage）。
- **代价 / 已知限制**：
  - 状态机会**阻止导出期间的编辑与模板切换**（有意为之，避免导出中途场景改变）；代价是用户必须等导出结束或取消。
  - 预览是**静帧快照**，不是视频预渲染；导出用的是同一条合成链路，但视频仍逐帧重新渲染。
  - 模板缩略图与真实渲染存在差异（风格示意，非像素级预览）。
  - 没有模板自定义 / 收藏 / 搜索；模板数量固定为 6。
