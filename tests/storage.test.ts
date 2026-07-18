import { beforeEach, describe, expect, it } from 'bun:test';
// 受模拟环境限制，未测试 createKvBackend()
import {
  GPEN_PROTOCOL_MAJOR_VERSION,
  createKvStore,
} from '../src/systems/storage.js';

function createBackend<T extends Record<string, unknown>>(initialState: T) {
  let state = initialState;
  let loadCount = 0;
  let saveCount = 0;

  return {
    backend: {
      async load() {
        loadCount += 1;
        return state;
      },
      async save(snapshot: T) {
        saveCount += 1;
        state = snapshot;
      },
    },
    getState() {
      return state;
    },
    setState(nextState: T) {
      state = nextState;
    },
    getLoadCount() {
      return loadCount;
    },
    getSaveCount() {
      return saveCount;
    },
  };
}

function createHarness() {
  return createBackend({
    nested: {
      list: [{ label: 'zero' }, { label: 'one' }],
    },
    plain: 'value',
  });
}

function createHarnessWithSettings() {
  const panels: Array<{ title: string } | undefined> = [{ title: 'seed' }];

  return createBackend({
    nested: {
      list: [{ label: 'zero' }, { label: 'one' }],
    },
    plain: 'value',
    settings: {
      panels,
    },
  });
}

function createLooseHarness() {
  return createBackend<Record<string, unknown>>({
    nested: {
      list: [{ label: 'zero' }, { label: 'one' }],
    },
    plain: 'value',
  });
}

describe('createKvStore', () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
  });

  it('reads deep paths through function-style getters', async () => {
    const store = createKvStore(harness.backend);

    await expect(store.plain()).resolves.toBe('value');
    await expect(store.nested.list[1].label()).resolves.toBe('one');
  });

  it('preserves concrete return types through generic store shapes', async () => {
    const store = createKvStore(harness.backend);
    const plain: string = await store.plain();
    const label: string = await store.nested.list[0].label();

    expect(plain).toBe('value');
    expect(label).toBe('zero');
  });

  it('writes deep object paths and creates missing containers', async () => {
    const settingsHarness = createHarnessWithSettings();
    const store = createKvStore(settingsHarness.backend);

    await expect(store.settings.panels[2].title('Layers')).resolves.toBe(
      'Layers',
    );

    expect(settingsHarness.getState()).toEqual({
      nested: {
        list: [{ label: 'zero' }, { label: 'one' }],
      },
      plain: 'value',
      settings: {
        panels: [{ title: 'seed' }, undefined, { title: 'Layers' }],
      },
    });
  });

  it('replaces the whole root when setting kv()', async () => {
    const replaceHarness = createBackend<Record<string, unknown>>({
      nested: {
        list: [{ label: 'zero' }, { label: 'one' }],
      },
      plain: 'value',
    });
    const store = createKvStore(replaceHarness.backend);

    await expect(store({ reset: true })).resolves.toEqual({ reset: true });
    await expect(store()).resolves.toEqual({ reset: true });
    expect(replaceHarness.getState()).toEqual({ reset: true });
  });

  it('reads the latest backend state on every get without keeping a local mirror', async () => {
    const store = createKvStore(harness.backend);

    await expect(store.plain()).resolves.toBe('value');

    harness.setState({
      nested: {
        list: [{ label: 'zero' }, { label: 'updated' }],
      },
      plain: 'changed-in-backend',
    });

    await expect(store.plain()).resolves.toBe('changed-in-backend');
    await expect(store.nested.list[1].label()).resolves.toBe('updated');
    expect(harness.getLoadCount()).toBe(3);
  });

  it('does not implicitly deep-clone values before saving', async () => {
    const looseHarness = createLooseHarness();
    const store = createKvStore(looseHarness.backend);
    const payload = { nested: { flag: false } };

    await store.session(payload);
    payload.nested.flag = true;

    await expect(store.session()).resolves.toBe(payload);
    expect(looseHarness.getState().session).toBe(payload);
  });

  it('lets callers serialize writes explicitly with await', async () => {
    const sequence: string[] = [];
    const state: Record<string, unknown> = {};
    const store = createKvStore({
      async load() {
        sequence.push('load');
        return state;
      },
      async save(snapshot: Record<string, unknown>) {
        sequence.push('save');
        Object.assign(state, snapshot);
      },
    });

    await store.first('a');
    await store.second('b');

    expect(sequence).toEqual(['load', 'save', 'load', 'save']);
    expect(state).toEqual({ first: 'a', second: 'b' });
  });

  it('does not serialize overlapping writes internally', async () => {
    const sequence: string[] = [];
    let releaseFirstSave!: () => void;
    let markFirstSaveStarted!: () => void;
    const firstSaveBlocked = new Promise<void>(resolve => {
      releaseFirstSave = resolve;
    });
    const firstSaveStarted = new Promise<void>(resolve => {
      markFirstSaveStarted = resolve;
    });
    let saveCount = 0;
    const state: Record<string, unknown> = {};

    const store = createKvStore({
      async load() {
        sequence.push('load');
        return state;
      },
      async save(snapshot: Record<string, unknown>) {
        saveCount += 1;
        const saveId = saveCount;
        sequence.push(`save-${saveId}-start`);
        Object.assign(state, snapshot);

        if (saveId === 1) {
          markFirstSaveStarted();
          await firstSaveBlocked;
        }

        sequence.push(`save-${saveId}-end`);
      },
    });

    const firstWrite = store.first('a');
    const secondWrite = store.second('b');

    sequence.push('after-start');
    await firstSaveStarted;
    expect(sequence).toEqual([
      'load',
      'load',
      'after-start',
      'save-1-start',
      'save-2-start',
      'save-2-end',
    ]);

    releaseFirstSave();
    await firstWrite;
    await secondWrite;

    expect(sequence).toEqual([
      'load',
      'load',
      'after-start',
      'save-1-start',
      'save-2-start',
      'save-2-end',
      'save-1-end',
    ]);
    expect(state).toEqual({ second: 'b', first: 'a' });
  });
});

describe('protocol version', () => {
  it('derives dbVersion major from generated proto package', () => {
    expect(GPEN_PROTOCOL_MAJOR_VERSION).toBe(1);
  });
});
