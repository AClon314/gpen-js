import { describe, expect, test } from "bun:test";
import {
  createUploadDownloadOnlyBlob,
  createRuntimeUploadDownloadSelector,
  createNativeUploadDownloadSelector,
  createVscodeUploadDownloadSelector,
  type MonkeyDownloadApi,
  type VscodeFileSystem,
} from "../src/lib/bindings/upDownloader/index.ts";

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
