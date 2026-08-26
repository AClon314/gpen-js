import { describe, expect, test } from "bun:test";
import { createOpfsBlobBackend } from "../src/lib/bindings/storage/index.ts";

class FakeFile {
  readonly name: string;
  private bytes = new Uint8Array();

  constructor(name: string) {
    this.name = name;
  }

  async createWritable() {
    let next = new Uint8Array();
    return {
      async write(value: Blob) {
        next = new Uint8Array(await value.arrayBuffer());
      },
      async close() {
        (this as InstanceType<typeof FakeFile>).bytes = next;
      },
      async abort() {},
    } as unknown as FileSystemWritableFileStream;
  }

  async getFile(): Promise<File> {
    return new File([this.bytes], this.name);
  }
}

class FakeDirectory {
  readonly entries = new Map<string, FakeDirectory | FakeFile>();

  async getDirectoryHandle(name: string, options: { create?: boolean }) {
    const existing = this.entries.get(name);
    if (existing instanceof FakeDirectory) return existing;
    if (existing) throw new Error("Not a directory");
    if (!options.create)
      throw Object.assign(new Error("Missing directory"), { name: "NotFoundError" });
    const directory = new FakeDirectory();
    this.entries.set(name, directory);
    return directory;
  }

  async getFileHandle(name: string, options: { create?: boolean }) {
    const existing = this.entries.get(name);
    if (existing instanceof FakeFile) return existing;
    if (existing) throw new Error("Not a file");
    if (!options.create) throw Object.assign(new Error("Missing file"), { name: "NotFoundError" });
    const file = new FakeFile(name);
    this.entries.set(name, file);
    return file;
  }

  async removeEntry(name: string) {
    if (!this.entries.delete(name)) {
      throw Object.assign(new Error("Missing entry"), { name: "NotFoundError" });
    }
  }
}

describe("OPFS Blob backend", () => {
  test("persists nested files and rejects traversal paths", async () => {
    const root = new FakeDirectory() as unknown as FileSystemDirectoryHandle;
    const backend = createOpfsBlobBackend({ root, directory: "gpen/blob" });

    await backend.set(
      "models/latest.bin",
      new Blob(["binary"], { type: "application/octet-stream" }),
    );
    expect(await (await backend.get("models/latest.bin"))?.text()).toBe("binary");
    await backend.delete("models/latest.bin");
    expect(await backend.get("models/latest.bin")).toBeUndefined();
    await expect(backend.get("../outside")).rejects.toThrow("relative path");
    expect(() => createOpfsBlobBackend({ root, directory: "../outside" })).toThrow("relative path");
  });
});
