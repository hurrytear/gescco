---
{"title":"用 ChatGPT + Skill 创建短视频：从脚本、分镜到 MP4 导出","category":"AI 与自动化","kind":"实践笔记","date":"2026-10-19","summary":"以 45 秒 DNS 排障知识短片为例，用 ChatGPT、Remotion Skill 和可复用的 SKILL.md 串起脚本、素材、配音、字幕、预览、导出与交付验收。","tags":["ChatGPT","Skill","Remotion","短视频","FFmpeg"]}
---
把一篇运维笔记变成短视频，难点往往是控制信息量、安排画面与旁白、修订字幕，以及稳定导出成片。本文以“45 秒 DNS 排障知识短片”为例，介绍 ChatGPT 配合 Skill 的制作方法，适合技术科普、产品说明和内部培训。

资料核对于 2026-10-19。本文提供制作流程与示例，不附已经渲染的演示视频；没有调用付费配音或视频生成服务。界面和功能以实际账号为准。

## 01 / ChatGPT、Skill 和渲染工具分别做什么

ChatGPT 用于提炼主题、编写口播、设计分镜和提出修改；能够使用文件与执行工具的 ChatGPT Work / Codex 环境，还可以编辑项目、运行预览和导出。能力受账号、运行环境及工作区设置影响，普通文本对话能给出脚本，不代表已经产生可下载的视频。[ChatGPT 的工作方式](https://learn.chatgpt.com/docs/use-chatgpt)。

Skill 是一组可复用的指令和辅助资源，通常以 `SKILL.md` 为入口。它可以要求每次先检查素材、再生成分镜、最后验证文件；MCP / 插件工具或本地程序负责实际读取、生成和渲染。安装 Skill 不会自动获得视频模型、语音服务或外部账号权限。[Skills 的组成与工具分工](https://developers.openai.com/plugins/concepts/skills)。

本文选择 Remotion：由 React 项目定义文字、图形和时间线，再渲染为视频。Remotion 官方提供 Agent Skills，适合让代理按自然语言修改视频工程。技术知识卡片无需依赖生成式视频模型，使用可编辑文字、箭头、图标与授权录屏即可完成。[Remotion Agent Skills](https://www.remotion.dev/docs/ai/skills)。

```text
主题与资料 → ChatGPT 提炼脚本 → 分镜与时间线
                     ↓
          Skill 约定制作步骤、目录和验收
                     ↓
       Remotion 工程 + 素材 + 配音 + 字幕
                     ↓
            预览 → 定点修改 → 渲染
                     ↓
            MP4、封面、字幕与检查报告
```

## 02 / 先给清楚的制作要求

本例做一条 9:16 竖屏知识短片：1080 × 1920、30 fps、45 秒，目标观众为刚接触运维的工程师。画面采用明亮蓝白背景、黄色重点标记，开头提出问题，中间给出排查顺序，结尾留下一个可以执行的检查清单。

技术内容可参考本站 [DNS 排障笔记](/notes/dns-debugging/)，先挑选“比较终端、递归与权威答案”这一条主线。一个短片不要塞入完整 DNS、DNSSEC、CDN 和 HTTPS 教程；没有时间讲清的内容放在图文说明中。

把以下要求交给 ChatGPT，得到制作简报后再进入工程：

```text
制作一条 45 秒、9:16、1080×1920、30fps 的中文运维知识短视频。
主题：域名打不开时，如何分层检查 DNS。
观众：初级运维工程师。
风格：明亮蓝白配色，黄色强调，文字清晰，减少装饰动画。
内容：先记录终端解析路径，再比较递归与权威答案，最后单独验证 HTTPS。
先输出：一句话目标、6 个分镜、逐镜口播、屏幕短句与素材清单。
使用 example.com 等示例；不读取真实终端配置，不展示内部地址或真实日志。
不要自动安装新工具、调用付费服务或发布到外部平台。
缺少配音时先交付明确标记的无配音预览，不冒充有声成片。
```

“不要自动安装”是这个示例对制作阶段的约束。后面的初始化步骤属于你主动选择并核对依赖的准备过程，两者并不冲突。

## 03 / 准备 Remotion 与 Skill

如果 ChatGPT 桌面端的插件目录提供 Remotion，可检查来源、所需权限和说明后安装，在新任务中明确选用对应 Skill。官方同时提供了通过编码代理操作本地工程的路径；下面以这一条路径说明。没有插件入口时，不需要假定自己拥有同样的集成能力。[Remotion 项目入口](https://www.remotion.dev/docs/)。

先准备受当前模板支持的 Node.js 和系统环境。以下命令会从 npm 下载并执行项目脚手架、创建 `ops-short-video` 目录，并安装 / 配置相关依赖或 Skill；在独立工作目录使用，不能在本站代码目录中直接混入视频依赖。执行前核对官方来源与命令提示：

```sh
# 在独立工作目录运行；会下载并执行脚手架，不能覆盖已有同名项目。
npx create-video@latest --yes --blank ops-short-video
cd ops-short-video

# 在当前视频项目内按向导安装官方 Remotion Skill。
npx remotion skills add

# 版本核对；保存 lockfile，便于后续使用同一依赖集。
node --version
npm ls remotion @remotion/cli

# 启动本地预览；另开一个终端或代理会话继续修改工程。
npm run dev
```

这组初始化步骤依据 [Remotion 编码代理入门](https://www.remotion.dev/docs/ai/coding-agents)。`@latest` 方便首次创建，但会随时间变化；验收后保留 `package.json`、lockfile、Node 版本与渲染版本，后续在相同环境中使用 `npm ci` 重建，不为每次修改重复升级全部依赖。

在代理里打开这个视频项目，确认已发现 Remotion Skill，并明确要求使用它。当前 ChatGPT 可通过 `@` 选择 Skill，Codex CLI / IDE 可通过 `$` 或 `/skills` 选择；具体名称以已安装列表为准，不要把示例 Skill 名当成已存在工具。

## 04 / 把固定流程写成自己的 SKILL.md

Remotion Skill 解决工程实现，你可以再用一个小型工作流 Skill 规定内容和交付标准。下面的 `ops-short-video` 是本文自定义示例，不是官方自带名称。Codex 项目可保存到 `.agents/skills/ops-short-video/SKILL.md`；其他界面应使用支持的创建 / 导入入口，不能把本地目录路径当成所有产品通用的安装方法。[Skill 创建、发现与调用](https://learn.chatgpt.com/docs/build-skills)。

下面是完整的指令模板。它约束制作过程，本身不会替你安装 Remotion 或生成配音：

```text
---
name: ops-short-video
description: 将公开技术笔记制作成 30–60 秒知识短视频；用于脚本、分镜、Remotion 工程、字幕和交付检查，不用于自动发布。
---

目标：交付可编辑工程、预览、最终 MP4、封面、SRT 字幕和检查报告。

1. 读取用户指定的公开资料，确认观众、时长、比例、语言和输出目录。
2. 列出实际可用的渲染、字幕和配音工具，缺失能力必须说明。
3. 先写口播和分镜，保证技术结论有依据，示例不使用真实业务数据。
4. 在独立视频项目中实现；需要 Remotion 时使用已安装的官方 Skill。
5. 所有时间以帧数管理；每镜写明起止帧，避免重叠和空档。
6. 素材保留来源记录；旁白不够短时先改稿，不强行加速到难以听清。
7. 先提供静帧和低分辨率预览，再根据明确的镜头与时间位置修改。
8. 逐段听看，检查字幕、字体、音画同步、技术结论和敏感信息。
9. 渲染后检查编码、尺寸、帧率、时长与音轨；失败时不称为已完成。
10. 输出真实存在的文件路径、检查结果和限制；不自动发布或覆盖原素材。
```

在新会话测试三个请求：“制作一条知识短片”“只修改第 3 镜字幕”“只总结文章”。前两个应能进入适当步骤，第三个不应强行启动视频工程。模板中的验收规则必须与实际工具对应，不能仅靠写了“检查”就认定已经执行过。

## 05 / 用分镜与帧数管理 45 秒时间线

本例采用 6 镜，每镜只表达一个观点。下面口播是初稿，应试读后调整，而不是承诺任何配音音色都正好符合时长。

- 第 1 镜，0–4 秒：标题“域名打不开，先查哪一层？”；口播“域名打不开，别急着清缓存。”
- 第 2 镜，4–10 秒：画面“终端 → 实际解析器”；口播“先核对终端实际使用的解析器，保存现象和报错。”
- 第 3 镜，10–18 秒：显示 A、AAAA、状态码与 TTL 四张卡片；口播“再查询递归解析器，记录地址、状态码和 TTL。”
- 第 4 镜，18–27 秒：对比递归与权威答案；口播“对照权威答案。两者不同，再分析缓存、记录和解析路径。”
- 第 5 镜，27–38 秒：将 DNS 与 HTTPS 检查分成两条路径；口播“解析正常，也要继续验证 HTTPS。不要把所有连接故障都归为 DNS。”
- 第 6 镜，38–45 秒：总结“记录 → 对比 → 验证”；口播“保留查询时间与结果，用证据缩小范围。”

45 秒 × 30 fps = 1350 帧。把下面内容保存为工程的 `timeline.json`，要求代理显式读取并用于生成合成配置；这是**本文自定义的数据格式**，Remotion 不会自动识别这些字段：

```json
{
  "videoId": "dns-first-check",
  "width": 1080,
  "height": 1920,
  "fps": 30,
  "durationInFrames": 1350,
  "scenes": [
    {"id": "hook", "startFrame": 0, "endFrame": 120},
    {"id": "client", "startFrame": 120, "endFrame": 300},
    {"id": "recursive", "startFrame": 300, "endFrame": 540},
    {"id": "authoritative", "startFrame": 540, "endFrame": 810},
    {"id": "https", "startFrame": 810, "endFrame": 1140},
    {"id": "recap", "startFrame": 1140, "endFrame": 1350}
  ]
}
```

起始帧包含、结束帧不包含，因此每镜长度为 `endFrame - startFrame`，最后一帧是 1349。转场若跨越边界，应安排在既定帧预算内，避免每次转场都额外增加时长。

## 06 / 让代理建立能继续修改的工程

不要只要求“生成视频”，还要约定工程结构和真实交付物。本例工程中保留 `brief.md`、`storyboard.md`、`timeline.json`、React 源码、字幕、素材来源记录和渲染输出。生成的代码需要注册真实的 composition，下面约定 ID 为 `OpsShort`，封面使用单独的 Still ID `OpsCover`。

```text
使用已安装的 Remotion Skill，在当前视频项目实现已确认的分镜。
读取 timeline.json，并让合成尺寸、fps、总帧数和各镜时长与其一致。
注册视频 composition：OpsShort；注册静态封面 Still：OpsCover。
把口播、屏幕短句和字幕分开管理，屏幕标题不要直接塞入整段口播。
素材放在项目 public/ 下，按当前 Remotion 版本的静态资源方式引用。
先检查可用字体、音频和工具，再决定实现；不使用不存在的文件或 URL。
暂缺配音时标记无配音预览，列出尚未完成项。
先输出第 0、300、810、1349 帧的预览和低分辨率样片。
保留源工程，最终导出 MP4、封面 JPG、SRT 和检查报告。
不要发布到任何平台，不上传原始素材到未指定的外部服务。
```

本地素材可使用 `public/` 与 `staticFile()` 等受支持方式；不要依赖另一台电脑不存在的绝对路径或带短期签名的资源 URL。[Remotion 素材引用](https://www.remotion.dev/docs/assets)。动画应按帧计算，避免用当前时间或每次渲染变化的随机数决定画面；这有助于预览和导出保持一致。[按帧驱动动画](https://www.remotion.dev/docs/use-current-frame)。

## 07 / 配音、字幕与素材的处理顺序

先试读口播，再录音或使用明确可用的配音工具；按实际语音长度微调停顿与镜头。不要把“聊天能朗读”当成已经获得可下载、可再编辑的配音文件。若使用生成服务，先确认可用性、用途、预算与声音授权，再实际调用。

字幕应跟随最终配音，而非只按字符数量平均切分。保留独立 SRT，便于复核和二次剪辑；画面里的标题可以更短，但不能改变技术含义。纯粹导出 SRT 不会自动把字幕烧录进 MP4，烧录需要在 Remotion 工程或后期工具中实现。

- 字体：在渲染环境中固定使用支持中文的字体，验证授权和加载完成后再渲染，不能只依赖作者电脑的系统字体。
- 排版：竖屏底部和右侧给平台按钮、标题区域留空间；安全区按实际目标平台预览，不采用一个通吃所有平台的固定像素承诺。
- 声音：旁白清楚，背景音乐不盖住人声；检查片头、转场和结尾的音量突变、削波和突然截断。
- 录屏：提前关闭通知、隐藏凭证和身份信息；命令输出使用脱敏的演示数据，不能伪装成真实生产测试。
- 素材：记录来源、使用范围、字体和音乐信息。AI 生成图片中的终端命令或小字应改用可编辑文字重建并校对。
- 旧字幕：源视频中的硬字幕属于像素，不能通过替换 SRT 直接消除。需要局部修复或重新制作画面，并逐帧检查残留。

没有配音时可以先验收排版预览；最终若约定交付有声短片，就必须补齐音轨和完整听看验收，不能用静音预览代替。

## 08 / 先看预览，再做定点修改

先确认 composition ID 和配置真实存在，再抽取代表帧。以下命令在已实现的 Remotion 工程内运行，会创建检查目录和图片，不会替你生成缺失的工程：

```sh
# 检查视频合成与封面 ID、尺寸、fps 和总帧数。
npx remotion compositions
mkdir -p out/review

# 第 300 帧是 10 秒处，检查第 3 镜的字号、布局和示例内容。
npx remotion still OpsShort out/review/frame-0300.png --frame=300

# 检查最后一帧，避免片尾黑屏、文字提前消失或内容被截断。
npx remotion still OpsShort out/review/frame-1349.png --frame=1349
```

命令选项分别见 [compositions](https://www.remotion.dev/docs/cli/compositions) 与 [still](https://www.remotion.dev/docs/cli/still)。静帧只能验证画面，还需看样片、听声音、检查转场。可以先按原 composition 使用 `--scale=0.5` 导出低分辨率样片；这只改变输出尺度，不把内容比例改成另一种布局。

反馈要带时间位置和修改范围，例如：“10–18 秒的 TTL 卡片字号增大，第二行不超过一屏；保留旁白和配色”。修改后重查受影响镜头及相邻转场，再看整片，避免为改一个字重新生成全部内容。

## 09 / 导出 MP4，并检查真实文件

确认字体、素材、配音与字幕都已接入后再导出。下面假定已经注册 `OpsShort` 和 `OpsCover`；H.264、AAC 与 `yuv420p` 是本例的交付选择，目标平台有其他要求时按其规格调整。命令会消耗本机计算资源和磁盘空间，输出目录如有旧结果应先保留或换版本名。

```sh
mkdir -p out/review

# 先导出半尺寸样片：540×960，仍保留 30fps 和 45 秒时间线。
npx remotion render OpsShort out/review/dns-preview-v1.mp4 \
  --codec=h264 --audio-codec=aac --pixel-format=yuv420p --scale=0.5

# 预览验收后，按 composition 的完整尺寸渲染成片。
npx remotion render OpsShort out/dns-zh-v1.mp4 \
  --codec=h264 --audio-codec=aac --pixel-format=yuv420p

# OpsCover 必须是已经注册、按封面尺寸设计的 Still。
npx remotion still OpsCover out/dns-cover-v1.jpg
```

可用选项以项目安装版本为准，参见 [Remotion render CLI](https://www.remotion.dev/docs/cli/render)；封面注册方式见 [Still 组件](https://www.remotion.dev/docs/still)。如果 composition 没有音频，指定 AAC 编码器也不会自动生成旁白。

安装有 FFmpeg / ffprobe 的环境可读取最终文件的实际媒体信息。下面只读取本地 MP4，不上传文件；它不能替代播放检查：

```sh
# 输出视频与音频流信息，便于保存到检查报告。
ffprobe -v error \
  -show_entries 'format=duration:stream=index,codec_type,codec_name,width,height,pix_fmt,avg_frame_rate,sample_rate,channels,duration' \
  -of json out/dns-zh-v1.mp4
```

核对尺寸 1080 × 1920、视频 30 fps、时长约 45 秒、视频编码和像素格式，并在有声交付中确认存在音轨。音频编码边界可能带来微小的流时长差异，不只凭容器时长判断同步。再在手机上完整播放，检查首尾、字幕、画面裁切和声音。[ffprobe 的流信息检查](https://ffmpeg.org/ffprobe.html)。

## 10 / 中英文版本、成本与交付目录

英文版要重新试读与分句，不是直接将中文字幕替换成英文后沿用所有时间点。先维持相同信息结构；如果英文口播放不下，缩短措辞或调整各镜预算，仍然检查总时长。英文旁白、字幕与屏幕文字都需同步替换，不能只翻译其中一项。

建议输出 `dns-zh-v1.mp4`、`dns-en-v1.mp4`，并分别提供同语言的 SRT；共享授权图片和配色，独立管理文字与音频。交付目录还应包含封面、项目源码、lockfile、来源记录和 `checks.md`。报告注明实际渲染版本、已执行检查与限制，不能只列一个计划中的文件名。

成本分为代理使用额度、图片 / 配音等服务调用、本机渲染时间和可能的云渲染费用。Skill 文件本身不提供这些额度；使用 Remotion 前核对实际用途对应的 [许可证与条款](https://www.remotion.dev/docs/license)，不要把安装成功等同于所有商业使用都免费。本文不指定固定价格或承诺渲染时长。

工程和素材保留原件，版本修改写入新输出；验收后再清理可重新生成的缓存与样片。发布到短视频平台是独立步骤，应在最终成片、封面和说明确认后执行。

## 11 / 常见问题与验收清单

- Skill 没有出现：核对入口、安装作用域和实际名称，确认当前代理发现了它。不要反复在不同目录安装同名副本。
- 只生成了脚本或 React 文件：检查渲染工具是否可用、composition 是否存在、导出是否成功，缺少 MP4 就明确说明未完成。
- 本地预览正常、导出缺图或乱码：检查素材路径、字体加载、网络依赖与运行环境差异，优先使用可复现的本地资产。
- 字幕挤满屏幕：将屏幕短句与完整口播分开，按语义断行；不要只缩小字体。
- 音画不同步：以最终音频重新校准字幕和镜头，检查开头静音、采样率、剪切与结尾留白。
- 技术内容看似流畅但不准确：逐条回查原始资料；解析失败、网络失败和 HTTPS 失败要分别表达。

最终交付需要同时满足：文件真实存在且可播放；内容准确；字幕清楚；所需音轨完整；比例、尺寸与时长正确；中英文匹配各自配音；素材来源有记录；源码能继续编辑。自动检查只能覆盖其中一部分，完整听看依然必要。

## 参考资料

- [OpenAI：使用 ChatGPT、Work 与 Codex](https://learn.chatgpt.com/docs/use-chatgpt)
- [OpenAI：Skills 与工具的分工](https://developers.openai.com/plugins/concepts/skills)
- [OpenAI：创建与使用 Skill](https://learn.chatgpt.com/docs/build-skills)
- [Remotion：创建项目与 ChatGPT 入口](https://www.remotion.dev/docs/)
- [Remotion：编码代理入门](https://www.remotion.dev/docs/ai/coding-agents)
- [Remotion：Agent Skills](https://www.remotion.dev/docs/ai/skills)
- [Remotion：素材引用](https://www.remotion.dev/docs/assets)
- [Remotion：useCurrentFrame](https://www.remotion.dev/docs/use-current-frame)
- [Remotion：列出合成](https://www.remotion.dev/docs/cli/compositions)
- [Remotion：导出静帧](https://www.remotion.dev/docs/cli/still)
- [Remotion：导出视频](https://www.remotion.dev/docs/cli/render)
- [Remotion：Still 组件](https://www.remotion.dev/docs/still)
- [FFmpeg：ffprobe](https://ffmpeg.org/ffprobe.html)
- [Remotion：许可证与条款](https://www.remotion.dev/docs/license)
