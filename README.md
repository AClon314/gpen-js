# gpen-lit

Shared Lit-based web UI package for GPen hosts.

## Licensing

`gpen-ui-js` is publicly available under Apache License 2.0 so other frontend
projects can reuse these UI components without inheriting the rest of the
project's copyleft requirements.

## Intended consumers

- `gpen-browser-ext`
- `gpen-vscode-ext`

## Layout

- `src/shared`: host-agnostic components and state
- `src/browser`: browser-extension entrypoints
- `src/vscode`: VS Code webview entrypoints

This is only the initial local split scaffold. Real shared UI code still needs to
be migrated from the monorepo hosts.

# \<dope-sheet>

This webcomponent follows the [open-wc](https://github.com/open-wc/open-wc) recommendation.

## Installation

```bash
npm i dope-sheet
```

## Usage

```html
<script type="module">
  import "dope-sheet/dope-sheet.js";
</script>

<dope-sheet></dope-sheet>
```

## Linting and formatting

To scan the project for linting and formatting errors, run

```bash
npm run lint
```

To automatically fix linting and formatting errors, run

```bash
npm run format
```

## Tooling configs

For most of the tools, the configuration is in the `package.json` to reduce the amount of files in your project.

If you customize the configuration a lot, you can consider moving them to individual files.

## Protobuf / Connect RPC codegen

`gpen-js` can generate TypeScript protobuf descriptors from the sibling
`gpen-protocol` checkout with Buf and `protoc-gen-es`. The generation entrypoint
is `../gpen-protocol/protocol/all.proto`.

Install dependencies and generate:

```bash
bun i
npm run proto:generate
```

Generated files are written to `src/gen`, and the stable package entrypoint is:

```ts
import { GpenSchema } from 'dope-sheet/gen/gpen/v1/gpen_pb.js';
```

## Local Demo with `web-dev-server`

```bash
npm start
```

To run a local development server that serves the basic demo located in `demo/index.html`
