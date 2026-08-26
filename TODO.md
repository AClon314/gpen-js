- [x] 搭建真实环境，CI测试自动化
  - [x] 参考gpen-browser-ext， 引入 ithub.com/wxt-dev/wxt 框架来简化 manifest v3 配置，以同时支持chrome/firefox/safari。难点：wxt似乎自带文件目录级别，与现有的gpen-js/src内的结构差异较大，如何引入 wxt? 以及是否有必要引入 wxt?
  - [ ] monkey 如何实现ci？
  - [x] vscode: code.visualstudio.com/raw/api/working-with-extensions/testing-extension.md
  - [x] website: 当前的bun或node.js是否包含 website.ts 所需的接口？如果不包含，是否有必要引入 jsdom 或类似更加真实且快速的测试库？

- [x] crossTabBus 消息传递层
- [x] storage 数据存储层，需重构
  - [x] OPFS 使用 crossTabBus 的 ArrayBuffer 跨 tab 传递数据；文件可统一存储在 domainX 的 OPFS 里，由 broker 分发
  - [x] 同步 storage -> kv
        `bindBlobToKv` / `createBlobKvSyncHooks` 将 Blob 的外部引用写入 KV，支持
        set/delete、URL schema、自动 `submit()` 和动态 proxy hooks；`blob.get.pathA.pathB`
        对应 `pathA/pathB`。
  - [x] `lib/bindings/selector/` 更名为 `upDownloader/`
    - [x] monkey/browser-ext/npm 使用 MDN File API；userscript 可选用 `GM_download`。
    - [x] VS Code 提供统一的本地、web、ssh 上传/下载 API。
    - [x] 本地 upload 优先尝试 VS Code API、shell `ln -s`/`mklink`，失败后记录到
          `.gpen/state.jsonc`；download 写入后通过 VS Code open-file API 打开。

- [ ] web-component 评估是否要引入 opensource.adobe.com/spectrum-web-components/
  - [ ] 类似adobe的面板伸缩系统，可以变为一个图标按钮
- [ ] 一个工具栏浮动面板，默认靠下居中，可移动拖拽（考虑使用 interact.js来实现，这个库对移动端友好 ），包含5个操作按钮:
  - [ ] [鼠标] 交互模式，选中时，鼠标/笔/触摸事件 被网页接收（即释放控制权）
  - [ ] [画笔] 画笔工具，选中时，拦截鼠标/笔/触摸事件，绘制的stroke会“附着”在网页上，随网页滚动。
    - [ ] 防误触: 笔 > 触摸 > 鼠标，笔在绘画时，忽略触摸与鼠标事件(后期提供mixin机制，通过重新组织代码，以覆盖此行为)
    - [ ] 切换粗细与颜色
  - [ ] [橡皮擦] 支持类似 blender, 按 一整条笔迹stroke/顶点point/溶解disolve, 见 docs.blender.org/manual/en/latest/grease_pencil/modes/draw/tools/erase.html (我们暂不实现disolve, 因为比较复杂，要同时控制顶点与颜色透明度)
  - [ ] [套索] 选择工具(暂时不做，只放个按钮)
  - [ ] [图层] 打开图层面板。

- [ ] 一个图层浮动面板
