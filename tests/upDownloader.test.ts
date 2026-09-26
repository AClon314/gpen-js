import { describe, expect, test } from "bun:test";
import {
  createUploadDownloadOnlyBlob,
  createRuntimeUploadDownloadSelector,
  createNativeUploadDownloadSelector,
  createVscodeUploadDownloadSelector,
  type MonkeyDownloadApi,
  type VscodeFileSystem,
} from "../src/lib/bindings/upDownloader/index.ts";
import {
  createVscodeFileTransferBridge,
  stripJsonComments,
  VSCODE_FILE_REQUEST,
  VSCODE_FILE_RESPONSE,
} from "../src/lib/bindings/upDownloader/vscode.ts";

function inputFor(file: File): HTMLInputElement {
  return { type: "file", files: [file] } as unknown as HTMLInputElement;
}

describe("upload/download bindings", () => {
  test("uses the native File API for both input elements and Files", () => {
    const selector = createNativeUploadDownloadSelector();
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });

    expect(selector.upload(inputFor(file))).toBe(file);
    expect(selector.upload(file)).toBe(file);
  });

  test("automatically uses the userscript download API when it is available", async () => {
    let downloaded: { url: string; name: string } | undefined;
    const selector = createRuntimeUploadDownloadSelector((details) => {
      downloaded = { url: details.url, name: details.name };
      details.onload?.();
    });

    await selector.download(new Blob(["hello"]), "hello.txt");
    expect(downloaded?.name).toBe("hello.txt");
    expect(downloaded?.url).toMatch(/^blob:/);
  });

  test("binds the legacy selector to a global GM_download and waits for completion", async () => {
    const globals = globalThis as typeof globalThis & { GM_download?: MonkeyDownloadApi };
    const hadPrevious = Object.prototype.hasOwnProperty.call(globals, "GM_download");
    const previous = globals.GM_download;
    let completed = false;

    globals.GM_download = (details) => {
      setTimeout(() => {
        completed = true;
        details.onload?.();
      }, 0);
    };

    try {
      await createUploadDownloadOnlyBlob().download("https://example.com/model.bin", "model.bin");
      expect(completed).toBe(true);
    } finally {
      if (hadPrevious) globals.GM_download = previous;
      else delete globals.GM_download;
    }
  });

  test("uses a VS Code symlink API in local mode", async () => {
    const links: Array<[string, string]> = [];
    const opened: string[] = [];
    const selector = createVscodeUploadDownloadSelector({
      mode: "local",
      api: {
        async createSymbolicLink(target, linkPath) {
          links.push([target, linkPath]);
        },
        async openFile(path) {
          opened.push(path);
        },
      },
    });

    const result = await selector.uploadDetailed("/work/model.bin");
    expect(result?.linked).toBe(true);
    expect(result?.file?.name).toBe("model.bin");
    expect(links).toEqual([["/work/model.bin", ".gpen/blob/model.bin"]]);
    await selector.download("/work/model.bin", "model.bin");
    expect(opened).toEqual(["/work/model.bin"]);
  });

  test("falls back to the shell symlink command before recording an external URL", async () => {
    const commands: Array<[string, readonly string[]]> = [];
    const selector = createVscodeUploadDownloadSelector({
      mode: "local",
      shell(command, args) {
        commands.push([command, args]);
      },
    });

    const result = await selector.uploadDetailed("C:\\work\\model.bin");
    expect(result?.linked).toBe(true);
    expect(commands).toEqual([["ln", ["-s", "C:\\work\\model.bin", ".gpen/blob/model.bin"]]]);
  });

  test("records the external URL when local linking is unavailable", async () => {
    const files = new Map<string, Uint8Array>();
    const fileSystem: VscodeFileSystem = {
      async readFile(path) {
        return files.get(path);
      },
      async writeFile(path, data) {
        files.set(path, new Uint8Array(data));
      },
      async mkdir() {},
      async createSymbolicLink() {
        throw new Error("symbolic links are disabled");
      },
    };
    const selector = createVscodeUploadDownloadSelector({ mode: "local", fileSystem });

    const result = await selector.uploadDetailed("/work/model copy.bin");
    expect(result?.recorded).toBe(true);
    const state = JSON.parse(new TextDecoder().decode(files.get(".gpen/state.jsonc")));
    expect(state.blob["model copy.bin"]).toBe("file:///work/model%20copy.bin");
  });

  test("transfers remote files through the injected VS Code file system", async () => {
    const files = new Map<string, Uint8Array>([
      ["/remote/model.bin", new TextEncoder().encode("data")],
    ]);
    const opened: string[] = [];
    const fileSystem: VscodeFileSystem = {
      async readFile(path) {
        return files.get(path);
      },
      async writeFile(path, data) {
        files.set(path, new Uint8Array(data));
      },
      async mkdir() {},
      async openFile(path) {
        opened.push(path);
      },
    };
    const selector = createVscodeUploadDownloadSelector({ mode: "ssh", fileSystem });

    const uploaded = await selector.upload("/remote/model.bin", ".gpen/blob/model.bin");
    expect(await uploaded?.text()).toBe("data");
    await selector.download(".gpen/blob/model.bin", "model.bin");
    expect(opened).toEqual([".gpen/blob/model.bin"]);
  });

  test("uses the VS Code bridge for remote Blob download", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const selector = createVscodeUploadDownloadSelector({
      mode: "web",
      bridge: {
        async request<T>(message: Record<string, unknown>) {
          requests.push(message);
          return undefined as T;
        },
      },
    });

    await selector.download(new Blob(["data"], { type: "text/plain" }), "model.txt");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.operation).toBe("download");
    expect(requests[0]?.name).toBe("model.txt");
    expect(requests[0]?.data).toBeInstanceOf(ArrayBuffer);
  });
});

describe("stripJsonComments", () => {
  const cases: Array<[string, string, string]> = [
    ["普通 JSON 原样通过", '{"a":1}', '{"a":1}'],
    ["行注释连同它前面的空白一起被删掉", '{\n  // note\n  "a": 1\n}', '{\n  \n  "a": 1\n}'],
    ["行尾注释删到换行为止", '{"a":1}// done', '{"a":1}'],
    ["块注释整体删除", '/* lead */{"a" /* mid */: 1}', '{"a" : 1}'],
    ["未闭合的块注释删到结尾", '{"a":1} /* dangling', '{"a":1} '],
    [
      "字符串里的行注释标记原样保留",
      '{"url":"https://example.com/a//b"}',
      '{"url":"https://example.com/a//b"}',
    ],
    ["字符串里的块注释标记原样保留", '{"glob":"src/*/*.ts"}', '{"glob":"src/*/*.ts"}'],
    ["字符串里的转义引号不会提前结束", '{"s":"a\\"//b"}', '{"s":"a\\"//b"}'],
    ["字符串里的逗号与花括号不被误伤", '{"s":"a,b}"}', '{"s":"a,b}"}'],
    ["尾逗号正则会作用于字符串内的 ,}（既有行为）", '{"s":"a,}"}', '{"s":"a}"}'],
    ["对象尾逗号删除", '{"a":1,}', '{"a":1}'],
    ["数组尾逗号删除", "[1,2,]", "[1,2]"],
    ["带换行的尾逗号删除", '{"a":1,\n}', '{"a":1}'],
    ["去注释后露出的尾逗号一并删除", '{"a":1, // c\n}', '{"a":1}'],
  ];

  for (const [name, input, expected] of cases) {
    test(name, () => {
      expect(stripJsonComments(input)).toBe(expected);
    });
  }
});

describe("VS Code file transfer bridge protocol", () => {
  interface PostedMessage {
    type?: unknown;
    id?: string;
    operation?: unknown;
    path?: unknown;
    [key: string]: unknown;
  }

  function bridgeWith(postMessage: (message: PostedMessage) => boolean | PromiseLike<boolean>) {
    const posted: PostedMessage[] = [];
    const bridge = createVscodeFileTransferBridge(
      {
        postMessage(message) {
          posted.push(message as unknown as PostedMessage);
          return postMessage(message as unknown as PostedMessage);
        },
      },
      1000,
    );
    return { bridge, posted };
  }

  test("posts a typed request and resolves on the matching response", async () => {
    const { bridge, posted } = bridgeWith(() => true);
    const pending = bridge.request<{ value: string }>({ operation: "readFile", path: "/a/b" });
    expect(posted).toHaveLength(1);
    expect(posted[0]?.type).toBe(VSCODE_FILE_REQUEST);
    expect(posted[0]?.operation).toBe("readFile");
    expect(posted[0]?.path).toBe("/a/b");
    expect(typeof posted[0]?.id).toBe("string");

    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: VSCODE_FILE_RESPONSE,
          id: posted[0]?.id,
          ok: true,
          value: { value: "bytes" },
        },
      }),
    );
    expect(await pending).toEqual({ value: "bytes" });
    bridge.dispose?.();
  });

  test("ignores foreign messages and rejects on an error response", async () => {
    const { bridge, posted } = bridgeWith(() => true);
    const pending = bridge.request({ operation: "mkdir", path: "/x" });
    const id = posted[0]?.id;

    globalThis.dispatchEvent(new MessageEvent("message", { data: "not-an-object" }));
    globalThis.dispatchEvent(
      new MessageEvent("message", { data: { type: "other", id, ok: true } }),
    );
    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: { type: VSCODE_FILE_RESPONSE, id: "unknown", ok: true },
      }),
    );
    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: { type: VSCODE_FILE_RESPONSE, id, ok: false, error: "boom" },
      }),
    );

    await expect(pending).rejects.toThrow("boom");
    bridge.dispose?.();
  });

  test("rejects when postMessage reports the message was not sent", async () => {
    const { bridge } = bridgeWith(() => false);
    await expect(bridge.request({ operation: "writeFile", path: "/x" })).rejects.toThrow(
      "VS Code rejected the file transfer message",
    );
    bridge.dispose?.();
  });

  test("rejects when postMessage throws synchronously", async () => {
    const { bridge } = bridgeWith(() => {
      throw new Error("no channel");
    });
    await expect(bridge.request({ operation: "mkdir", path: "/x" })).rejects.toThrow("no channel");
    bridge.dispose?.();
  });

  test("times out with the operation name", async () => {
    const bridge = createVscodeFileTransferBridge({ postMessage: () => true }, 5);
    await expect(bridge.request({ operation: "openFile", path: "/x" })).rejects.toThrow(
      "timed out: openFile",
    );
    bridge.dispose?.();
  });

  test("dispose detaches the listener and rejects in-flight requests", async () => {
    const { bridge } = bridgeWith(() => true);
    const pending = bridge.request({ operation: "readFile", path: "/x" });
    bridge.dispose?.();
    await expect(pending).rejects.toThrow("VS Code file transfer bridge was closed");
    // 监听已摘除，后续消息不会再抛错。
    globalThis.dispatchEvent(
      new MessageEvent("message", { data: { type: VSCODE_FILE_RESPONSE, id: "x", ok: true } }),
    );
  });
});
