---
{"title":"自建 SSO 单点登录：设计、开发与接入方案","category":"网络与代理","kind":"方案设计","date":"2026-10-12","summary":"以 OpenID Connect 为统一入口，整理自建身份提供方的领域模型、认证流程、服务端开发、应用接入、安全控制与上线验收。","tags":["SSO","OpenID Connect","OAuth 2.0","身份认证"]}
---
自建 SSO 适合需要统一账号、集中登录策略和跨系统会话管理的组织。推荐把它实现为兼容 OpenID Connect 的身份提供方（Identity Provider，IdP），业务系统作为 relying party（RP）接入。本文给出设计和开发路线，不绑定某个语言或框架；示例中的域名、客户端和用户均为占位值。

## 01 / 先确定边界与协议

先把“登录一次”拆成身份认证、应用授权、应用会话和退出登录四件事。SSO 只负责建立可信的身份结果，业务系统仍需根据自己的角色、租户和资源规则做授权。

- Web 应用优先采用 OpenID Connect Authorization Code Flow；浏览器和移动端等无法安全保存密钥的客户端使用 PKCE。
- `openid` scope 表示认证请求；`profile`、`email` 和组织自定义 scope 按最小需要申请。
- 不把 ID Token 当成通用 API 访问令牌，也不把用户资料中的 email 当成永久主键。
- 先决定用户主键、账号合并、禁用、离职、组织变更和审计保留规则，再设计表结构。
- 对外只暴露 HTTPS 端点，并为 issuer、回调地址和密钥轮换建立稳定的生命周期。

授权码流程让浏览器只拿到短期 code，服务端在令牌端点兑换令牌。OIDC 要求回调地址与预注册值精确匹配；`state` 用来关联浏览器请求并防止 CSRF，`nonce` 用来把认证请求与 ID Token 绑定。[OIDC Core](https://openid.net/specs/openid-connect-core-1_0.html) 和 [OAuth 2.0 Security BCP](https://datatracker.ietf.org/doc/html/rfc9700/) 是协议与安全基线。

## 02 / 规划身份中心的领域模型

最小模型通常包括用户、凭证、组织、组、客户端、授权范围、授权码、刷新令牌、会话和审计事件。把登录凭证与业务用户资料分开，便于替换密码、接入 MFA 或增加外部目录。

- 用户使用不可变内部 ID；登录名、邮箱和显示名都是可变属性。
- 客户端保存 `client_id`、认证方法、精确回调地址、允许的 scope、登出地址和所属组织。
- 授权码一次性使用并设置很短的有效期，绑定客户端、回调地址、PKCE verifier 摘要、用户和认证上下文。
- 刷新令牌采用轮换与撤销记录，泄露或重复使用时能使令牌族失效。
- 会话记录保存设备、创建时间、最近活动、认证强度和撤销时间，支持按用户或设备强制退出。
- 审计事件记录登录成功、失败、MFA、授权批准、令牌撤销、客户端变更和管理员操作；正文避免保存密码、完整令牌和不必要的个人数据。

## 03 / 开发身份提供方的核心端点

先实现发现文档和密钥集合，再实现认证和令牌流程。常见公开端点包括 `/.well-known/openid-configuration`、`/authorize`、`/token`、`/jwks.json`、`/userinfo`、`/introspect` 和 `/revoke`；端点是否开放取决于客户端类型和产品边界。

- 发现文档声明 issuer、端点地址、支持的 grant、scope、claim 和签名算法。
- `/authorize` 负责校验客户端、回调地址、scope、`state`、`nonce` 和 PKCE 参数，并创建一次性授权上下文。
- `/token` 只接受未使用且未过期的 code，重新校验客户端、回调地址和 PKCE；不要只验证 code 的格式。
- ID Token 至少校验签名、issuer、audience、过期时间、签发时间、nonce 和必要的认证上下文。
- `/userinfo` 根据 access token 返回最小资料；资源服务器需要验证 access token 的受众、范围和有效期。
- JWKS 支持当前和过渡期旧公钥，并通过 `kid` 轮换；私钥只在受控密钥存储中使用。

开发阶段先做协议状态机和负面测试，再接入页面。所有错误都返回规范错误码并记录关联 ID，避免把内部堆栈、密码或令牌写入响应与日志。

## 04 / 设计登录与同意流程

用户访问业务系统时，RP 生成不可预测的 `state`、`nonce` 和 PKCE verifier，将状态保存在受保护的短期会话中，然后跳转到 IdP。回调收到 code 后，RP 在服务端兑换令牌、校验 ID Token，再根据 `sub` 与 issuer 建立本地会话。

- `redirect_uri` 必须使用预注册的精确值；不要用任意回调地址或开放重定向。
- 绑定 state 的 Cookie 设置 `Secure`、`HttpOnly` 和合适的 `SameSite`，回调成功或失败后立即销毁一次性状态。
- 首次授权展示请求的组织、应用和 scope；已批准的低风险 scope 可以按策略减少重复同意。
- 业务授权与身份认证分开。ID Token 中的组或角色是声明输入，最终权限仍由业务系统按版本化策略计算。
- 多租户场景把组织、客户端和用户关系同时绑定，避免仅凭邮箱域名自动加入高权限组织。

## 05 / 处理会话、令牌和退出

IdP 会话、RP 本地会话、access token 和 refresh token 生命周期不同。不要把它们压缩成一个“登录状态”。短期 access token 适合调用 API，RP 的浏览器会话使用服务端会话或经过保护的短期 Cookie。

- 浏览器 Cookie 不放入 access token、用户资料或可执行内容；会话 ID 使用高熵随机值并支持轮换。
- 刷新令牌轮换后，旧令牌再次出现应触发令牌族撤销和告警。
- 修改密码、MFA、账号禁用、管理员强制退出和高风险事件都应能撤销相关会话。
- RP 退出时清除本地会话；需要全局退出时，再使用 OIDC 登出能力或通过后端撤销会话，不把前端跳转成功当成撤销成功。
- 记录令牌签发、刷新、撤销和异常重放的事件摘要，禁止记录完整 bearer token。

## 06 / 提供应用接入合同

为每种应用类型提供明确的接入合同，而不是让各业务团队自行拼装登录流程。合同至少包括 issuer、发现地址、客户端注册字段、回调示例、scope、claim 映射、登出方式、密钥轮换通知和验收用例。

- 服务端 Web 应用使用 Authorization Code + PKCE，令牌兑换放在后端。
- 单页应用应评估后端会话或 BFF；若令牌必须到浏览器，仍使用 PKCE、短时访问令牌和严格的 API 受众。
- 移动端使用系统浏览器和应用回调，避免内嵌 WebView 保存登录凭证。
- 内部服务调用采用 client credentials 或受控的服务身份，不模拟员工登录。
- 老系统可以先由接入层完成协议转换，保留原有业务会话，再逐步迁移到标准 OIDC。

每个客户端单独注册和撤销。禁止多个系统共享一个 client secret；无法保密的客户端不要配置静态 secret。生产回调地址、允许 scope 和授权组织都要经过变更审核。

## 07 / 建立安全与运维控制

身份中心是高价值控制面，优先保护密钥、登录接口、管理接口和恢复流程。限制密码尝试与验证码只能减缓攻击，不能替代 MFA、风险检测、密钥保护和审计。

- 密码使用经过审查的慢哈希，MFA 恢复码一次性使用；管理员和敏感应用提高认证强度。
- 登录、授权和令牌端点设置速率限制，区分用户、客户端、IP 和设备维度，避免锁死整个组织。
- 管理员操作启用分权、二次确认和独立审计；恢复账号要有离线保护和演练。
- 使用短期密钥、明确的 `kid` 和可回滚的密钥轮换；公布公钥后保留验证旧签名所需的过渡窗口。
- 监控授权失败、state/nonce 不匹配、回调异常、刷新令牌重放、JWKS 读取失败和时钟偏差。
- 备份数据库、密钥元数据和审计索引，并分别演练恢复；备份本身采用独立权限和加密。

## 08 / 按阶段上线与验收

先部署单个测试客户端和测试组织，完成协议互操作与故障演练，再扩大到低风险应用。迁移时保留原登录回退路径，但明确回退结束日期，避免两套账号长期分叉。

- 协议验收：发现文档、授权码、PKCE、state、nonce、签名、issuer、audience、过期和回调精确匹配。
- 账号验收：新建、禁用、改邮箱、改组、删除和账号合并；验证不可变 `sub` 不因展示属性变化而改变。
- 会话验收：多设备登录、单设备退出、全局退出、密码变更、MFA 变更和刷新令牌重放。
- 可用性验收：IdP 暂时不可用、JWKS 缓存、数据库只读、队列积压、时钟偏差和密钥轮换。
- 安全验收：开放重定向、code 重放、回调串改、CSRF、scope 越权、租户串用、日志泄密和管理员越权。
- 运营验收：告警、审计检索、备份恢复、客户端撤销、密钥回滚和联系责任人。

上线判定应以测试证据和回退步骤为准。认证成功不能自动证明业务授权正确，令牌接口返回 200 也不能证明资源服务器真正按 audience 和 scope 校验。

## 参考资料

- [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html)
- [OAuth 2.0 Security Best Current Practice（RFC 9700）](https://datatracker.ietf.org/doc/html/rfc9700/)
- [Proof Key for Code Exchange（RFC 7636）](https://datatracker.ietf.org/doc/html/rfc7636)
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
