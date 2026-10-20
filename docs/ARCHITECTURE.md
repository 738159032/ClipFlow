# ARCHITECTURE

> 阶段 0 架构。标注 `[已验证]` 的部分有对应的命令/运行记录（见 `docs/ACCEPTANCE.md`）；
> 标注 `[待验证]` 的部分是设计意图，尚未经过实现验证。

## 1. 分层

```
┌──────────────────────────────────────────────────────────────┐
│ app/                       路由（Server Component 默认）        │
│   page.tsx  /lab/page.tsx                                    │
├──────────────────────────────────────────────────────────────┤
│ components/                视图与交互（'use client'）           │
│   lab/      InspectorPanel · ExportPanel · LabShell           │
│   stage/    StagePreview · ProductStage · LayerOverlay        │
│             LayerInteraction（命中/拖动/缩放/键盘）             │
│   scene/    SceneLights · StageEnvironment · ProductModel     │
│             CameraRig · AnimationDriver · RendererBridge      │
├──────────────────────────────────────────────────────────────┤
│ hooks/                     状态机与副作用                       │
│   useExportController      导出状态 / AbortController / URL    │
├──────────────────────────────────────────────────────────────┤
│ store/editor.ts            zustand：ProjectConfig + 选中态     │
├──────────────────────────────────────────────────────────────┤
│ lib/                       纯逻辑，无 React                    │
│   types.ts                 数据契约                            │
│   presets.ts               默认值 / 材质 / 灯光 / 模板         │
│   layout.ts                归一化坐标 ↔ 像素、画幅、命中测试    │
│   timeline.ts              sampleAnimation / 帧↔时间           │
│   layers/render.ts         Canvas2D 光栅器（唯一 2D 渲染实现）  │
│   layers/transform.ts      命中测试 / 拖动 / 缩放（纯几何）      │
│   assets/validate.ts       上传校验 / 魔数 / 尺寸（纯函数）      │
│   assets/registry.ts       图片运行时对象（URL / ImageBitmap）   │
│   assets/upload.ts         读取 + 解码 + 注册                   │
│   scene/model.ts           居中归一化 / 材质覆盖 / dispose      │
│   export/mp4.ts            编码主循环                          │
│   export/compositor.ts     3D 帧 + 2D 图层 → 合成 Canvas        │
│   export/capabilities.ts   H.264 能力探测                      │
│   export/mp4-validate.ts   ISO-BMFF 结构校验                    │
└──────────────────────────────────────────────────────────────┘
```

依赖方向单向：`app → components → hooks → store → lib`。`lib` 不 import React。

## 2. 职责划分

| 模块 | 拥有什么 | 不做什么 |
|---|---|---|
| **Scene（ProductStage）** | R3F `<Canvas>`、renderer、scene、camera、灯光挂载 | 不持有编辑器状态，不决定动画内容 |
| **Product（ProductModel）** | 一次 GLB 生命周期：加载 → 归一化 → 材质覆盖 → dispose | 不管理 URL 的创建（由 store 创建） |
| **Material（lib/scene/model）** | 材质参数如何作用到 mesh | 不改动带贴图资产的 baseColor |
| **Lighting（SceneLights + StageEnvironment）** | 三点光 + 程序化 IBL | 不写背景（背景属于 2D 合成层） |
| **Layers（lib/layers/render）** | 图层 → 像素的唯一映射 | 不感知 3D、不感知 DOM |
| **ImageAssets（lib/assets）** | 上传校验、解码、运行时对象与 Object URL 生命周期 | 不创建 THREE 纹理、不写入 store |
| **MaterialTexture（lib/scene/model）** | 把图片写成 baseColor `map`，停放/归还模型原有 map，标记 external 所有权 | 不拥有素材本身，不决定哪张图被使用 |
| **Template（lib/presets）** | 一组风格字段的 patch | 不触碰商品资产、图层内容 |
| **Export（export/*）** | 帧生产循环、封装、诊断 | 不自建场景，不自建动画 |
| **Store（store/editor）** | ProjectConfig + 选中图层 + 资产记录 | 不持有 THREE/Canvas/编码器对象 |

## 3. 所有权

**编辑器状态（唯一真源）**：`useEditorStore().config: ProjectConfig`。纯 JSON，可序列化、可 diff、可持久化（持久化尚未实现）。

**商品资源**：`AssetRecord { id, name, url, bytes }` 存在 store；而 `url` 指向的 Object URL 由 `setModelFile` 创建、替换前 `revokeObjectURL`。THREE 侧对象（geometry/material/texture）由 `ProductModel` 的 effect 独占，卸载时 `disposeObject3D()` 释放并上报统计。两者不交叉：store 不知道 THREE，THREE 不知道 store。

**运行时槽位**：`StageRuntime { pivot, modelRoot, metrics }` 是一个可变对象，由 `LabShell` 创建、传给 R3F 组件与导出器。它存在的唯一理由是让导出器在 React 渲染之外拿到"活的" pivot group（导出循环不能等一次 setState）。

**图片素材**：`images`（元数据，纯 JSON）在 store；`imageRegistry`（模块单例）持有 Object URL 与 `ImageBitmap`/`HTMLImageElement`。预览与导出都通过 `imageRegistry.source(assetId)` 取图，所以同一张图在两条路径上逐像素一致。

图片素材有两条消费路径（互不影响）：`ImageLayer.assetId`（2D 图层）与 `MaterialConfig.mapAssetId`（商品 baseColor 贴图）。贴图的 `THREE.Texture` 由 `ProductModel` 的 texture effect 独占创建与释放，并打上 `userData.external`；`disposeObject3D()` 只释放 GLB 自带的贴图，外加换图时被"停放"在 `userData.__originalMap` 里的原始贴图（见 DECISIONS D13）。

**渲染器**：由 R3F 拥有。`RendererBridge` 在组件内部通过 `useThree()` 取得 `gl/scene/camera`，向外暴露一个窄接口 `RendererHandle { begin, renderAt, end, requestRender }`。

## 4. 数据流

```
用户操作
  └─> store action（不可变更新 config）
        ├─> InspectorPanel / StagePreview 重渲染
        ├─> ProductModel effect：材质参数写入 material
        ├─> CameraRig effect：配置变化时重置机位
        └─> LayerOverlay：检测到 layers 引用变化 → 重绘

每帧（预览）
  R3F frameloop="always"
    └─> AnimationDriver.useFrame：clock.advance(delta) → sampleAnimation → 写 pivot
          └─> LayerOverlay 的 rAF 循环：读取 clock.timeMs → drawLayers

每帧（导出）
  exportMp4 循环
    ├─> RendererHandle.begin(W,H)：renderer 切到导出分辨率
    ├─> renderAt(t)：sampleAnimation(t) → 写 pivot → gl.render()
    ├─> FrameCompositor.draw()：背景 + gl.domElement + drawLayers
    ├─> new VideoFrame(canvas) → VideoEncoder.encode()
    └─> flush → muxer.finalize → Blob → 结构校验 → 下载
```

## 5. 预览与导出一致性

一致性靠"三处共享"，而不是"两套实现保持一致"：

1. **同一份配置**：`ProjectConfig` 只有一份。
2. **同一个采样函数**：`sampleAnimation(animation, t)` 是纯函数，预览写 pivot、导出也写 pivot。
3. **同一个渲染器**：导出直接驱动预览用的 `gl`，只临时改 `setSize` / `camera.aspect`。

因此不存在"导出时重新搭场景"的分叉。代价是：导出期间预览画布会被临时改尺寸（用遮罩挡住），且导出不能被中断在同一帧中间（AbortController 在帧边界检查）。

**已知差异风险**：预览的 WebGL canvas 以 CSS 尺寸显示（可能 < 1080 宽），而导出是 1080 宽的真实渲染。分辨率不同会带来抗锯齿/细节差异，但构图、时间点、图层位置一致。`[已验证]`（静帧与 MP4 首帧对比见验收文档）

## 6. 坐标系统

- 图层几何：`rect { x, y, w, h }` ∈ [0,1]，原点左上，相对于**舞台**而不是屏幕。
- 字号：设计像素 @ `DESIGN_WIDTH = 1080`，实际像素 = `fontSize × stage.width / 1080`。切到 1920×1080 时字号按宽度比例放大，视觉权重保持一致。
- 预览：`stage-frame` 用 `aspect-ratio: w/h` 锁定与导出相同的宽高比，canvas 覆盖层以 `stage.width × stage.height` 为内部分辨率，CSS 缩放显示（`pointer-events: none`）。因此同一 `rect` 在预览与导出中落在相同的相对位置。
- 导出：`FrameCompositor` 的 canvas 直接等于 `stage.width × stage.height`，绘制时不缩放几何。
- 相机：`camera.aspect` 始终等于 `stage.width / stage.height`（预览容器与导出分辨率同比例），所以取景不变。

`[已验证]`：切换 1080×1920 / 1080×1080 / 1920×1080 时图层相对位置不变（单元测试 + 截图）。

### 6.1 交互层（点选 / 拖动 / 缩放）

```
pointerdown（捕获阶段，绑定在 .stage-frame）
  ├─ 命中缩放手柄 → 手柄自己的 onPointerDown 处理 resize
  ├─ hitTestLayers(layers, point, stage) 命中图层
  │    ├─ stopPropagation + preventDefault（阻断 OrbitControls 与文本选择）
  │    ├─ runtime.setOrbitEnabled(false)（双保险）
  │    ├─ store.selectLayer(id)（一次）
  │    └─ 建立 DragSession：起点 client 坐标 + 起点 rect + 当时 stage CSS 尺寸
  └─ 未命中 → 什么都不做，事件继续交给 OrbitControls；记录起点用于"空白点击取消选中"

pointermove（window 捕获）
  → 只更新 DragSession.pending（不写 store）
  → requestAnimationFrame 合并为每帧一次：
      rect = translateRect | resizeRectFromCorner(起点 rect, 归一化位移)
      overlay.setDraft(id, rect) → 用同一光栅器重绘 canvas
      chrome.style.left/top/width/height → 直接写 DOM 样式

pointerup
  → endSession：runtime.setOrbitEnabled(true)，store.updateLayer(id, { rect })（整段拖拽唯一一次写入）
  → 覆盖层保留 draft，直到 store 中的 rect 与 draft 相等（避免一帧回跳）
```

关键点：

- **没有像素**：`toNormalizedPoint()` 每次都用实时 `getBoundingClientRect()` 换算，所以 CSS 缩放、DPR、窗口 resize、画幅切换都不会漂移。
- **每帧一次**：pointermove 可达 200Hz，但绘制被 rAF 合并；React 在整个拖拽中零重渲染（除 pointerdown 时的一次 select）。
- **命中与渲染同源**：`hitTestLayers` 在像素空间判断旋转，和 `drawLayers()` 的 `rotate()` 完全一致。
- **选择框不参与导出**：chrome 与 a11y 焦点框都是 DOM，`FrameCompositor` 只读取 canvas，e2e 用"选中导出 / 取消选中导出"逐像素比对验证 `changed = 0`。

## 7. 模板与用户编辑

- 模板 = 风格字段的 patch：`material / lighting / animation / camera`。
- `applyTemplate()` **不覆盖**：商品资产、图层内容、图层几何、舞台尺寸。
- 一旦用户手动修改任一风格字段，`templateId` 被置为 `null`（`detachFromTemplate` 语义），UI 不再高亮该模板 —— 表示"当前状态已偏离模板"。
- 这个模型是"一次应用 + 后续脱离"，不支持"模板参数化联动"。`[待验证]` 是否需要双向联动（阶段 1 决策）。

## 8. 生命周期

| 对象 | 创建 | 释放 | 现状 |
|---|---|---|---|
| Object URL（上传的 GLB） | `setModelFile` | 替换/重置前 `revokeObjectURL`；`useExportController` 卸载时释放导出 URL | `[已验证]` |
| Object URL（图片） | `imageRegistry.createUrl` | `release()` / `clear()`：替换、移除、重置、离开编辑器 | `[已验证]`（e2e 计数） |
| ImageBitmap（图片） | `createImageBitmap` | `bitmap.close()`，同上；解码失败时立即关闭 | `[已验证]`（e2e 计数） |
| HTMLImageElement（回退解码） | `new Image()` | `src = ''` + 移除引用 | `[已验证]`（代码路径） |
| THREE.Texture（商品贴图） | `createTextureFromSource`（`ProductModel` effect） | 换图 / 恢复 / 卸载时 effect cleanup `dispose()`；`disposeObject3D` 跳过 external 纹理 | `[已验证]`（单测 + e2e） |
| THREE geometry / material / texture | GLTFLoader | `ProductModel` cleanup → `disposeObject3D`，统计上报到 UI | `[已验证]` |
| PMREM 环境贴图 | `StageEnvironment` | cleanup 中 `target.dispose()` + `pmrem.dispose()` | `[已验证]` |
| WebGL renderer | R3F | 页面卸载 | 依赖 R3F |
| VideoEncoder | `exportMp4` | `finally` 中 `close()` | `[已验证]` |
| VideoFrame | 每帧 | `frame.close()`（try/finally 语义上紧随 encode） | `[已验证]` |
| FrameCompositor canvas | `exportMp4` | `finally` 中置 1×1 | `[已验证]` |
| Blob（导出结果） | `exportMp4` | `URL.revokeObjectURL` 在替换/卸载时 | `[已验证]` |
| AbortController | 每次导出 | `finally` 置空 | `[已验证]` |
| Worker | 无 | —— | 阶段 0 未使用 Worker。`[待验证]` 编码是否迁移到 Worker（1080p 下主线程阻塞情况见 DECISIONS） |

## 9. 错误处理

三层：

1. **资源层**：`GLTFLoader` onError → `modelStatus='error'` + `sceneError` 覆盖层，保留其余 UI 可用。
2. **渲染层**：`SceneErrorBoundary`（class，`getDerivedStateFromError`）+ WebGL 能力探测兜底。
3. **编码层**：`VideoEncoder` 的 `error` 回调写入 `encoderError`，主循环每帧检查并抛出；能力探测失败时 `ExportUnsupportedError`，UI 展示候选编码器矩阵，绝不静默降级到 WebM。

## 10. 已知架构缺口

- `[待验证]` 导出在主线程执行，1080×1920 长视频会阻塞 UI（进度条靠 `setTimeout(0)` 让出）。是否迁移 Worker（OffscreenCanvas + 独立 renderer）需在阶段 1 用性能数据决策。
- `[待验证]` 2D 文字依赖 Canvas2D 字体度量，与设计稿（Figma）的字距可能有 1–2px 差异。
- 商品贴图沿用模型自带 UV，**没有**投影/UV 编辑能力（见 D13）。
- `[待验证]` 超大图片（>4000px）解码后的内存峰值，尚未做降采样。
- 图层不支持直接拖拽（`LayerOverlay` 为 `pointer-events: none`），交互在阶段 1 补齐。
