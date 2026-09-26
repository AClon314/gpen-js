/**
 * upDownloader barrel：只负责导出，实现按 target 分文件。
 *
 * - `web.ts`：npm / 油猴（GM_download）/ 浏览器扩展共用的 web 实现。
 * - `vscode.ts`：VS Code webview + 扩展侧的 postMessage 文件传输。
 */
export {
  /** 创建 VS Code 版上传 / 下载选择器。 */
  createVscodeUploadDownloadSelector,
  /** 基于 webview postMessage 的请求 / 响应桥。 */
  createVscodeFileTransferBridge,
  /** 默认的本地状态文件路径（`.gpen/state.jsonc`）。 */
  DEFAULT_EXTERNAL_STATE_PATH,
  /** webview → 扩展的文件传输请求消息类型。 */
  VSCODE_FILE_REQUEST,
  /** 扩展 → webview 的文件传输响应消息类型。 */
  VSCODE_FILE_RESPONSE,
} from "./vscode.js";
export type {
  /** 文件传输桥支持的操作。 */
  VscodeFileOperation,
  /** 扩展侧的文件系统操作（读 / 写 / mkdir / 符号链接 / 打开）。 */
  VscodeFileSystem,
  /** 宿主提供的文件传输 API（上传 / 下载 / 文件操作）。 */
  VscodeFileTransferApi,
  /** 文件传输请求 / 响应桥（带超时与 dispose）。 */
  VscodeFileTransferBridge,
  /** A host can be passed directly, or the same shape can be used by tests. */
  VscodeFileTransferHost,
  /** VS Code 文件传输选项（模式、宿主 / 桥、路径策略、状态文件）。 */
  VscodeFileTransferOptions,
  /** 一条文件传输请求（请求 id + 操作 + 载荷）。 */
  VscodeFileTransferRequest,
  /** 一条文件传输响应（ok / 值 / 错误）。 */
  VscodeFileTransferResponse,
  /** webview 侧 `postMessage` 的最小形状。 */
  VscodeFileTransferWebviewApi,
  /** 上传输入：文件输入元素、File 或路径字符串。 */
  VscodeUploadInput,
  /** 一次上传的结果（目标文件、来源 / 目的地、是否建链 / 记账）。 */
  VscodeUploadResult,
  /** VS Code 选择器的对外接口（含 detailed 上传）。 */
  VscodeUploadDownloadSelector,
} from "./vscode.js";

export {
  /** Accept both the MDN file input element and an already selected File. */
  uploadFromInput,
  /** 用 `<a download>` 触发浏览器下载（Blob 先转 object URL）。 */
  downloadInBrowser,
  /** Create the MDN/File API selector explicitly. */
  createNativeUploadDownloadSelector,
  /** 取注入的 / 全局的 GM 下载 API。 */
  getMonkeyDownloadApi,
  /** 优先用 GM_download、否则退回原生下载的 FileSelector。 */
  createMonkeyUploadDownloadSelector,
  /** 创建不带持久化的上传 / 下载选择器（GM_download 优先，否则原生）。 */
  createUploadDownloadOnlyBlob,
  /** 按运行时能力（GM_download / GM.download）选择下载实现。 */
  createRuntimeUploadDownloadSelector,
} from "./web.js";
export type {
  /** 统一的文件选择 / 下载接口。 */
  FileSelector,
  /** 油猴 `GM_download` 的参数。 */
  MonkeyDownloadDetails,
  /** 油猴下载 API 的最小形状。 */
  MonkeyDownloadApi,
} from "./web.js";
