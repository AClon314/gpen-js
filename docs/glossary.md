# 术语表（Glossary）

本项目文档里出现的英文缩写 / 术语速查。按主题分组。
（`docs/todo-safe.md` 等文里的缩写都指向这里。）

## Web 平台 / DOM

| 缩写 | 全称 | 说明 |
| --- | --- | --- |
| postMessage | `window.postMessage()` | 浏览器里跨窗口 / 跨 origin 通信的唯一安全 API（父页面 ↔ iframe）。谁能调用都能发，所以必须自己校验发送方 |
| `event.origin` | message event 的 `origin` | 形如 `"https://evil.com"`，**发消息那个窗口的 origin**；对照白名单校验 |
| `event.source` | message event 的 `source` | 发送方的 `WindowProxy`；用 `event.source === iframe.contentWindow` 确认是「我那个 iframe」 |
| nonce | *number used once* | 一次性随机数（`crypto.randomUUID()`）；带上它防「插话」与重放 |
| MessagePort / MessageChannel | `new MessageChannel()` | 一条**私有管道**；把 `port` 用 `postMessage(msg, [port])` transfer 给对方后，只有你们俩能收发 |
| WindowProxy | — | 对另一个窗口的跨 origin 代理对象（你只能对它调 `postMessage` 等少数操作，读不到对方 DOM） |
| `window.parent` | — | 当前 iframe 的父窗口 |
| iframe | inline frame | 页面里嵌入的另一个文档（有自己的 origin） |
| HMR | Hot Module Replacement | 开发时热更新；`mount()` 的组件在 HMR 下可能重复挂载（本项目遇过「两颗球」） |
| TUI | Text User Interface | 终端字符界面；本项目 `ch`/`lh` 单位规范就是为将来 TUI 移植铺路 |

## 存储

| 缩写 | 全称 | 说明 |
| --- | --- | --- |
| OPFS | **O**rigin **P**rivate **F**ile **S**ystem | 每个 origin 一块沙箱文件系统（`navigator.storage.getDirectory()`）；broker 把 blob 存这里 |
| IndexedDB | — | 浏览器里的结构化本地数据库（KV / Blob 后端之一） |
| localStorage | — | 同步的字符串 KV（本项目存 `gpen.workspaceState`） |
| ns | namespace（命名空间） | 数据的逻辑分区键；**由服务端按「已认证身份 + 数据集」派生**目录，如 `users/<sub>/datasets/<id>` |
| Blob | binary large object | 二进制对象（文件/图片等） |
| KV | key–value | 键值存储（`storage.kv`） |
| CHIPS | **C**ookies **H**aving **I**ndependent **P**artitioned **S**tate | 第三方 cookie 的「按顶层站点分区」机制（`SameSite=None; Partitioned`） |
| persistence | — | `navigator.storage.persist()` — 申请「不被浏览器自动清除」的持久化存储 |

## 鉴权 / 授权 / 密码学

| 缩写 | 全称 | 说明 |
| --- | --- | --- |
| WebAuthn | Web Authentication | 浏览器标准 API（`navigator.credentials.create/get`） |
| Passkey | — | 基于 WebAuthn 的「设备/同步密钥」登录方式；私钥在安全元件里，抗钓鱼 |
| OAuth 2.0 / OIDC | Open Authorization / OpenID Connect | 委托授权 / 身份层（第三方登录） |
| IdP | Identity Provider | 身份提供方（GitHub、Google…） |
| JWT | JSON Web Token | 可携带 claims 并带签名的 token |
| JWS | JSON Web Signature | JWT 的签名形态（`header.payload.signature`） |
| JWKS | JSON Web Key Set | 服务端公布的公钥集合，用于验 JWT 签名 |
| `sub` | subject | JWT：这个 token 属于谁（用户） |
| `aud` | audience | JWT：这个 token 是给谁的（broker） |
| `scope` | — | JWT：允许的操作（如 `kv:r`, `blob:w`） |
| `exp` | expiration | JWT：过期时间 |
| `jti` | JWT ID | JWT：唯一 id，用于防重放 |
| `cnf` | confirmation | JWT：绑定的密钥（thumbprint），配合 DPoP 用 |
| DPoP | **D**emonstrating **P**roof-of-**P**ossession | 用客户端私钥签每个请求，证明「token 持有者就是它」；偷到 token 也重放不了 |
| JCS | JSON Canonicalization Scheme (RFC 8785) | 签名前把 JSON 规范化，避免顺序/空白导致校验不一致 |
| HMAC | Hash-based Message Authentication Code | 共享密钥的 MAC（HS256 用） |
| ES256 / RS256 / Ed25519 | ECDSA / RSA / Edwards-curve 签名算法 | JWT 常用签名算法（非对称） |
| SHA-256 | Secure Hash Algorithm 256-bit | 摘要算法（内容寻址 / 完整性） |
| CryptoKey | — | Web Crypto 的密钥对象；`extractable: false` 时**导不出来**，可结构化克隆后存 IndexedDB |
| AES-GCM | Advanced Encryption Standard – Galois/Counter Mode | 带认证的对称加密（篡改必被发现） |
| IV | Initialization Vector | 每次加密的随机初始向量（`crypto.getRandomValues`） |
| E2E | end-to-end | 端到端加密：broker 只存密文，看不到明文 |
| SRI | Subresource Integrity | `<script integrity="sha384-…">`，加载时校验文件没被替换 |
| Merkle | Merkle tree | 哈希树；`digest(prevHash + record)` 串成 append-only 审计链 |

## HTTP / 安全头

| 缩写 | 全称 | 说明 |
| --- | --- | --- |
| CSP | Content-Security-Policy | 限制页面能执行/请求/被嵌入什么（`script-src`、`connect-src`…） |
| CORS | Cross-Origin Resource Sharing | 跨 origin 访问的允许列表（`Access-Control-Allow-Origin`…） |
| CORP | Cross-Origin-Resource-Policy | 声明资源允许被哪些 origin 嵌入 |
| COOP / COEP | Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy | 跨窗口 / 跨进程隔离头 |
| `frame-ancestors` | CSP 指令 | 谁可以把本页放进 iframe（替代 `X-Frame-Options`） |
| X-Frame-Options | — | 老式的「禁止被 iframe 嵌入」响应头 |
| Permissions-Policy | — | 逐特性开关（如 `publickey-credentials-get`） |
| nosniff | `X-Content-Type-Options: nosniff` | 禁止浏览器嗅探内容类型 |
| attachment | `Content-Disposition: attachment` | 强制下载而非内联展示 |
| MIME | Multipurpose Internet Mail Extensions | 内容类型（`Content-Type`，如 `image/png`） |
| SAA | Storage Access API | `document.requestStorageAccess()` / `hasStorageAccess()`；第三方 cookie 被拦时申请存储访问 |

## 项目 / 构建

| 缩写 | 全称 | 说明 |
| --- | --- | --- |
| WebExtension | — | 浏览器扩展（Chrome/Firefox/Safari） |
| userscript | — | 油猴脚本（Tampermonkey 等）；用 `GM_*` 存数据 |
| `GM_*` | Greasemonkey API | 油猴提供的特权 API（如 `GM_setValue`），宿主页拿不到 |
| adapter-static | `@sveltejs/adapter-static` | SvelteKit 静态预渲染适配器（本项目用它；所以 broker 是静态页，没有服务端） |
| CF Pages / CF Worker | Cloudflare Pages / Workers | 静态托管 / 边缘函数；**签发、验签 token 需要 Worker（或外部 IdP）** |
| Durable Object / KV | CF 的存储原语 | 用于按用户配额、限速、状态 |
| OPFS broker | — | 运行在可信 origin、用 OPFS 存 blob 的中转页（`src/routes/storage-broker`） |
| FBS | FlatBuffers schema | 本项目协议格式（见 `docs/flatbuffers.md`） |
