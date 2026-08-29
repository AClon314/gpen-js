import { describe, expect, test } from "bun:test";
import {
  GpenT,
  PanelUiT,
  ToolbarStateT,
  ToolbarToolT,
  ToolReferenceT,
  Vec2T,
  WorkspaceUiT,
} from "gpen-protocol/flatbuffers";

import { decodeGpen, encodeGpen } from "../src/lib/bindings/flatbuffers/codec";
import { NONE_INDEX } from "../src/lib/bindings/flatbuffers/constants";

/** Keep generated constructor defaults while setting only the fields under test. */
function make<T>(ctor: new () => T, init: Record<string, unknown>): T {
  const target = new ctor();
  for (const [key, value] of Object.entries(init)) {
    (target as Record<string, unknown>)[key] = value;
  }
  return target;
}

describe("Gpen generated object API round-trip", () => {
  test("preserves toolbar_state and workspace_ui nested in GpenT", () => {
    const toolReference = make(ToolReferenceT, {
      idname: "builtin.draw",
      idnameFallback: "builtin.annotate",
      idnamePending: "",
      spaceType: 1,
      mode: 2,
    });
    const toolbarState = make(ToolbarStateT, {
      tools: [
        make(ToolbarToolT, {
          id: "draw",
          kind: 0,
          reference: toolReference,
          label: "Draw",
          tooltip: "Draw strokes",
          icon: "brush",
          enabled: true,
          keymapId: "gpen.draw",
        }),
      ],
      activeToolId: "draw",
      workspaceStates: [],
      activeWorkspaceName: "Drawing",
      recentBrushPresetIds: ["brush.ink"],
    });
    const workspaceUi = make(WorkspaceUiT, {
      name: "Drawing",
      activeSpaceType: 1,
      activeToolRef: toolReference,
      panels: [
        make(PanelUiT, {
          id: "layers",
          spaceType: 1,
          regionId: 3,
          toolRef: toolReference,
          collapsible: true,
          expanded: false,
        }),
      ],
      layout: '{"version":1,"root":"layers"}',
      layoutVersion: 1,
      activeFrame: 12,
      viewportZoom: 1.25,
      viewportPan: make(Vec2T, { x: 10, y: -5 }),
    });
    const document = make(GpenT, {
      drawings: [],
      nodes: [],
      layers: [],
      groups: [],
      materials: [],
      activeNodeIndex: NONE_INDEX,
      childIndices: [],
      toolbarState,
      workspaceUi,
    });

    const decoded = decodeGpen(encodeGpen(document));
    expect(decoded.toolbarState).toEqual(toolbarState);
    expect(decoded.workspaceUi).toEqual(workspaceUi);
    expect(decoded.toolbarState?.tools[0]?.reference?.idname).toBe("builtin.draw");
    expect(decoded.workspaceUi?.panels[0]?.toolRef?.idname).toBe("builtin.draw");
  });
});
