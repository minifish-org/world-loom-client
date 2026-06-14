# World Loom Client V0

This fork defaults to the local World Loom server-backed path for V0.

## Default Local Connection

The app config points to:

```text
server: localhost:25565
version: 1.20.1
username: loom_dev
proxy: :18080
```

`proxy: :18080` is the existing `minecraft-web-client` WebSocket-to-TCP bridge served by `server.js`. This bridge is still a V0 gap. It keeps the browser client connected to `world-loom-server` without rewriting the renderer or broad client networking code.

## Run With World Loom Defaults

```sh
pnpm start:world-loom
```

Then open the dev URL printed by Rsbuild. The app should auto-connect to the local `world-loom-server` through the temporary bridge.

The default root URL uses `config.json` app params. The app retries entry after async config load so local World Loom defaults can auto-connect without adding query parameters by hand.

## V0 Smoke Tests

Use distinct usernames when opening more than one browser client against the same local server. The stack-level smoke scripts do this automatically:

```sh
../scripts/smoke-m4-dual-client.sh
../scripts/smoke-m5-persistence.sh
../scripts/smoke-m6-mcp.sh
```

V0 keeps using the existing client debug/status surfaces. Server tick timing, connected player count, and ping status are sent by `world-loom-server` through the tab list/action bar, while the browser client shows connection ping in `NetworkStatus` and client FPS in the existing debug overlay when the renderer exposes FPS data.

## Temporary Bridge Replacement Plan

The V0 target remains server-backed gameplay, but browser traffic still passes through the temporary local bridge. The V1 target architecture is still:

```text
browser client -> WSS endpoint -> world-loom-server
```

Replace the bridge by moving the browser-facing WebSocket/WSS endpoint into `world-loom-server` or an adjacent Rust-owned transport layer, then remove the default `proxy: :18080` dependency from this client config.

## Scope Guard

V0 does not rewrite rendering, controls, inventory UI, or Valence core.
