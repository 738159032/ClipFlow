# ClipFlow 分阶段任务提示词

本文档是给 Trae、WorkBuddy、DSH 或其他代码 Agent 使用的任务包。  
仓库当前已经完成阶段 0 的主要能力：GLB 预览、材质/灯光、2D Canvas2D 合成、模板基础和真实 MP4 导出。不要再从“基础 3D 查看器”重新开始。

## 使用方式

1. 每次只发送一个任务。
2. Agent 必须先读取根目录 [`AGENTS.md`](../AGENTS.md)、[`docs/PRD.md`](./PRD.md)、[`docs/ARCHITECTURE.md`](./ARCHITECTURE.md)、[`docs/DECISIONS.md`](./DECISIONS.md)、[`docs/TASKS.md`](./TASKS.md)。
3. 发送任务前先执行 `git status --short --branch`，不得覆盖已有修改。
4. 当前任务的验收未通过前，不发送下一个任务。
5. Agent 的“已完成”只能表示实际运行过的检查；未运行的项目必须写 `[待验证]`。

## 每个任务都必须附带的执行协议

将下面这段放在每个任务提示词前面：

```text
你正在维护 ClipFlow。先阅读根目录 AGENTS.md 以及 docs/ 下与本任务相关的文档，再检查 git status、现有目录、相关实现和测试。

这是增量任务，不要重写已经通过验收的功能。遵守现有架构：
- Next.js 15 App Router、React 19、TypeScript strict；
- 3D 只使用 three + @react-three/fiber 及 three 官方 addon，不引入 @react-three/drei；
- 状态只放可 JSON 序列化的 ProjectConfig，THREE 对象、Canvas、Blob、Object URL、Worker 和编码器不能进入 store；
- 预览与导出共用 sampleAnimation()；
- 预览与导出共用 src/lib/layers/render.ts 的 Canvas2D 光栅器；
- 图层使用 0–1 归一化 rect 和 DESIGN_WIDTH=1080；
- 每个资源创建点必须有对应释放路径，错误必须在 UI 中可见；
- 不使用假按钮、假进度、WebM 改名 MP4 或模拟下载；
- 所有用户可见文案使用简体中文。

执行前输出简短计划、预计修改文件、风险和验收命令。只实现本任务范围。
完成后运行与改动相关的单测、npm run typecheck、npm run lint、npm run build；涉及 3D/图层/导出的任务还要运行 npm run test:e2e。
最后报告：功能、文件、命令及真实结果、浏览器验证、回归结果、未验证项和下一步。同步更新 docs/TASKS.md 与 docs/ACCEPTANCE.md，不得把未运行或未通过的项目标为完成。
```

## 任务 1：图层直接选择、拖动和缩放

```text
在现有 2D 图层基础上实现编辑器交互，不改变现有 Canvas2D 光栅器和导出链路。

目标：
1. 在 LayerOverlay 上实现命中测试、选中态、拖动和至少一种可用的缩放方式。
2. 拖动和缩放写回 store 中的归一化 rect；禁止写入屏幕像素坐标。
3. 处理舞台 CSS 缩放、不同画幅、设备像素比和窗口 resize，不能因预览尺寸变化而漂移。
4. 支持鼠标、触摸和键盘基本操作；提供明确的焦点、aria-label 和选中状态。
5. 保留属性面板编辑、删除、层级顺序、预览绘制和 MP4 导出。
6. 拖动期间不要通过每个 pointermove 触发 60fps 的无意义整页重渲染；可使用局部 DOM 状态，结束时提交 store。

不要引入 Konva、Pixi 或其他重量级画布编辑器，除非先修改 docs/DECISIONS.md 并说明依赖、体积和替代方案。

验收：
- 三种已有图层均可点选、拖动、缩放或通过键盘调整。
- 9:16、1:1、16:9 切换和 resize 后位置仍正确。
- 导出 PNG/MP4 与编辑器显示同一位置。
- 触摸端不会滚动页面代替拖动，也不会阻塞其他控制。
- 补充 layout/hit-test 单测及至少一个 e2e。
```

## 任务 2：图片素材上传与生命周期

```text
增加真实的图片素材入口，先只支持浏览器内存，不接数据库、对象存储或第三方服务。

支持 PNG、JPEG、WEBP；点击选择和拖拽上传；默认限制 50MB。上传后提供“作为图片图层使用”的真实行为，不能只显示文件名。若要支持图片贴到商品材质，必须复用现有材质生命周期并明确区分图片图层与模型纹理。

要求：
- 在客户端校验扩展名、MIME、大小和图片解码结果；
- 显示文件名、大小、加载进度、成功和中文错误；
- 新文件替换旧文件时释放旧 Object URL、ImageBitmap/HTMLImageElement 和纹理；
- 组件卸载、重置工程、重复上传、导出取消都不能泄漏资源；
- 不破坏 GLB 替换、材质、灯光、图层、模板和导出；
- 资产元数据与运行时对象分离，store 不保存 Blob、ImageBitmap、HTMLImageElement 或 Canvas。

验收：
- 三种格式各有一个成功用例，损坏文件和超大文件有失败用例；
- 图片图层可在预览中移动并进入真实 MP4；
- 重复上传后旧 URL 可释放，UI 有可观察的错误和加载状态；
- 补充纯函数单测，并在真实 Chrome 中完成上传到导出的 e2e。
```

## 任务 3：模板卡片与工作流状态

```text
把现有模板能力整理成可演示的模板选择流程，不重写模板领域类型和 applyTemplate 的“风格 patch”语义。

提供至少 5 个可区分模板卡片：名称、缩略预览、背景/灯光/动画摘要和当前选中态。应用模板时不能清除用户模型、图片素材或已有图层；用户修改风格字段后应正确脱离模板。提供“应用模板”“恢复当前编辑”“重新开始”三个语义清晰且行为真实的入口，危险重置需要确认。

实现一个明确的工作流状态机：
idle → asset-ready → template-selected → editing → preview-ready → exporting → export-success/export-error。
未满足前置条件时禁用或解释按钮，不能靠 toast 假装完成。生成预览必须保存一个可观察的合成状态，暂停/继续必须影响真实动画。

不要把业务数据写入 localStorage；如需持久化，先单独提出设计并等待确认。

验收：
- 5 个模板真实可切换，且每个模板的配置变化可观察；
- 模型、素材和图层在模板切换后保留；
- 桌面端和移动端都能完成“素材 → 模板 → 编辑 → 预览”；
- 状态机的非法跳转有中文提示；
- 补充 presets/store 单测及核心流程 e2e。
```

## 任务 4：导出稳定性、取消和兼容性

```text
在不改变“WebCodecs VideoEncoder + mp4-muxer 真实 MP4”决策的前提下，强化导出链路。

要求：
- 导出前检查 H.264、VideoFrame、偶数尺寸和当前素材状态；
- 进度包含准备、渲染、编码、校验、完成/失败/取消阶段；
- 导出中真正阻止重复点击和会污染共享 renderer 的编辑操作；
- 取消、编码器 error、渲染 error、下载 URL 替换都进入显式错误或取消状态；
- finally 中释放 VideoEncoder、VideoFrame、合成 Canvas、Blob URL 和 AbortController；
- 不引入 FFmpeg.wasm 作为未经决策的降级，不生成伪 MP4；
- 评估 5–15 秒和 30fps 的耗时，只有有数据后才决定是否迁移 Worker。

验收：
- 真实 Chrome 生成包含 ftyp、moov、mdat 的 MP4，并可在 video 元素播放和 seek；
- 中途取消后立即可以再次导出；
- 无 H.264 能力时显示可理解的失败原因；
- 导出期间 UI 仍显示进度，且不会产生未释放 URL；
- 补充编码器错误/取消的可测试路径，运行完整 e2e。
```

## 任务 5：响应式、可访问性和性能收尾

```text
针对已经完成的核心流程做 MVP 收尾，不添加账号、云存储、音频、时间轴或多场景等非核心功能。

检查并修复：
- 手机、平板、桌面布局和触摸操作；
- 首次使用、示例商品、空状态、加载、失败、取消和成功状态；
- 所有按钮、拖拽区、表单、模板卡片的键盘和 aria 行为；
- Canvas 和 THREE 资源释放、重复加载、不必要重渲染；
- 页面 title、description、viewport 和现有 Next.js 安全 headers；
- 删除无效按钮、调试日志、未使用依赖和与当前决策冲突的文案。

验收：
- 新用户无需读文档，2 分钟内能用示例商品完成预览并开始导出；
- 桌面 Chrome 核心流程完整通过；
- 移动视口完成上传/模板/编辑/预览回归；WebCodecs 不支持时如实标记为待验证；
- npm run verify 和 npm run test:e2e 通过；
- docs 中只保留真实验证结果。
```

## 任务 6：最终发布门禁

```text
只做审查和必要修复，不新增产品能力。对当前仓库执行一次发布前验收：

1. 检查 git diff，确认没有覆盖用户改动、密钥、临时文件或伪造结果。
2. 运行 npm run typecheck、npm run lint、npm run test、npm run build、npm run test:e2e。
3. 用真实 Chrome 验证：示例商品/图片素材、模板、材质、图层、生成预览、暂停继续、真实 MP4 下载、取消后重试。
4. 检查 MP4 的 ftyp/moov/mdat、video 解码和 2D 图层烧录。
5. 对照 AGENTS.md、ARCHITECTURE.md、DECISIONS.md，修正文档中与代码不一致的状态。

输出阻塞问题表（严重度、文件、复现、影响、建议）和完整 checklist。没有实际证据的项目标记为[待验证]，不要为了全绿而删除测试或放宽断言。
```

## 不应继续使用的原提示词表述

- “使用 `@react-three/drei`”：与当前 [`docs/DECISIONS.md`](./DECISIONS.md) 冲突。
- “优先使用 Pixi.js、Konva”：与单一 Canvas2D 光栅器和依赖控制原则冲突，必须先做架构决策。
- “图片上传后贴到简单立方体”：会绕开当前模型/合成架构，应先定义图片图层还是模型纹理。
- “导出不超过 30 秒”：这是性能目标，不是功能保证；必须给出设备、分辨率、帧率和实测数据。
- “移动端可以导出”：当前只在桌面 Chrome 验证，移动 Safari/Android 必须单独标记 `[待验证]`。
- “完成后输出运行代码”：Agent 应修改仓库并提供 diff、命令和真实结果，不应把大段源码复制到回复中。
