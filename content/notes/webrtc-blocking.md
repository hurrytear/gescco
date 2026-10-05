---
{"title":"WebRTC 原理与屏蔽：个人浏览器和公司办公网的分层方案","category":"网络与代理","kind":"实践笔记","date":"2026-10-05","summary":"理解 WebRTC、ICE、STUN 与 TURN，区分功能禁用和 IP 暴露限制，给出个人 Firefox、Chrome/Edge 与办公网的浏览器策略、出口控制、会议例外和验收方法。","tags":["WebRTC","浏览器隐私","STUN","TURN","办公网"]}
---
WebRTC 支持网页实时音视频与数据传输，常用于会议、客服、协作和点对点文件交换。屏蔽它之前，先确定目标：不允许浏览器建立 WebRTC 连接，还是保留会议但限制网络地址暴露与直连。本文面向个人电脑和受管理的公司办公网，使用公开原理和示例策略；资料核对于 2026-10-05，没有修改实际浏览器、终端或网络配置。

## 01 / 一次 WebRTC 连接如何建立

网页通过 `RTCPeerConnection` 协商连接，可添加音视频轨道，也可用 `RTCDataChannel` 传输数据。业务自己的信令服务通常通过 HTTPS / WebSocket 交换 SDP 和 ICE 候选；信令服务器地址与实际媒体目的地址可能不同。多人会议还可能连接 SFU，由它转发媒体，而非每个参与者两两直连。[WebRTC 协议介绍](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Protocols)。

ICE 收集并测试候选路径。`host` 候选来自本地接口，`srflx` 候选通常经 STUN 得到 NAT 映射地址，`relay` 候选来自 TURN 中继；运行中还可能发现 `prflx` 候选。存在候选不代表已选中该路径，应查看最终使用的 candidate pair。[WebRTC 连接过程](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Connectivity)。

```text
Browser A ---- HTTPS / WebSocket signaling ---- application service
    |
    +---- STUN: discover mapped address
    |
    +---- direct media / data ---- Browser B or SFU
    |
    +---- TURN relay ------------ Browser B or SFU

Typical TURN listeners:
  UDP / TCP 3478
  TLS / DTLS 5349
  Custom listeners, including TLS over TCP 443

Three different controls:
  Disable RTCPeerConnection
  Restrict address exposure / direct UDP
  Restrict network destinations and applications
```

TURN 可以通过 UDP、TCP、TLS-over-TCP 或 DTLS-over-UDP 连接，端口也能自定义。音视频常见 DTLS-SRTP，数据通道使用 SCTP over DTLS；有加密不等于一定符合办公网的应用准入要求。[TURN 传输与默认端口](https://www.rfc-editor.org/rfc/rfc8656.html)。

## 02 / 区分屏蔽目标与常见误区

- 功能禁用：当前受控浏览器不能建立 WebRTC PeerConnection，会议和数据通道都会受影响。
- 隐私限制：减少本地地址暴露或禁止非代理 UDP；WebRTC 仍可能经 TCP / 代理 / TURN 工作。
- 办公网准入：允许指定会议应用与目的地址，拒绝其他实时通信，需同时管理终端和出口。

拒绝摄像头、麦克风权限能限制设备采集，但不能保证禁止数据通道、接收媒体或 ICE 连接。W3C 明确说明数据通道可在没有单独用户提示的情况下使用；不能把权限弹窗当成整个协议的开关。[WebRTC 隐私与安全边界](https://www.w3.org/TR/webrtc/#privacy-and-security-considerations)。

现代浏览器可能用 mDNS 名称隐藏部分本地 `host` 地址，但这不等于关闭 WebRTC，也不保证所有公网地址不可见。浏览器版本、权限、VPN 分流、IPv6、策略和候选类型都会影响结果。网站本来就能看到其 HTTP 请求出口地址；重点是 WebRTC 是否又暴露了预期之外的接口或出口。[WebRTC IP 地址处理要求](https://www.rfc-editor.org/rfc/rfc8828.html)。

封禁 UDP 3478 / 5349 只是局部限制。直连可以使用动态 UDP 端口，TURN 可以改端口或经 TCP/TLS 443。封禁 UDP 443 也会影响 QUIC / HTTP/3，不能把所有 UDP 443 流量认定为 WebRTC。

## 03 / 变更前记录当前连接路径

在自己的电脑或已批准的测试终端上，先记录浏览器版本、网络、代理 / VPN 模式、IPv4 / IPv6、所用应用与现有策略。在开始测试通话前打开浏览器诊断页：Chrome 使用 `chrome://webrtc-internals`，Edge 使用 `edge://webrtc-internals`，Firefox 使用 `about:webrtc`；可用项目以当前版本为准。

查看 ICE / connection 状态、选中候选对、候选类型、实际传输协议和目的地址，并核对防火墙 / 代理日志。页面加载成功、出现 `host` 候选、拿到 `relay` 候选和真正建立媒体连接是不同阶段，分别记录。

使用自己控制的测试网页与 STUN / TURN 服务。第三方“泄漏检测”页面本身会接收访问出口信息，也可能收集候选地址；不要把公司 SDP、ICE 凭证、会话日志或完整诊断文件上传到公共检测站点。对外分享结果时只保留脱敏后的路径与结论。

## 04 / 个人电脑：Firefox 禁用 PeerConnection

不需要网页会议或数据通道的个人桌面 Firefox，可以使用现有的 `media.peerconnection.enabled` 布尔首选项关闭 PeerConnection。[Firefox 首选项源码](https://raw.githubusercontent.com/mozilla-firefox/firefox/main/modules/libpref/init/StaticPrefList.yaml)。

1. 记录当前值，结束正在进行的通话。
2. 打开 `about:config`，搜索完整名称 `media.peerconnection.enabled`。
3. 将已存在的布尔值设为 `false`；若当前版本没有此项，不盲目新建同名设置。
4. 退出全部 Firefox 进程后重新打开，在新页面验证 API、会议和数据通道行为。
5. 恢复时还原记录的值；公司设备若被策略锁定，交由管理员调整。

以下 JavaScript 仅检查受控测试页中的 API 暴露，不申请设备权限、不创建连接：

```js
console.table({
  secureContext: window.isSecureContext,
  peerConnectionExposed: typeof window.RTCPeerConnection === "function",
  mediaCaptureExposed: typeof navigator.mediaDevices?.getUserMedia === "function"
});
```

禁用后 PeerConnection API 应不可用或受限制，但仍要实际测试原本能够工作的应用。只看到函数存在、函数消失或摄像头报错，都不足以证明其他浏览器、原生客户端或全部网络路径已被阻断。`getUserMedia` 是独立的设备采集能力，必要时还应撤销站点摄像头、麦克风权限。

该方法以桌面 Firefox 为范围。手机系统、浏览器渠道和管理能力不同，不把桌面 `about:config` 的步骤当成 Android / iOS 的通用方案。

## 05 / 个人电脑：Chrome / Edge 限制暴露与非代理 UDP

Chrome 的 `webRTCIPHandlingPolicy` 隐私接口和企业 IP handling 策略提供多种路径限制；`disable_non_proxied_udp` 用于禁止非代理 UDP，不能被描述为彻底禁用 WebRTC。[Chrome privacy API](https://developer.chrome.com/docs/extensions/reference/api/privacy)。

普通用户可使用经过审查、明确支持该设置的浏览器扩展，将模式设为 `disable_non_proxied_udp`，重启后验收。核对扩展来源、权限、当前版本兼容性和设置是否真的生效；只改网页里的 JavaScript 对象或安装一个名字含“WebRTC Block”的扩展，不能证明全局禁用。此 API 需要扩展的 `privacy` 权限，普通网页控制台不能直接调用；企业强制策略也可能使扩展无法控制设置。

个人电脑采用浏览器级 HTTP / SOCKS 代理时，另外核对 UDP 支持与直接出口；使用 VPN 时核对所有目标流量是否进隧道、IPv6 是否同样覆盖、断线后是否阻止直连。代理扩展不等于系统全流量隧道，VPN 分流也不能自动保证每个 ICE 路径走同一出口。

如果目标是完全不使用 WebRTC，可选用第 04 节能验证功能禁用的桌面 Firefox，并限制其他浏览器 / 客户端的使用。Chrome / Edge 的摄像头权限、隐藏本地 IP 和禁用非代理 UDP，都不应作为功能禁用的替代结论。

## 06 / 办公网：集中下发浏览器策略

先区分“浏览器禁止使用”与“允许批准的会议”。Windows 用 GPO / 终端管理平台，macOS 用 MDM，Linux 用浏览器支持的受管理策略目录；从小范围设备组开始。策略片段合并到现有配置，不覆盖整份组织策略；核对个人账号、访客、无痕和不同配置文件是否在管理范围内。

Chrome 91+ 支持 `WebRtcIPHandling`。下面是 Linux Chrome 的策略 JSON 示例，可由管理员合并到 `/etc/opt/chrome/policies/managed/` 下的策略文件；Chromium 等发行版目录需另行确认。[Chrome 策略定义](https://raw.githubusercontent.com/chromium/chromium/main/components/policy/resources/templates/policy_definitions/WebRtc/WebRtcIPHandling.yaml)。

```json
{
  "WebRtcIPHandling": "disable_non_proxied_udp"
}
```

Windows / macOS Edge 对应策略名称是 `WebRtcLocalhostIpHandling`，下发字符串值 `disable_non_proxied_udp`。Windows 注册表位置为 `SOFTWARE\Policies\Microsoft\Edge`，值类型 REG_SZ；平台选择和下发方式遵循 Edge 模板，不能把 Chrome 的键名原样复制到 Edge。[Edge 策略说明](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/WebRtcLocalhostIpHandling)。

这两个策略都限制路径与地址暴露，仍可能允许 TCP 或受支持的代理传输。部署后在 `chrome://policy` / `edge://policy` 检查识别结果、来源、级别、值与冲突；重启浏览器后建立新会话验证，不能仅凭策略文件存在判定成功。

需要对受管理 Firefox 禁用 PeerConnection 时，可合并以下 `policies.json`，通过 `Preferences` 锁定值。[Firefox Preferences 策略](https://firefox-admin-docs.mozilla.org/reference/policies/preferences/)。

```json
{
  "policies": {
    "Preferences": {
      "media.peerconnection.enabled": {
        "Value": false,
        "Status": "locked"
      }
    }
  }
}
```

按部署方式通过 GPO / MDM 或发行版的策略目录配置，并在 `about:policies` 查看 Active 与 Errors，再检查首选项已锁定。同步管理未批准浏览器、便携版、扩展、原生会议程序和 Electron 应用；浏览器策略不会自动约束这些独立程序。

## 07 / 办公网：出口与应用控制

办公网希望普遍限制未批准的 WebRTC 时，应采用受管理终端、出口访问控制和应用识别组合。下面是设计顺序，实际规则按现有设备、业务和变更流程编排：

1. 盘点会议、客服、远程支持、直播和内部 P2P 分发的必要流量，划分办公区、会议设备区和访客区。
2. 对受控办公终端拒绝未经批准的直接 Internet 出口，网页访问通过受管理代理 / 安全网关；代理的 CONNECT 目标也应受控，不能任意建立隧道。
3. 对外 UDP 默认拒绝，必要 DNS、时间同步及批准的会议媒体按“来源设备组 + 指定目的 + 协议/端口”精确放行。不能只留一个全网 DNS / NTP 端口例外，或漏掉 IPv6。
4. 拒绝未批准 STUN / TURN、DTLS / SRTP 等应用，结合厂商更新的识别特征、域名和目的地址维护规则。服务共用 CDN 地址时，避免粗暴封禁整个 CDN。
5. 对 TCP/TLS 443 的中继使用应用准入、受控目的地址和终端限制；任意 HTTPS 都允许时，单靠端口 ACL 无法证明所有 WebRTC 中继被阻断。
6. 同一二层网络内的 P2P 可能不经过出口网关，需要终端防火墙、无线客户端隔离或网络分段。检查其他出口、IPv6 和受管设备的网络切换行为。

TLS 加密会限制网络侧识别；如组织已有经过评审的 TLS 检查能力，应验证浏览器和会议兼容性。不能为识别流量而默认关闭证书校验。DNS 黑名单和 SNI 匹配也不是完整判据，直接 IP、共享基础设施及加密名称会影响覆盖范围。

要求严格禁用的设备组，应限制为能验证 API 禁用的受管理浏览器，并通过应用准入与网络限制覆盖其他运行环境。只管理网关、允许任意终端和任意 TLS 目的地的网络，不能承诺“100% 屏蔽 WebRTC”。

## 08 / 一个有限覆盖的 nftables 示例

下面只演示 Linux 路由网关对常见监听端口的拦截。假设 `office0` 是办公区入口、`wan0` 是 Internet 出口，使用 `inet` family 同时匹配经过这两个接口的 IPv4 / IPv6。它不覆盖自定义端口、动态直连 UDP、TCP/TLS 443 或同网段 P2P，不能替代第 07 节的整体设计。[nftables 链与过滤位置](https://wiki.nftables.org/wiki-nftables/index.php/Configuring_chains)。

```nft
table inet webrtc_sample {
  chain forward {
    type filter hook forward priority -10; policy accept;
    iifname "office0" oifname "wan0" udp dport { 3478, 5349, 443 } counter drop
    iifname "office0" oifname "wan0" tcp dport { 3478, 5349 } counter drop
  }
}
```

将片段保存为实验环境的 `webrtc-sample.nft`，先检查接口、现有规则、连接跟踪、flowtable / 硬件加速和例外规则。下列命令只做语法 / 规则检查和查看现有配置，不加载新策略；`nft --check` 通常也需要相应权限：

```sh
sudo nft --check --file webrtc-sample.nft
sudo nft list ruleset
```

个人 Linux 主机过滤本机发出的包通常使用 `output` hook，路由网关过滤转发包使用 `forward`，不能照搬后以计数器为 0 宣称没有流量。部署时按现有管理工具合并规则，保留管理入口；这里没有 `flush ruleset` 或直接应用命令。已有会话和加速路径可能影响观察，应使用新建测试会话，并核对实际流量是否经过该规则。

## 09 / 保留公司批准的会议与自建中继

会议例外应绑定批准的应用、设备组、信令域名与媒体 / TURN 目的地址，并使用厂商维护的当前网络要求。允许信令域名不等于允许全部媒体；允许全部 UDP 或任意 TCP 443 也不是精确例外。记录负责人、用途和到期复核时间。

Chrome 133+ 可以用 `WebRtcIPHandlingUrl` 对指定 origin 调整 IP handling，未匹配时沿用全局策略。下面只让示例会议 origin 使用 `default_public_interface_only`；它仍不是“只允许该网站建立 WebRTC”的 API 白名单，其他网站可能通过受限路径工作。[Chrome 按 URL 的策略定义](https://raw.githubusercontent.com/chromium/chromium/main/components/policy/resources/templates/policy_definitions/WebRtc/WebRtcIPHandlingUrl.yaml)。

```json
{
  "WebRtcIPHandling": "disable_non_proxied_udp",
  "WebRtcIPHandlingUrl": [
    {
      "url": "https://meet.example.com",
      "handling": "default_public_interface_only"
    }
  ]
}
```

匹配按 origin，路径被忽略，不能把 `/approved-room` 当成隔离边界；嵌入页面的实际 origin 也要核对。Chrome 策略来源与优先级、浏览器版本和网络例外一起验收。第 06 节 Firefox 的全局禁用不会自动给某个会议域名留例外，需要单独管理允许会议的运行环境。

公司自有 WebRTC 应用可以在应用配置中强制 `iceTransportPolicy: "relay"`，使用受控 TURN，减少参与者之间的直连地址暴露。下面是配置对象示例，域名和凭证均为占位符：

```js
const rtcConfiguration = {
  iceTransportPolicy: "relay",
  iceServers: [{
    urls: "turns:turn.example.com:443?transport=tcp",
    username: "REPLACE_WITH_SHORT_LIVED_USERNAME",
    credential: "REPLACE_WITH_SHORT_LIVED_CREDENTIAL"
  }]
};
```

用短期鉴权、有效 TLS 证书、带宽 / 配额和访问限制管理 TURN，避免开放中继；容量与故障切换单独验证。这个参数由应用控制，网管不能凭浏览器 IP handling 策略让所有外部网站强制采用它。TURN 仍能看到客户端连接来源，中继也不意味着浏览器匿名。[候选地址与 relay 策略](https://developer.mozilla.org/en-US/docs/Web/API/RTCIceCandidate/address)。

## 10 / 如何验收与回退

先建立变更前能成功的对照，再逐项验证目标。实验环境应包含直接 UDP、非默认端口 STUN / TURN、TURN-over-TCP、TURN-over-TLS 443、IPv6，以及没有摄像头 / 麦克风的 DataChannel 测试。自建测试服务必须具备有效配置；服务自身故障不能算屏蔽成功。

- 功能禁用：受管浏览器不能建立测试 PeerConnection / DataChannel；普通网页仍可访问，策略不能被目标用户修改。
- 隐私限制：新会话的候选与选中路径符合预期，未观察到禁止暴露的出口；分别测试代理 / VPN 开启、关闭和断线状态。
- 办公网准入：未批准应用在直连和各中继场景均失败，网关 / 代理或终端日志能说明阻断原因；批准会议的音频、视频、共享和重连正常。
- 管理覆盖：重启、不同配置文件、无痕 / 访客、浏览器升级及获准使用的原生客户端分别验收；不在范围内的设备明确记录。

确认会议没有偷偷降级到另一种实时传输后再下结论；能通话不必然使用 WebRTC，不能通话也不必然由 WebRTC 策略导致。出现无声、无法共享、TCP 中继延迟或 QUIC 降级时，结合选中候选对与策略日志定位。

回退时恢复记录的首选项、原企业策略和对应网络规则，重启浏览器并重新建立测试会话；不清空整个防火墙。把阻断范围、业务例外、实际验证路径和未覆盖环境写入变更记录。屏蔽 WebRTC 不能代替数据防泄漏：HTTPS 上传、WebSocket 与其他通信渠道仍需独立管理。

## 参考资料

- [MDN：WebRTC 协议介绍](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Protocols)
- [MDN：WebRTC 连接过程](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Connectivity)
- [W3C：WebRTC 隐私与安全](https://www.w3.org/TR/webrtc/#privacy-and-security-considerations)
- [IETF RFC 8828：WebRTC IP 地址处理](https://www.rfc-editor.org/rfc/rfc8828.html)
- [IETF RFC 8656：TURN](https://www.rfc-editor.org/rfc/rfc8656.html)
- [Mozilla：Firefox 首选项源码](https://raw.githubusercontent.com/mozilla-firefox/firefox/main/modules/libpref/init/StaticPrefList.yaml)
- [Mozilla：Preferences 企业策略](https://firefox-admin-docs.mozilla.org/reference/policies/preferences/)
- [Google：Chrome privacy API](https://developer.chrome.com/docs/extensions/reference/api/privacy)
- [Chromium：WebRtcIPHandling 策略](https://raw.githubusercontent.com/chromium/chromium/main/components/policy/resources/templates/policy_definitions/WebRtc/WebRtcIPHandling.yaml)
- [Chromium：WebRtcIPHandlingUrl 策略](https://raw.githubusercontent.com/chromium/chromium/main/components/policy/resources/templates/policy_definitions/WebRtc/WebRtcIPHandlingUrl.yaml)
- [Microsoft：Edge WebRtcLocalhostIpHandling](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/WebRtcLocalhostIpHandling)
- [MDN：候选地址与 relay 策略](https://developer.mozilla.org/en-US/docs/Web/API/RTCIceCandidate/address)
- [Netfilter：nftables 链与过滤位置](https://wiki.nftables.org/wiki-nftables/index.php/Configuring_chains)
