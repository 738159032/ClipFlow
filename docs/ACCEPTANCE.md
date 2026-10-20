# ACCEPTANCE · 阶段 0

本文件只记录**实际执行过**的命令和**真实输出**。未执行或未通过的项一律标出，不做"应该可以"的推断。

## 1. 执行环境

| 项 | 值 |
|---|---|
| OS | Windows（win32），Shell: Git Bash |
| Node / npm | v22.22.2 / 10.9.7 |
| Next.js | 15.5.28（App Router） |
| React | 19.3.1 |
| three / R3F | 0.186.1 / 9.8.2 |
| 浏览器（e2e） | 本地安装的 Google Chrome 155.0.8059.84（Playwright `channel: 'chrome'`） |
| ffmpeg / ffprobe | **不可用**（因此 MP4 校验使用自研 ISO-BMFF 解析 + 浏览器解码，而非 ffprobe） |

## 2. 执行的命令与真实结果

| 命令 | 结果 | 关键输出 |
|---|---|---|
| `npm install` | 成功 | `package-lock.json` 已生成；`node_modules` 顶层 313 个目录 |
| `npm run typecheck` | 通过 | `tsc --noEmit` 无输出（0 error） |
| `npm run lint` | 通过 | `eslint .` 无输出（0 error / 0 warning） |
| `npm run test` | 通过 | 5 个文件 / **48 个用例全部通过**，耗时约 1.1s |
| `npm run build` | 通过 | `✓ Compiled successfully in 12.6s`；`/lab` 293 kB，First Load JS 396 kB |
| `npx playwright test` | 通过 | **6 个用例全部通过**（最终代码上整轮 1.0 min；同机另一次负载较高时为 4.6 min，含 2 次完整 MP4 导出） |
| `npm run verify` | 通过 | typecheck → lint → test → build 全链路成功 |

单元测试覆盖：归一化坐标换算（13）、动画采样与帧时间（13）、MP4 结构解析（4）、场景归一化/材质/dispose/相机（11）、模板与默认数据（7）。

## 3. 验证项结果

### ① Next.js 中 3D Canvas 的客户端渲染与错误处理 —— 通过

- `/lab` 挂载 R3F `<Canvas>`，`renderer-status` 在浏览器内变为「就绪」。
- `WebGL2/WebGL` 探测：不支持时渲染降级提示而非白屏（代码路径，未在无 WebGL 环境实测）。
- 客户端控制台无错误（e2e 断言，白名单仅放过静态资源 404；补 `app/icon.svg` 后 404 消失）。
- `SceneErrorBoundary` 捕获渲染异常（组件路径存在，未在自动化中强制抛错验证）。

### ② GLB 模型加载、居中、相机控制与资源释放 —— 通过

- 2.87MB `astronaut.glb` 加载成功；包围盒最长边归一化到 2.4 世界单位，中心归零（单测覆盖）。
- 相机由配置驱动（距离/方位角/极角），OrbitControls 可拖拽/滚轮缩放（e2e 中页面可交互）。
- **释放验证**：卸载模型时 `disposeObject3D` 返回统计并显示在 UI（e2e `dispose-stats` 断言通过），贴图/材质/几何体计数 > 0。

### ③ 2D 图层叠加、统一坐标系与独立图层数据 —— 通过

- 文字/价格/水印三类图层，各自独立数据对象，支持显隐、层级、旋转、透明度。
- 归一化坐标：1080×1920 → 1080×1080 切换后，标题首行像素位置占画面高度比例保持在 0.06–0.10（e2e 断言通过），即相对位置不变。
- 覆盖层 Canvas 像素非空（e2e 断言 > 100 个不透明像素）。

### ④ 从真实 3D 渲染结果与 2D 图层生成合成帧 —— 通过

- 导出静帧 PNG：1.20MB，IHDR 校验为 1080×1920（e2e 读取 PNG 头）。
- 人工核对（`.verification/still.png`）：背景渐变、3D 商品、标题/副标题/价格标签/水印均在同一帧内，无错位。

### ⑤ 真实 MP4 导出与播放验证 —— 通过

导出参数：1080×1920、30fps、5.00s、150 帧、8 Mbps、H.264 High@L4.0。

| 检查项 | 实测结果 |
|---|---|
| 文件大小 | 5,096,004 字节（4.86MB） |
| 顶层 box | `ftyp:28` / `moov:1306` / `mdat:5,094,670` |
| major/compatible brands | `isom` / `avc1`, `mp41` |
| 是否 WebM 改名 | 否（`looksLikeWebm=false`，`ftyp` 存在） |
| 视频编码 | `avc1`（stsd 内检出） |
| 容器时长（mvhd） | 5.00s |
| 轨道分辨率（tkhd） | 1080 × 1920 |
| 浏览器解码 | `readyState = 4`（HAVE_ENOUGH_DATA） |
| 随机 seek | `currentTime = 2.1155`，抽帧成功 |
| 2D 文字是否烧进视频 | 标题带（y 6%–18%）深色像素占比 7.57% |
| 3D 主体是否存在 | 中央区域亮度范围 232.157、标准差 43.90（远高于纯渐变背景） |
| 编码耗时 | 150 帧 / **8.5s ≈ 57ms/帧**（同机另一次运行整轮更慢，见下方说明） |

解码帧已落盘：`.verification/mp4-frame.png`（时间点 2.1s，商品已转到背面，证明动画确实编码进视频，而不是静态帧循环）。

**编码能力检测（真实输出）**

```
WebCodecs: 可用 · VideoFrame: 可用
avc1.640028 (H.264 High @ L4.0): 支持
avc1.4d0028 (H.264 Main @ L4.0): 支持
avc1.42e01f (H.264 Baseline @ L3.1): 不支持 - isConfigSupported 返回 false
```

（Baseline 不支持是浏览器的真实返回；实现按候选顺序自动降级，当前选 High。）

### ⑥ 取消与重试 —— 通过

e2e「cancelling mid-export releases the encoder and the app stays usable」：

1. 进入 encoding 阶段后点击取消 → 状态离开 busy，日志出现「导出已取消」；
2. **取消后重新导出依然成功**（`export-result` 出现、`<video>` 可播放），说明 `encoder.close()`、渲染尺寸恢复、合成画布释放没有留下坏状态。

## 4. 未通过 / 未验证项（如实登记）

| 项 | 状态 | 说明 |
|---|---|---|
| 编码器内部错误注入 | **未验证** | `VideoEncoder` 的 `error` 回调路径已实现（主循环每帧检查并抛出），但自动化中无法可靠触发；未做故障注入测试 |
| 无 H.264 编码器环境的降级 | **未验证** | 只实现了"明确报错 + 展示候选矩阵"，未在无专有编解码器的 Chromium 上实测 |
| 移动端 Safari / Android | **未验证** | 仅桌面 Chrome 155 实测 |
| 长视频（>15s）与 60fps | **未验证** | 未压测；主线程 `drawImage` 回读是潜在瓶颈（见 DECISIONS D9） |
| 字体度量与设计稿一致性 | **未验证** | Canvas2D 与 Figma 的字距差异未量化 |
| 导出与预览的逐像素一致性 | **部分验证** | 二者共用 `drawLayers` 与同一 stage 像素空间；但预览 CSS 尺寸通常小于 1080，抗锯齿/细节会有差异，未做逐像素 diff |
| 图片素材上传 / 贴图替换 | **未实现** | 阶段 1 |
| 图层拖拽、项目持久化 | **未实现** | 阶段 1 |
| 取消瞬间的显存/内存回收 | **未量化** | 只有"可再次成功导出"的行为证据，没有 Memory 面板采样 |

## 5. 验证过程中的修正（避免误报）

1. 首次 e2e 因 `favicon` 404 白名单不匹配而失败 → 补充 `src/app/icon.svg` 并放宽静态资源白名单，属于测试噪声而非功能缺陷。
2. 「3D 主体存在」的初版判据是相邻像素差（60×60 采样块），在白色宇航服区域返回 0，误报失败。改为中央区域**亮度标准差/极差**后通过；这是判据设计问题，不是渲染问题（同帧图像肉眼可见 3D 主体）。
3. `normalizeObject` 初版用"缩放前的包围盒中心"做平移，模型自带位移时会偏移（单测发现）。改为缩放后重新测量再平移。

## 6. 复现步骤

```bash
npm install
npm run verify        # typecheck + lint + unit + build
npm run test:e2e      # 需要上一次 build 产物；使用本地 Chrome
```

产物（可重复生成，已 gitignore）：

```
.verification/still.png        1080×1920 合成静帧
.verification/export.mp4       真实 MP4（5.00s / 150 帧 / 4.86MB）
.verification/mp4-frame.png    从 MP4 解码出的 2.1s 帧
.verification/export-report.json  MP4 结构 + 播放 + 内容检测的原始数据
```

---

# 阶段 1 增量 · 图层交互（本轮交付）

目标：在**不修改** `src/lib/layers/render.ts`（Canvas2D 光栅器）与 `src/lib/export/*`（导出链路）的前提下，实现命中测试、选中、拖动、缩放、键盘与触摸操作。

## 1. 执行的命令与真实结果

| 命令 | 结果 | 关键输出 |
|---|---|---|
| `npm run typecheck` | 通过 | 0 error |
| `npm run lint` | 通过 | 0 error / 0 warning（`.verification/**` 已加入忽略） |
| `npm run test` | 通过 | **6 文件 / 74 用例**（新增 `layer-transform.test.ts` 29 例） |
| `npm run build` | 通过 | `/lab` 296 kB（上一版 293 kB，+3 kB 未压缩，**零新增依赖**；First Load 399 kB） |
| `npx playwright test` | 通过 | **11 / 11**，40.2s（新增 `layer-editing.spec.ts` 5 例） |

## 2. 验收项逐条

| 要求 | 结果 | 证据 |
|---|---|---|
| 三种图层均可点选 | 通过 | e2e 逐个点击 text / price / watermark，断言 `aria-pressed=true` 且 chrome 出现 |
| 三种图层均可拖动 | 通过 | 拖 5%×3% → `left` 增量 4.2–5.8、`top` 增量 2.2–3.8，尺寸不变 |
| 至少一种缩放方式 | 通过 | 四角手柄；拖 se 角 → `width` +3.2~4.8%、`height` +1.5%，左上角不动 |
| 键盘操作 | 通过 | 方向键 ±0.5%、Shift 加速、Ctrl+方向键 ±1% 缩放、Esc 取消选择 |
| 写回归一化 rect | 通过 | 单测：任何画幅下 `left%/top%` 与 store 一致；DOM 只出现百分比样式 |
| 舞台 CSS 缩放 / 画幅 / DPR / resize 不漂移 | 通过 | 9:16→1:1→16:9→1280×720→9:16 后 `left%` 保持不变；视口 1440→1180 后仍可准确拖动 4% |
| 触摸不滚动、不阻塞其他控件 | 通过 | CDP 触摸拖动 → `left` +6%，`scrollY` 保持 0，`touch-action: none`；空白处仍可旋转商品 |
| 焦点 / aria-label / 选中态 | 通过 | 每图层 `role=button`、`tabIndex=0`、`aria-label`、`aria-pressed`、`aria-keyshortcuts`、`:focus-visible` 焦点框 |
| 拖拽不触发整页重渲染 | 通过 | pointermove 仅写 draft + DOM style，rAF 合帧；整段拖拽只写 1 次 store |
| 不阻塞 3D 控制 | 通过 | 拖图层时到达 WebGL canvas 的 `pointerdown` = **0**；空白拖拽 = 1（轨道正常） |
| 保留属性面板 / 删除 / 层级 | 通过 | 面板未改动；删除选中图层后 chrome 自动卸载；zIndex 参与命中排序 |
| 导出与编辑器同位置 | 通过 | 导出 PNG（1080 宽）中价格标签左边缘 = **216px = 0.2000**，编辑器 `left = 20%`，逐像素一致 |
| 选择框不进导出 | 通过 | 选中导出 vs 取消选中导出：1080×1920 **逐像素 diff = 0**（边界/手柄均为 DOM） |
| 无新依赖 | 通过 | `package.json` 未新增运行时依赖（未引入 Konva / Pixi，理由见 DECISIONS D12） |

## 3. 本轮修复的两个真实缺陷（由测试暴露）

1. **可访问名被污染**：`Segmented` 用 `<label>` 包裹按钮组，隐式标签把「画幅」拼进第一个按钮的可访问名（"画幅 竖屏"），屏幕阅读器与 `getByRole(button, name)` 都会读错。改为 `div + span`，并给选中项补 `aria-pressed`。
2. **≤1280px 布局重叠**：导出面板在第 2 行时，网格行高被压缩，面板覆盖到舞台下半区并吞掉指针事件（表现为"拖动无反应"）。改为该断点下整页滚动（`.lab { height: auto }`），舞台重新可交互。

## 4. 本轮未实现（明确记录）

- 旋转手柄（旋转仍只能通过属性面板滑杆）。
- 多选 / 成组、撤销重做栈（因此键盘 Delete 故意未绑定）。
- 图层锁定开关（`hitTestLayers` 已支持跳过锁定图层，但没有 UI 入口）。
- 图层吸附、对齐参考线。

---

# 阶段 1 增量 · 图片素材（本轮交付）

目标：真实的图片素材入口（PNG / JPEG / WEBP，默认 50MB），只存浏览器内存；上传后可真正"作为图片图层使用"，并保证替换/重置/卸载时不泄漏。

## 1. 执行的命令与真实结果

| 命令 | 结果 | 关键输出 |
|---|---|---|
| `npm run typecheck` | 通过 | 0 error |
| `npm run lint` | 通过 | 0 error / 0 warning |
| `npm run test` | 通过 | **7 文件 / 105 用例**（新增 `image-asset.test.ts` 31 例） |
| `npm run build` | 通过 | `/lab` 301 kB / First Load 407 kB（图片面板 + 上传链路，零新增依赖） |
| `npx playwright test` | 通过 | **20 / 20**，44.9s（新增 `image-assets.spec.ts` 9 例；原有 11 例全部通过 = 无回归） |

测试素材全部是**真实编码**的图片：由浏览器 Canvas 的 `toDataURL('image/png' | 'image/jpeg' | 'image/webp')` 生成后落盘，再用 `<input type=file>` 上传，走的是用户同一条路径。

## 2. 验收项逐条

| 要求 | 结果 | 证据 |
|---|---|---|
| PNG 成功用例 | 通过 | 上传 400×400 PNG → `data-status=ready`、文件名/大小显示、`0 → 1 个图层` |
| JPEG 成功用例 | 通过 | 同上（`.jpg` + `image/jpeg`） |
| WEBP 成功用例 | 通过 | 同上 |
| 损坏文件失败 | 通过 | 文本内容伪装成 `.png` → 「文件内容不是有效的 PNG / JPEG / WEBP 图片（可能已损坏）」，且不产生素材卡片 |
| 超大文件失败 | 通过 | 51MB `.png` → 「图片 51.0 MB 超过 50.0 MB 上限」，**在读字节之前**被拦截（0 字节读入） |
| 扩展名 / MIME / 大小 / 解码 四层校验 | 通过 | 单测覆盖 EMPTY / EXTENSION / MIME / MIME 不一致 / TOO_LARGE / 签名不符 / 尺寸异常 |
| 点击选择 + 拖拽上传 | 通过 | 拖拽用例用 `DataTransfer` 派发 `drop` → `dragged.png` 就绪 |
| 文件名 / 大小 / 进度 / 成功 / 中文错误 | 通过 | 读取阶段显示百分比（`FileReader.onprogress` 真实进度），解码阶段显示「解码中…」 |
| 「作为图片图层使用」真实生效 | 通过 | 等比 rect（400×400 源图在 9:16 画布上仍是正方形，误差 < 0.1），可选中、可拖动、可缩放 |
| 图片进入真实 MP4 | 通过 | 拖动后导出 5.00s MP4，解码 0.5s 帧（1080×1920）：洋红块 **420,232 像素**，bbox `left 0.2500 / top 0.3250 / right 0.8704 / bottom 0.6750`，与编辑器 rect（25% / 32.5% / 62% / 34.875%）一致，误差 < 0.1% |
| 重复上传释放旧 URL | 通过 | 注入计数器：两次上传后 `created ≥ 2`、`revoked ≥ 1`、`live = 1`、`bitmap.close ≥ 1` |
| 离开编辑器不泄漏 | 通过 | 上传后点「← 项目概览」客户端跳转 → `live = 0`、`revoked ≥ 1`、`closed ≥ 1` |
| 重置工程 | 通过（代码路径） | 重置按钮同时 `imageRegistry.clear()` + 清空 `images`；未单独写 e2e（与卸载共用 `clear()`） |
| 导出取消不泄漏 | 通过（沿用既有 e2e） | 图片不参与所有权转移，导出只读位图；取消用例（lab.spec）仍通过 |
| store 不保存 Blob/Bitmap/Element/Canvas | 通过 | 单测：`JSON.stringify(images)` 不含 `blob:`，深拷贝等于原值；类型层面 `ImageAssetMeta` 无 DOM 字段 |
| 不破坏 GLB / 材质 / 灯光 / 图层 / 模板 / 导出 | 通过 | 原有 11 条 e2e（含 GLB 卸载 dispose、MP4 导出、取消重试、图层拖拽）全部通过 |

## 3. 明确未实现（边界）

- ~~模型材质贴图~~ / ~~上传取消~~：已在下一节补完。
- **多素材库 UI**：store 里已经是 `Record<id, meta>`，但面板一次只展示"当前素材"。
- **贴图 UV/投影编辑**：贴图沿用 GLB 自带 UV，没有投影映射/UV 编辑能力。
- 素材仅存活于当前会话，刷新即丢失（与 D10 无持久化一致）。

## 4. 复现

```bash
npm run build
npx playwright test tests/e2e/image-assets.spec.ts
# 产物：.verification/image-layer.mp4 / .verification/fixtures/*.png|jpg|webp
```

---

# 阶段 1 增量 · 商品贴图 + 上传取消（补完上一节的两个 TODO）

## 1. 执行的命令与真实结果

| 命令 | 结果 | 关键输出 |
|---|---|---|
| `npm run verify` | 通过 | **7 文件 / 112 用例**（新增 5 条贴图单测、2 条取消单测），lint 0 warning，build OK |
| `npx playwright test` | 通过 | **22 / 22**，51.0s（新增 2 条贴图 e2e；原有 20 条全过） |

## 2. 验收项

| 要求 | 结果 | 证据 |
|---|---|---|
| 图片可贴到商品材质 | 通过 | 应用后导出静帧对比：**changed > 2% 像素**、`maxDelta > 40`（棋盘图覆盖宇航员，见 `.verification/material-texture-ui.png`） |
| 复用现有材质生命周期 | 通过 | 纹理由 `ProductModel` 的 effect 创建/释放；`disposeObject3D` 跳过 `userData.external`，并显式释放被"停放"的原始 map；恢复时归还 `map` 与 `color` |
| 区分图片图层 / 模型纹理 | 通过 | `ImageLayer.assetId` 与 `MaterialConfig.mapAssetId` 两套字段、两条渲染路径，互不影响 |
| 恢复模型贴图 | 通过 | 恢复后与最初导出帧 `maxDelta ≤ 2`、平均差 < 0.2（材质重编译导致的 ±1 舍入，已记录在 D13） |
| 贴图占用保护 | 通过 | 贴图生效时移除素材 → 中文提示「该素材正作为商品贴图使用，请先恢复模型贴图」；恢复后可正常移除 |
| 上传取消 | 通过 | 面板「取消上传」；单测：已 abort 的 signal 在读取字节前即拒绝（`ABORTED`），且校验优先（`.gif` 仍报 `EXTENSION`） |
| 不破坏既有功能 | 通过 | GLB 卸载 dispose、材质/灯光、图层拖拽、模板、MP4 导出、导出取消重试 —— 原有 20 条 e2e 全部通过 |
| 资源所有权（单测） | 通过 | external 纹理不被 `disposeObject3D` 释放；停放的原始贴图会被释放；`apply/restore` 幂等 |

## 3. 仍未做

- 多素材库管理界面（当前是"单槽 + 元数据表"，重复上传会释放未被引用的旧素材）。
- 贴图的 UV/投影编辑。
