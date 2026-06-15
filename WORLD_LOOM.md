# World Loom Client

This fork defaults to the local World Loom server-backed browser path.

## Default Local Connection

The app config points to:

```text
server: localhost:25565
version: 1.20.1
username: loom_dev
proxy: :18081
```

`proxy: :18081` points at the Rust-owned browser bridge served by `world-loom-server`. The client still uses the existing `minecraft-web-client` proxy protocol, but the target path no longer starts the Node `server.js` bridge.

## Run With World Loom Defaults

```sh
pnpm start:world-loom
```

Then open the dev URL printed by Rsbuild. The app should auto-connect to the local `world-loom-server` through the Rust browser bridge.

The default root URL uses `config.json` app params. The app retries entry after async config load so local World Loom defaults can auto-connect without adding query parameters by hand.

## Smoke Tests

Use distinct usernames when opening more than one browser client against the same local server. The stack-level smoke scripts do this automatically:

```sh
../scripts/smoke-m4-dual-client.sh
../scripts/smoke-m5-persistence.sh
../scripts/smoke-m6-mcp.sh
```

World Loom keeps using the existing client debug/status surfaces. Server tick timing, connected player count, and ping status are sent by `world-loom-server` through the tab list/action bar, while the browser client shows connection ping in `NetworkStatus` and client FPS in the existing debug overlay when the renderer exposes FPS data.

## Node Bridge Fallback

The old Node bridge remains available only as a fallback/debug path:

```sh
pnpm start:world-loom:node-bridge
```

That fallback serves the bridge on `:18080`. It is no longer the default gameplay path.

## Cloudflare Pages

For the family-play static deployment path, use `PAGES.md`. The Pages build is static and uses `WORLD_LOOM_CLIENT_*` build environment variables to generate `dist/config.json`.

## Scope Guard

World Loom does not rewrite rendering, controls, inventory UI, or Valence core for this integration slice.
