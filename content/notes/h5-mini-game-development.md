---
{"title":"制作 H5 小程序游戏：从 Canvas 原型到微信小游戏接入","category":"Web 与小游戏","kind":"实践笔记","date":"2026-10-29","summary":"用一个完整的 30 秒点击得分游戏，讲清 H5、微信小程序 web-view 与微信小游戏的区别，覆盖 Canvas、触控缩放、暂停计时、平台适配、部署和安全验收。","tags":["H5","Canvas","JavaScript","微信小游戏","小程序"]}
---
“H5 小程序游戏”常被用来概括几类不同产品：浏览器里的小游戏、微信小程序内嵌的网页，以及独立的微信小游戏。它们可以共享部分玩法代码，但运行环境、平台能力和发布入口不同。本文先制作一个完整的 Canvas 点击游戏，再说明如何选择接入路径，适合第一次做交互原型或把技术演示做成小游戏的开发者。

资料核对于 2026-10-29。下文四个文件组成可独立运行的浏览器原型，不依赖框架、账号、图片服务或后端；微信部分是接入与迁移说明，没有创建或提交真实微信项目。

## 01 / 先确定是 H5、小程序，还是微信小游戏

- H5 网页游戏：使用 HTML、CSS、JavaScript 与 Canvas，在浏览器或支持它的内嵌浏览器中运行，通过 HTTPS 地址分发。[Web 游戏开发概览](https://developer.mozilla.org/en-US/docs/Games/Introduction)。
- 普通微信小程序：使用小程序页面、组件与平台 API；可以按能力和业务需要使用 Canvas，不能把任意 HTML 当成 WXML 使用。
- 小程序中的 web-view：在符合条件的小程序里打开一个已经部署的网页，仍需维护网页和小程序两个部分。官方文档目前注明个人类型小程序暂不支持该组件，其他网页需在后台配置业务域名。[web-view 组件](https://developers.weixin.qq.com/miniprogram/dev/component/web-view.html)。
- 微信小游戏：有独立运行环境、开发者工具项目和平台 API，不能假定存在浏览器完整的 `window`、`document` 与 DOM。引擎导出或 Adapter 可以处理部分差异，但不是任意网页的一键转换器。[小游戏 Adapter](https://developers.weixin.qq.com/minigame/dev/guide/runtime/adapter.html)。

只有“在微信里能打开网页”不能证明已经发布为微信小游戏。先确认自己的账号类型、可用能力和目标用户入口，再选实现方式；平台准入、类目与审核要求以当前后台和官方说明为准。

## 02 / 把第一个版本缩成一个玩法闭环

示例叫“30 秒点击得分”：点击黄色圆点加一分，命中后目标换位置；点空白不加分；倒计时结束后禁止继续得分。玩家可以暂停、继续和重新开始，切到后台时自动暂停，回来后主动继续。

采用 360 × 480 的逻辑坐标，让玩法不依赖具体手机像素。第一版只做单机、无奖励的练习，不接账号、支付、广告、排行榜和联网对战。这些功能各自涉及额外状态、接口、平台能力和验收，不应和基础点击逻辑同时展开。

```text
tap-dot/
  index.html   页面与按钮
  style.css    布局、触控区域与安全区
  core.mjs     玩法状态、计时、命中和 Canvas 绘制
  web.mjs      浏览器输入、缩放与生命周期适配

ready → running → over
          ↕
        paused
```

核心模块接收坐标和时间；浏览器适配层负责把真实输入转换进去。将来迁移到小游戏时，优先保留玩法，重写平台相关的部分。

## 03 / 创建页面与手机布局

在独立目录 `tap-dot` 中保存以下四个文件。原型界面使用英文短标签，便于中英文示例共用；正式产品可以抽取语言字典。代码在文章中仅展示，不会在本站文章页面里直接运行。

先保存 `index.html`。Canvas 负责画面，原生按钮负责开始与暂停；不要禁用整个页面的缩放能力：

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Tap the Dot</title>
  <link rel="stylesheet" href="./style.css">
  <script type="module" src="./web.mjs"></script>
</head>
<body>
  <main>
    <h1>Tap the Dot</h1>
    <p>Tap the yellow dot. Score as much as you can in 30 seconds.</p>
    <canvas id="game" width="360" height="480" aria-label="Tap the yellow target">
      This game needs Canvas and JavaScript.
    </canvas>
    <p id="status" role="status">Ready</p>
    <div class="controls">
      <button id="start" type="button">Start / restart</button>
      <button id="pause" type="button" disabled>Pause</button>
    </div>
  </main>
</body>
</html>
```

再保存 `style.css`。`touch-action: none` 只作用在游戏画布，避免触摸目标时拖动页面，不影响整页正常操作。按钮保留可见焦点和至少 44px 的高度。[Pointer Events 与触控行为](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events/Using_Pointer_Events)。

```css
:root { color-scheme: light; font-family: system-ui, sans-serif; background: #edf6ff; color: #173454; }
* { box-sizing: border-box; }
body { margin: 0; padding: 20px 16px calc(20px + env(safe-area-inset-bottom)); }
main { width: 100%; max-width: 360px; margin: auto; }
h1 { margin: 0 0 8px; }
p { line-height: 1.6; }
canvas { display: block; width: 100%; height: auto; aspect-ratio: 3 / 4; border-radius: 20px; touch-action: none; }
.controls { display: flex; flex-wrap: wrap; gap: 12px; }
button { min-height: 44px; padding: 10px 18px; border: 0; border-radius: 14px; background: #2463df; color: white; font: inherit; cursor: pointer; }
button:disabled { opacity: .5; cursor: default; }
button:focus-visible { outline: 3px solid #d98200; outline-offset: 3px; }
```

这还是指针操作原型。正式产品应补充等价的键盘玩法、读屏说明、声音开关与减少动态效果选项，并按目标用户验证。

## 04 / 编写可复用的核心玩法

保存 `core.mjs`。`createGame()` 不访问 DOM，不发请求；它接收时间戳并维护状态。`draw()` 只使用传入的 2D context，便于后续替换宿主环境。

```js
export const WIDTH = 360, HEIGHT = 480, RADIUS = 30;

export function createGame(random = Math.random) {
  const state = { phase: 'ready', score: 0, remaining: 30, target: { x: 180, y: 260 } };
  let last = 0;
  const spawn = () => {
    state.target = { x: 42 + random() * 276, y: 110 + random() * 328 };
  };
  function tick(now) {
    if (state.phase !== 'running') return;
    state.remaining = Math.max(0, state.remaining - Math.max(0, now - last) / 1000);
    last = now;
    if (state.remaining === 0) state.phase = 'over';
  }
  function start(now) {
    Object.assign(state, { phase: 'running', score: 0, remaining: 30 });
    last = now;
    spawn();
  }
  function tap(x, y, now) {
    tick(now);
    if (state.phase !== 'running') return false;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (Math.hypot(x - state.target.x, y - state.target.y) > RADIUS) return false;
    state.score += 1;
    spawn();
    return true;
  }
  function pause(now) {
    tick(now);
    if (state.phase === 'running') state.phase = 'paused';
  }
  function resume(now) {
    if (state.phase !== 'paused') return;
    last = now;
    state.phase = 'running';
  }
  return { state, tick, start, tap, pause, resume };
}

export function draw(ctx, state) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = '#173454';
  ctx.font = '600 18px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`Score: ${state.score}`, 18, 36);
  ctx.fillText(`Time: ${Math.ceil(state.remaining)}s`, 226, 36);
  if (state.phase === 'running') {
    ctx.beginPath();
    ctx.arc(state.target.x, state.target.y, RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = '#ffc54b';
    ctx.fill();
    ctx.strokeStyle = '#a46100';
    ctx.lineWidth = 3;
    ctx.stroke();
  } else {
    ctx.textAlign = 'center';
    ctx.fillText(state.phase === 'over' ? 'Round complete' : state.phase.toUpperCase(), WIDTH / 2, HEIGHT / 2);
  }
}
```

有三个细节：先检查是否超时再计分；暂停时保存剩余时间，继续时重设时间基准；目标半径之外和非有限坐标都不算命中。状态保存在内存，刷新会重置。注入 `random` 是为了可以用固定值测试边界，默认仍使用 `Math.random`。

## 05 / 接入浏览器输入、缩放与主循环

保存 `web.mjs`。浏览器页面坐标先减去画布位置，再转换到逻辑坐标；不要把 CSS 尺寸、画布像素和逻辑尺寸混用。[获取画布显示区域](https://developer.mozilla.org/en-US/docs/Web/API/Element/getBoundingClientRect)。

```js
import { createGame, draw, WIDTH, HEIGHT } from './core.mjs';

const canvas = document.querySelector('#game');
const ctx = canvas.getContext('2d');
const status = document.querySelector('#status');
const startButton = document.querySelector('#start');
const pauseButton = document.querySelector('#pause');
const game = createGame();
let lastLabel = '';

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(WIDTH * dpr);
  canvas.height = Math.round(HEIGHT * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw(ctx, game.state);
}

startButton.addEventListener('click', () => game.start(performance.now()));
pauseButton.addEventListener('click', () => {
  if (game.state.phase === 'paused') game.resume(performance.now());
  else game.pause(performance.now());
});
canvas.addEventListener('pointerdown', event => {
  if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) * WIDTH / rect.width;
  const y = (event.clientY - rect.top) * HEIGHT / rect.height;
  game.tap(x, y, performance.now());
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) game.pause(performance.now());
});
window.addEventListener('resize', resize);

function frame(now) {
  game.tick(now);
  draw(ctx, game.state);
  const label = `${game.state.phase} | score ${game.state.score} | ${Math.ceil(game.state.remaining)}s`;
  if (label !== lastLabel) {
    status.textContent = label;
    lastLabel = label;
  }
  pauseButton.disabled = !['running', 'paused'].includes(game.state.phase);
  pauseButton.textContent = game.state.phase === 'paused' ? 'Resume' : 'Pause';
  requestAnimationFrame(frame);
}
resize();
requestAnimationFrame(frame);
```

`requestAnimationFrame()` 是单次请求，示例只建立一条持续调用链。开始按钮只重置玩法，不重复启动循环，避免每点一次开始就增加一套计时和绘制。倒计时使用真实时间差，不能靠“每帧减固定数值”，否则 60Hz 与 120Hz 屏幕会有不同速度。[requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)。

## 06 / 本地运行与屏幕适配

安装有 Python 3 的电脑可在示例目录启动本地静态服务。下面命令会监听本机端口，仅供本机预览，不能当成生产发布方式：

```sh
# 进入刚才保存四个文件的目录；仅绑定本机回环地址。
cd tap-dot
python3 -m http.server 8080 --bind 127.0.0.1
```

用浏览器打开 `http://127.0.0.1:8080/`。模块通过 HTTP 加载，不直接双击 HTML 使用 `file://`。[JavaScript 模块的加载要求](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules)。手机中的 `127.0.0.1` 指向手机自身；真机测试可以使用自己的 HTTPS 测试站点，或在受控局域网中配置只对测试设备开放的预览入口。

示例通过 `devicePixelRatio` 提高画布清晰度，并把倍率限制到 2，减少高像素密度设备上的内存和填充开销。逻辑坐标始终为 360 × 480，CSS 按容器缩放，点击也必须按相同关系转换。[devicePixelRatio 与 Canvas](https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio)。

- 尺寸：检查窄屏、横屏和高像素密度，确认目标没有跑出边界，按钮仍可点击。
- 缩放：改变窗口大小后再次命中同一个目标，排除坐标偏移。
- 排版：刘海、底部安全区和系统字体变化不能挡住关键操作。
- 性能：示例暂停后仍保留轻量循环，正式项目可在状态不变时停止重绘；优先控制像素数量、重复对象创建和大图片解码。[Canvas 性能建议](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas)。

## 07 / 切后台、暂停和音频生命周期

浏览器可能暂停后台页面的动画回调，因此不能把后台时长隐式当成正常帧推进。示例监听 `visibilitychange`，隐藏时暂停，回来后由玩家点 Resume；等待多久都不会直接消耗暂停期间的游戏时间。[页面可见性 API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)。

如果产品要求“现实时间 30 秒到点就结束”，应改用明确的截止时间并在恢复时重新计算，这是另一种规则。不要把本文的“有效游玩时间”与“墙上时钟时间”混在一起。

示例没有音频。添加声音时，在用户主动操作后初始化或恢复播放，提供静音设置，并处理后台暂停、播放失败与资源释放。不要把自动播放成功作为手机浏览器的前提。[浏览器自动播放策略](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)。

## 08 / 存档、排行榜与安全边界

可以把个人最高分作为后续功能，用 `localStorage` 保存，并在读取时验证类型与范围、在异常时退回内存状态。存储可能因隐私设置、容量或环境限制不可用，不能让写入失败使游戏崩溃。[localStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage)。

本机存储和前端分数都能被用户修改，只适合单机展示。涉及排行榜、奖品或权益时，服务端应校验身份、局次、有效时间、事件顺序与重复提交；必要时使用可复核的规则或回放，不能仅凭客户端上传的最终分数发奖。客户端加密或隐藏接口地址不能代替服务端校验。

密钥、数据库凭据和平台 `AppSecret` 只放服务端。使用公开演示数据，不在 URL 放访问令牌或个人信息；记录错误时也应控制字段与保留范围。第一版无后端，不需要为运行这个原型额外配置数据库。

## 09 / 路径 A：在普通小程序中使用 web-view

这条路径保留 H5 工程，在合适的小程序页面中打开已部署的 HTTPS 地址。它要求账号具有相应能力、域名由你控制并满足后台校验要求；H5 能打开不等于游戏业务一定可通过平台审核。先核对当前业务类型允许的承载方式。

以下是 WXML 的组件片段，`games.example.com` 只是示例，不能当成已配置域名：

```xml
<web-view src="https://games.example.com/tap-dot/"></web-view>
```

- 步骤 1：先独立验收 H5 的 HTTPS、资源地址和手机操作，再配置业务域名及所需校验文件。
- 步骤 2：在开发者工具中建立正常的小程序页面和路由，再放入该组件；在真机上测试加载失败、返回、重开与网络中断。
- 步骤 3：若需桥接登录或结果，按官方 JSSDK 与小程序接口实现，并限制可信来源。组件消息不是实时游戏同步通道。
- 步骤 4：把身份与局次校验留在服务端，网页传来的分数不能直接当作可信成绩。

官方 `bind:message` 的接收发生在后退、组件销毁等特定时机，不保证每次网页发送就立即触发。个人类型支持情况、域名配置和桥接能力应持续核对 [web-view 官方说明](https://developers.weixin.qq.com/miniprogram/dev/component/web-view.html)。

网页宿主还需核对 CSP、嵌入与跳转策略，不能靠关闭全部安全保护来解决加载问题。本站只发布文章，没有为这个教程放宽现有站点安全标头，也没有替实际账号配置业务域名。

## 10 / 路径 B：迁移为微信小游戏

目标是独立微信小游戏时，应在微信开发者工具建立小游戏项目，使用对应的应用身份、项目配置和发布流程；不要把上一节的 web-view 页面作为小游戏工程提交。平台运行环境与开发者工具也可能存在差异，最终要真机验收。[小游戏运行环境](https://developers.weixin.qq.com/minigame/dev/guide/runtime/env.html)。

本例的 `core.mjs` 有机会复用，但应通过目标工具链转换为支持的模块形式；浏览器的 `.mjs` 入口、HTML 和 CSS 不能原样当作小游戏入口。适配工作可按下面的职责拆开：

```text
浏览器适配                         微信小游戏适配
HTML 的 canvas                    平台上屏 Canvas
DOM 按钮                          Canvas 内按钮或平台支持的 UI
Pointer Events + rect             触摸回调 + 视口到逻辑坐标换算
document.visibilitychange         平台隐藏 / 显示生命周期
localStorage（若添加）             平台缓存 API
HTML 模块入口                     小游戏入口与支持的模块产物

保留：状态机、命中、计分、暂停规则与基础绘制
重做：平台输入、按钮、尺寸、生命周期、资源与网络
```

原生创建画布可使用 `wx.createCanvas()`，首次调用创建上屏画布；已经由引擎或 Adapter 创建时要复用，不再创建第二个当作主画布。[wx.createCanvas](https://developers.weixin.qq.com/minigame/dev/api/render/canvas/wx.createCanvas.html)。官方 Adapter 文档说明其浏览器模拟并不完整，也不属于基础库自动提供的部分，不要假定引入它就拥有完整 DOM。

- 步骤 1：用开发者工具的小游戏模板确认入口可运行，记录基础库、客户端和构建工具版本。
- 步骤 2：只接入玩法核心与 2D 绘制，先在画布里做开始、暂停和结果界面。
- 步骤 3：按触摸坐标、画布视口和安全区计算逻辑坐标，替换浏览器事件与 DOM 操作。
- 步骤 4：处理隐藏、显示、资源加载和音频生命周期；不会自动恢复的状态要让玩家明确操作。
- 步骤 5：加入网络或平台能力时再核对合法域名、权限、当前包体限制与资源缓存，不把第三方引擎导出当成审核通过。
- 步骤 6：完成体验版和多机型验收后，再按后台要求提交审核和发布。

复杂项目可以选择带目标平台导出支持的游戏引擎，保留编辑器和资源工作流；学习单一点击玩法时，先使用小原型理解坐标、状态和生命周期。本文未在微信开发者工具或真实小游戏账号运行迁移产物。

## 11 / H5 的部署、缓存与回退

将四个文件按相同相对位置部署到自己的 HTTPS 静态站点；确认 `.mjs` 的 JavaScript MIME、资源路径和错误响应正确。内容安全策略只允许实际需要的脚本、资源与接口来源，不把 `*` 或禁用证书校验作为默认调试方法。

可以为每次发布使用独立版本目录，例如 `/tap-dot/v1/` 与 `/tap-dot/v2/`，入口和它依赖的模块一起切换，避免浏览器把新旧版本混在一起。入口短缓存，带版本的资源按实际策略缓存；回退时切回已验证版本，再确认真实客户端取得正确文件。

使用 Cloudflare Pages 时，可通过 `_headers` 管理响应标头；这属于宿主站点配置，不能直接把一份站点的全局策略覆盖到另一份项目。[Pages 标头配置](https://developers.cloudflare.com/pages/configuration/headers/)。不要默认加入 Service Worker 离线缓存；需要时单独设计资源更新、旧版本清理和回退，避免用户一直停留在过期玩法。

## 12 / 从可运行到可发布的验收清单

- 玩法：未开始、暂停和结束后都不计分；命中只加一分，点空白不加分；重新开始清空上局状态。
- 计时：30Hz、60Hz 和高刷新率下规则一致；暂停后等待不扣时间，恢复后继续；最后时刻点击不会越过结束条件。
- 输入：屏幕缩放、横竖屏和不同 DPR 下坐标正确；多指、鼠标右键和快速点击不会触发重复逻辑。
- 生命周期：切后台、回前台、重新进入页面和断网都有明确行为，不重复绑定事件或启动第二条循环。
- 资源：真机无乱码、裁切和资源 404；性能和内存按目标低端设备验证，桌面流畅不能代替手机验收。
- 平台：H5、web-view 与微信小游戏分别验证；开发者工具调通不能代替实际客户端、账号能力与发布审核。
- 安全：前端无密钥，服务端不信任客户端分数；所用字体、图片与音乐有来源，网络权限按实际需求配置。

本例刻意把宿主适配和玩法分开，便于逐层定位问题：先证明状态和计分正确，再检查输入坐标、绘制与平台生命周期。代码跑通后保留版本、测试结果和已知限制，后续再增加关卡、存档与联网能力。

## 参考资料

- [MDN：Web 游戏开发](https://developer.mozilla.org/en-US/docs/Games/Introduction)
- [MDN：Pointer Events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events/Using_Pointer_Events)
- [MDN：getBoundingClientRect](https://developer.mozilla.org/en-US/docs/Web/API/Element/getBoundingClientRect)
- [MDN：requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)
- [MDN：JavaScript 模块](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules)
- [MDN：devicePixelRatio](https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio)
- [MDN：Canvas 性能](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas)
- [MDN：页面可见性](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)
- [MDN：自动播放](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)
- [MDN：localStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage)
- [微信：web-view](https://developers.weixin.qq.com/miniprogram/dev/component/web-view.html)
- [微信：小游戏 Adapter](https://developers.weixin.qq.com/minigame/dev/guide/runtime/adapter.html)
- [微信：小游戏运行环境](https://developers.weixin.qq.com/minigame/dev/guide/runtime/env.html)
- [微信：创建 Canvas](https://developers.weixin.qq.com/minigame/dev/api/render/canvas/wx.createCanvas.html)
- [Cloudflare Pages：响应标头](https://developers.cloudflare.com/pages/configuration/headers/)
