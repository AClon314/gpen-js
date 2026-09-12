# storage-broker 安全设计（TODO / 草案）

> 目标：**即使客户端的 gpen-js 被篡改，broker 也要把损失限制在「无害」**。
> 相关：`src/routes/storage-broker/+page.svelte`、`src/lib/bindings/storage/`、`docs/storage.md`、`TODO.md` P1。
> 缩写 / 术语速查见 [glossary.md](./glossary.md)。

---

## 0. 威胁模型与结论

**对手**：被篡改的客户端（网页 / WebExtension / 油猴脚本）。
它能：用**用户自己的凭据**、伪造它发送的**一切**（包括 `data-version` / `data-hash` / `data-instance`）、破坏**自己的**数据。

**做不到的事（别自欺）**：

- Web **没有**任何 API 能证明「浏览器加载的 JS 是官方版」；自报的 hash/签名可**重放**。
- 硬件证明（WebAuthn/TPM）只能证明「密钥在安全元件」，**不能**证明代码版本。
- 一旦用户设备上跑的是被改的代码，它能做官方代码能做的一切。

**所以目标 = 限制爆炸半径**：

| 维度 | 目标 |
| --- | --- |
| 横向 | 改客户端也**访问不到别人的**数据 |
| 纵向 | **提不了权**（scope 限死） |
| 注入 | 存储内容**打不回来当代码执行** |
| 完整性 | 被改的数据**可检测** |
| 重放 | token/请求有界、绑定持有者 |

**分层**：分发期完整性（SRI / 代码签名）保护**诚实用户**；运行时靠「用户鉴权 + 能力授权 + 数据校验/签名」。

---

## 1. 用户鉴权（Authentication）

| 机制 | 关键 API / 做法 |
| --- | --- |
| Passkey / WebAuthn | `navigator.credentials.create()/get()`、`PublicKeyCredential`；服务端验 assertion 签名（抗钓鱼）。iframe 内需要 `Permissions-Policy: publickey-credentials-get` + iframe `allow=` |
| OAuth2 / OIDC | 交给可信 IdP；服务端用 JWKS + `crypto.subtle.verify()` 验 `id_token` |
| 会话 | `Set-Cookie: …; HttpOnly; Secure; SameSite=None; Partitioned`（CHIPS）；第三方 cookie 被拦时用 **Storage Access API**：`document.requestStorageAccess()` / `hasStorageAccess()` |
| 消息门禁 | 校验 `event.origin` + `event.source === iframe.contentWindow` + 会话 nonce；用 **`MessageChannel`** 把 `MessagePort` transfer 过去，把通道锁死在一对窗口 |
| 进程隔离 | `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy`（防跨窗口互操作，非鉴权） |

⚠️ **油猴的 origin 不可信**：脚本跑在宿主页 origin，`event.origin` 是**宿主页**（evil.com 也能发）。所以 origin 白名单**不能**当鉴权——必须靠**用户 token**（存 `GM_*`）换取。

---

## 2. 能力授权（Authorization）

- **作用域 JWT（JWS）**，claims：`sub`(用户) / `aud`(broker) / `scope`(`kv:r/w`, `blob:r/w`) / `ns`(数据集) / `exp` / `jti`(防重放) / `cnf`(绑定密钥)。
  - 验签：`crypto.subtle.importKey()` + `crypto.subtle.verify()`（ES256 / RS256 / Ed25519；HS256 走 HMAC）。
- **DPoP / 持有证明**：客户端 `crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'}, false, ['sign','verify'])`，每次请求 `crypto.subtle.sign()` 出 proof；服务端用 token 里 `cnf` 的公钥验 → 偷到 token 也换不了客户端重放。
- **命名空间由服务端派生**：OPFS 目录 = `users/<sub>/datasets/<id>`，**绝不用**客户端给的自由路径。
- **配额 / 限速**：按 `sub` 计（字节数、条数、QPS），CF Durable Object / KV。

---

## 3. 数据校验（Validation）

- **schema**：Zod / valibot 在服务端校验（形状、类型、长度）；`Content-Length` 与实际 body 上限。
- **绝不 `eval` 客户端数据**；JSON 只当数据解析。
- **MIME 白名单 + 回放安全**：`X-Content-Type-Options: nosniff`、`Content-Disposition: attachment`；读 blob 走独立 path/origin + `Content-Security-Policy: sandbox` → 防「存 blob 打回来当代码跑」。
- **读时也校验**：不信任已存 metadata，load 时重新校验。
- **规范化**：签名/MAC 前先做规范序列化（RFC 8785 JCS），避免歧义。

---

## 4. 数据签名 / 完整性（Integrity）

- **设备密钥**：`crypto.subtle.generateKey(..., extractable:false, ...)` → `CryptoKey` 可结构化克隆，**直接存 IndexedDB**，导不出来。
- **逐条签名/MAC**：`crypto.subtle.sign()` 写时签，broker/对端 `verify()`。
- **内容寻址**：`crypto.subtle.digest('SHA-256', bytes)` 当 key → 去重 + 完整性。
- **审计链**：`digest(prevHash || record)` 串成 Merkle / append-only。
- **端到端加密（可选）**：`crypto.subtle.encrypt/decrypt({name:'AES-GCM'})` + `crypto.getRandomValues()` 生成 IV；broker 只存密文，GCM 自带认证。
- **随机数**：`crypto.getRandomValues()`（nonce/IV）、`crypto.randomUUID()`（`data-instance`）。

---

## 5. 平台加固

- **CSP**：`script-src 'self'; connect-src <白名单>; frame-ancestors <白名单>`；配 `X-Frame-Options`。
- **CORS**：broker 的 HTTP 端点用允许列表；更好是「只走 iframe + postMessage」，不开 CORS。
- **Permissions-Policy**：关掉用不到的特性；`Cross-Origin-Resource-Policy`。
- **SRI**：`<script integrity="sha384-…">` 保护**诚实用户**的加载完整性（对油猴注入无效）。

---

## 6. 硬约束 / 已知坑

1. **`crypto.subtle` 只在安全上下文**（https / localhost）可用。宿主页是 http 时客户端拿不到 subtle → 要么自带纯 JS 实现（noble 等），要么把需要密码学的操作放进 **broker 的 https iframe** 里做。
2. **油猴 origin 不可靠**（见 §1）。
3. **当前 broker 是静态页（adapter-static）→ 没有服务端**：
   - 签发 / 验签 token 需要真正的**服务端**（CF Worker）或**外部 IdP**；
   - 静态页里放的任何密钥都是**公开**的，不能当秘密（只能放公钥）。
4. **第三方 cookie / Storage Access API**：跨 origin iframe 的会话要按 CHIPS 或 SAA 设计。
5. **WebAuthn in iframe** 需要 `Permissions-Policy` + iframe `allow=`。

---

## 7. 落到当前架构的最小清单

```
postMessage 门禁:  event.origin + event.source + nonce + transfer MessagePort
鉴权:              Passkey/OAuth → HttpOnly Partitioned cookie 或 short-lived JWT
能力:              scope+ns+exp+cnf 的 JWT；crypto.subtle.verify 验签；DPoP 绑密钥
命名空间:          users/<sub>/datasets/<id>（服务端派生）
blob:              SHA-256 内容寻址 + MIME 白名单 + nosniff + 配额
完整性:            客户端非导出密钥 crypto.subtle.sign，或 AES-GCM 密文
```

**现状问题（先修）**：`storage-broker/+page.svelte` 从 URL 读 `parentOrigin` / `channel`：

```ts
const parentOrigin = params.get('parentOrigin');   // URL 参数，任意嵌入者可指定
const channel = params.get('channel');
bus = new CrossOriginBus({ remoteWindow: window.parent, targetOrigin: parentOrigin, channel });
broker = await createOpfsBlobBroker(bus, { root });
```

→ **任何页面**都能 iframe 这个 broker、传任意 `parentOrigin`/`channel`，对 broker origin 的 **OPFS 做读写**；没有用户鉴权、没有来源隔离、key 由客户端任意给定。`targetOrigin: parentOrigin` 只限制「回发目标」，而攻击者本身就是那个 parent，等于没防。

---

## 8. 分期落地（建议顺序，先做收益最高的）

- **P0 — postMessage 门禁 + 命名空间隔离**（无服务端也能做）
  - 校验 `event.origin` 白名单 + `event.source` + 会话 nonce；用 transfer 的 `MessagePort` 替代裸 `window`。
  - OPFS 目录按 `ns` 派生，禁止客户端自由路径。
  - **收益**：立刻消除「谁都读写同一 OPFS」。
- **P1 — 用户鉴权 + 配额**
  - 上 Passkey/OAuth（需要 CF Worker 或外部 IdP）；`HttpOnly; Secure; SameSite=None; Partitioned` cookie 或短 TTL JWT。
  - 按 `sub` 配额 / 限速。
- **P2 — 能力 token + DPoP**
  - `scope/ns/exp/jti/cnf`；`crypto.subtle.verify` + DPoP 绑密钥。
- **P3 — 数据完整性**
  - 客户端非导出设备密钥 + 逐条签名；blob 走 SHA-256 内容寻址；需要保密时上 AES-GCM。
- **并行 — 分发完整性**
  - SRI / 代码签名（保护诚实用户，抬高「非官方构建」门槛）。

---

## 9. 验收要点（每条可测）

- [ ] 从**未白名单的 origin** 嵌入 broker：postMessage 被拒，读不到任何数据。
- [ ] 知道别人的 `ns` 也**读不到**（服务端派生 + 校验）。
- [ ] 篡改 OPFS 里的记录：读取时**签名/MAC 校验失败**并被拒。
- [ ] token 换到另一个客户端重放：DPoP `cnf` 校验**失败**。
- [ ] 超配额写入：被拒且**不影响**其他用户。
- [ ] 存 HTML/SVG blob 后取回：**不执行**（nosniff + sandbox + attachment）。
- [ ] 直接 `fetch` broker 的 HTTP 端点：**无 CORS**，拿不到数据。
- [ ] 被篡改的客户端用**自己的**凭据：只能碰自己的 ns，**无法**越权。
