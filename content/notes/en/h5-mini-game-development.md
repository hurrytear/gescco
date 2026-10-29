---
{"title":"Build H5 games: a Canvas prototype and WeChat integration paths","category":"Web & mini games","kind":"Practical notes","date":"2026-10-29","summary":"Build a complete 30-second tapping game and distinguish H5, Mini Program web-view and WeChat Mini Games, with Canvas, touch scaling, pause timing, platform adaptation, hosting and security checks.","tags":["H5","Canvas","JavaScript","WeChat Mini Games","Mini Programs"]}
---
“H5 mini-program games” can refer to browser games, web pages embedded in WeChat Mini Programs, or independent WeChat Mini Games. They may share gameplay code, but have different runtimes, capabilities and release paths. This guide builds a complete Canvas tapping game, then explains the integration choices for a first interactive prototype or technical demonstration.

Sources were checked on 2026-10-29. Four files form a standalone browser prototype without frameworks, accounts, image services or a backend. The WeChat sections describe integration and migration; no real WeChat project was created or submitted.

## 01 / Choose H5, a Mini Program or a Mini Game

- H5 browser game: HTML, CSS, JavaScript and Canvas run in a browser or compatible embedded browser, distributed through an HTTPS URL. [Web game development](https://developer.mozilla.org/en-US/docs/Games/Introduction).
- Ordinary WeChat Mini Program: uses platform pages, components and APIs, including Canvas where appropriate. Arbitrary HTML is not WXML.
- Mini Program web-view: loads a deployed web page inside an eligible Mini Program, leaving both web and Mini Program components to maintain. Current documentation excludes individual-account Mini Programs and requires business-domain configuration for other web pages. [web-view component](https://developers.weixin.qq.com/miniprogram/dev/component/web-view.html).
- WeChat Mini Game: has a separate runtime, developer-tool project and platform APIs. Do not assume a full browser `window`, `document` or DOM. Engine exports and Adapters address some differences, not universal one-click webpage conversion. [Mini Game Adapter](https://developers.weixin.qq.com/minigame/dev/guide/runtime/adapter.html).

A web page opening inside WeChat does not establish publication as a WeChat Mini Game. Check account type, capabilities and the intended entry point first. Follow current official and console requirements for admission, categories and review.

## 02 / Start with one complete gameplay loop

“Tap the Dot” awards one point for hitting a yellow circle, then relocates it. Empty taps earn nothing; scoring stops after 30 seconds. Players can pause, resume and restart. Hiding the page pauses the round, with an explicit resume when returning.

Use a 360 × 480 logical coordinate system independent of device pixels. This first version is a local practice game without rewards, accounts, payments, advertising, leaderboards or multiplayer. Each adds its own state, interfaces, platform requirements and acceptance criteria.

```text
tap-dot/
  index.html   Page and buttons
  style.css    Layout, touch area and safe area
  core.mjs     State, timing, hit tests and Canvas drawing
  web.mjs      Browser input, scaling and lifecycle adapter

ready → running → over
          ↕
        paused
```

The core receives coordinates and timestamps; the browser adapter translates real input. For a Mini Game port, retain gameplay and replace host-specific integration first.

## 03 / Create the page and mobile layout

Save these four files in a separate `tap-dot` directory. Short English labels keep the executable example identical across both articles; extract a language dictionary for a localized product. Code is displayed in this article, not executed inside the notebook page.

Save `index.html` first. Canvas provides the playfield and native buttons provide start / pause controls. Keep page zoom available:

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

Save `style.css`. `touch-action: none` applies only to the playfield so target taps do not drag the page, while normal page interactions remain available. Buttons retain visible focus and a minimum height of 44px. [Pointer Events and touch behavior](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events/Using_Pointer_Events).

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

This is a pointer-operated prototype. Add equivalent keyboard gameplay, screen-reader instructions, sound controls and reduced-motion options for a finished product, then validate them with its intended users.

## 04 / Implement reusable gameplay

Save `core.mjs`. `createGame()` uses no DOM or network access; it accepts timestamps and maintains state. `draw()` uses only its supplied 2D context, making host replacement easier.

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

Check expiry before awarding points. Preserve remaining time on pause and reset the timing baseline on resume. Taps outside the radius or with non-finite coordinates do not score. State is in memory and resets on reload. Injecting `random` enables repeatable boundary tests; its default remains `Math.random`.

## 05 / Connect browser input, scaling and the loop

Save `web.mjs`. Subtract the displayed canvas origin from pointer coordinates, then map into logical coordinates. CSS dimensions, backing pixels and logical dimensions serve different purposes. [Reading the display rectangle](https://developer.mozilla.org/en-US/docs/Web/API/Element/getBoundingClientRect).

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

`requestAnimationFrame()` schedules one callback. This example maintains one callback chain; starting resets state without starting another loop. Otherwise repeated starts can create duplicate timing and drawing. Use elapsed time rather than a fixed per-frame decrement so 60Hz and 120Hz displays run the same rules. [requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame).

## 06 / Run locally and adapt to screens

With Python 3 installed, start a static server from the example directory. It listens only on the local machine for preview and is not a production hosting method:

```sh
# Enter the directory containing the four files; bind only to loopback.
cd tap-dot
python3 -m http.server 8080 --bind 127.0.0.1
```

Open `http://127.0.0.1:8080/`. Load modules over HTTP instead of opening HTML through `file://`. [JavaScript module loading](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules). A phone's `127.0.0.1` refers to the phone itself. For real-device testing, use your HTTPS test site or a controlled LAN preview restricted to test devices.

The example uses `devicePixelRatio` for clarity, capped at 2 to reduce high-density backing-store and fill costs. Logical coordinates stay at 360 × 480 while CSS scales the canvas; input must use the same mapping. [devicePixelRatio and Canvas](https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio).

- Dimensions: check narrow screens, landscape and high density. Targets must stay inside the playfield and controls remain usable.
- Scaling: hit the same target after resizing to detect coordinate offsets.
- Layout: notches, bottom safe areas and font changes must not obscure controls.
- Performance: this demo keeps a lightweight loop while paused. A production version can skip unchanged redraws. Control pixel counts, allocation churn and large-image decoding first. [Canvas performance](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas).

## 07 / Backgrounding, pause and audio lifecycle

Browsers may suspend animation callbacks in hidden pages. The example listens for `visibilitychange`, pauses when hidden and requires Resume when the player returns. Time spent paused is not deducted from gameplay. [Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API).

If a product must end 30 seconds after a real-world start regardless of backgrounding, use an explicit deadline and recalculate on return. That is a different rule from this example's active-play duration.

The demo has no audio. Initialize or resume added sound after a user action, provide mute controls and handle backgrounding, playback failures and resource cleanup. Do not depend on automatic audible playback in mobile browsers. [Autoplay policies](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay).

## 08 / Saves, leaderboards and trust boundaries

A personal best can be added later using `localStorage`. Validate loaded types and ranges, and fall back to memory on errors. Privacy settings, capacity or host restrictions can make storage unavailable; a failed write must not crash gameplay. [localStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage).

Local storage and frontend scores are user-controlled and suitable for offline display. For leaderboards, prizes or entitlements, validate identity, round, elapsed time, event order and duplicate submissions on the server. Use verifiable rules or replays where needed rather than awarding rewards from a submitted final score. Client encryption or hidden endpoint URLs do not replace server validation.

Keep secrets, database credentials and platform `AppSecret` values server-side. Use public demonstration data, avoid personal information or access tokens in URLs, and limit error-reporting fields and retention. This backend-free prototype needs no database.

## 09 / Path A: web-view in an ordinary Mini Program

This path retains the H5 project and loads its deployed HTTPS URL in an eligible Mini Program page. The account needs appropriate capability, and you must control and validate the domain. Reachable H5 content does not establish that a game business can pass review; check the permitted delivery route first.

The following is a WXML fragment. `games.example.com` is an example, not a configured domain:

```xml
<web-view src="https://games.example.com/tap-dot/"></web-view>
```

- Step 1: Validate H5 HTTPS, assets and mobile input independently, then configure the business domain and required verification files.
- Step 2: Create a normal Mini Program page and route in developer tools before adding the component. Test load errors, returning, reopening and disconnections on devices.
- Step 3: Implement needed identity or result bridging through official JSSDK / Mini Program APIs with trusted-source restrictions. Component messages are not a real-time gameplay synchronization channel.
- Step 4: Keep identity and round validation on the server; webpage scores are not trusted results.

Official `bind:message` delivery occurs at specific moments such as navigation back or component destruction, rather than immediately for every webpage send. Recheck individual-account availability, domain configuration and bridging against the [web-view documentation](https://developers.weixin.qq.com/miniprogram/dev/component/web-view.html).

Review the web host's CSP, embedding and navigation policies instead of disabling all protections to fix loading. This notebook publishes the article without relaxing its security headers or configuring an actual account's business domain.

## 10 / Path B: port to a WeChat Mini Game

For an independent Mini Game, create the correct project type in WeChat developer tools with its application identity, configuration and release process. Do not submit the previous section's web-view page as a Mini Game project. Tool and client runtimes can differ, requiring real-device validation. [Mini Game runtime](https://developers.weixin.qq.com/minigame/dev/guide/runtime/env.html).

The example's `core.mjs` may be reusable through a target-supported module build. Its browser `.mjs` entry, HTML and CSS are not unchanged Mini Game entry files. Split the adaptation responsibilities as follows:

```text
Browser adapter                    WeChat Mini Game adapter
HTML canvas                        Platform on-screen Canvas
DOM buttons                        Canvas buttons or supported platform UI
Pointer Events + rect              Touch callbacks + viewport-to-logical mapping
document.visibilitychange          Platform hide / show lifecycle
localStorage, if added              Platform cache APIs
HTML module entry                  Mini Game entry and supported module build

Retain: state machine, hit tests, scoring, pause rules, basic drawing
Replace: input, buttons, dimensions, lifecycle, assets and networking
```

`wx.createCanvas()` creates the on-screen canvas on its first call. Reuse one already created by an engine or Adapter instead of creating another as the main display. [wx.createCanvas](https://developers.weixin.qq.com/minigame/dev/api/render/canvas/wx.createCanvas.html). The official Adapter documentation states that its browser simulation is incomplete and not automatically supplied by the base library. Do not assume a complete DOM.

- Step 1: Run the developer-tool Mini Game template and record library, client and build-tool versions.
- Step 2: Integrate gameplay and 2D drawing first, including start, pause and result controls on the canvas.
- Step 3: Map touch coordinates through the canvas viewport and safe area to logical coordinates; replace browser events and DOM operations.
- Step 4: Handle hide / show, resource loading and audio lifecycle. Require an explicit player action for states that should not resume automatically.
- Step 5: When adding networking or platform features, check allowed domains, permissions, current package limits and asset caching. An engine export does not establish review approval.
- Step 6: Complete trial-build and multi-device acceptance before submitting through the console's review and release workflow.

Larger games may benefit from an engine with supported target exports, an editor and asset pipeline. For learning one tapping mechanic, a small prototype makes coordinates, state and lifecycle easier to understand. No migration build in this article was run in WeChat developer tools or a real Mini Game account.

## 11 / H5 hosting, caching and rollback

Deploy the four files at matching relative paths on your HTTPS static site. Check JavaScript MIME for `.mjs`, asset paths and error responses. Allow only required scripts, assets and API origins in CSP instead of defaulting to `*` or bypassing certificate checks.

Use release directories such as `/tap-dot/v1/` and `/tap-dot/v2/` and switch an entry together with its modules to avoid mixing builds. Keep entry caching short and cache versioned assets according to policy. Roll back to an accepted release and verify actual client files afterward.

Cloudflare Pages supports response configuration through `_headers`. It is host-specific configuration, not a reason to overwrite another project's global policy. [Pages headers](https://developers.cloudflare.com/pages/configuration/headers/). Add Service Worker offline caching only with a separate update, stale-resource cleanup and rollback design, so players do not remain on obsolete gameplay.

## 12 / Acceptance before release

- Gameplay: no scoring before start, while paused or after ending; one point per hit, none for misses; restart clears the previous round.
- Timing: consistent rules at 30Hz, 60Hz and high refresh rates; pauses preserve time; resuming continues it; late taps cannot bypass expiry.
- Input: correct mapping across zoom, orientation and DPR; secondary fingers, right-clicks and rapid taps must not duplicate logic.
- Lifecycle: defined behavior for backgrounding, returning, reopening and disconnection, without duplicate event bindings or callback chains.
- Assets: no missing resources, unreadable fonts or clipping on devices. Check performance and memory on target low-end hardware rather than relying on desktop smoothness.
- Platform: validate H5, web-view and Mini Games separately. Developer-tool success does not replace client testing, account capabilities or review.
- Security: no frontend secrets or trusted client scores; documented font / image / music sources and appropriately scoped network permissions.

Separating the host adapter from gameplay supports layered diagnosis: prove scoring and state first, then inspect input mapping, drawing and platform lifecycle. Keep versions, observed tests and limitations before adding levels, saves and networking.

## References

- [MDN: Web game development](https://developer.mozilla.org/en-US/docs/Games/Introduction)
- [MDN: Pointer Events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events/Using_Pointer_Events)
- [MDN: getBoundingClientRect](https://developer.mozilla.org/en-US/docs/Web/API/Element/getBoundingClientRect)
- [MDN: requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)
- [MDN: JavaScript modules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules)
- [MDN: devicePixelRatio](https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio)
- [MDN: Canvas performance](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas)
- [MDN: Page Visibility](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)
- [MDN: Autoplay](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)
- [MDN: localStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage)
- [WeChat: web-view](https://developers.weixin.qq.com/miniprogram/dev/component/web-view.html)
- [WeChat: Mini Game Adapter](https://developers.weixin.qq.com/minigame/dev/guide/runtime/adapter.html)
- [WeChat: Mini Game runtime](https://developers.weixin.qq.com/minigame/dev/guide/runtime/env.html)
- [WeChat: create Canvas](https://developers.weixin.qq.com/minigame/dev/api/render/canvas/wx.createCanvas.html)
- [Cloudflare Pages: response headers](https://developers.cloudflare.com/pages/configuration/headers/)
