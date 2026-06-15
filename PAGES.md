# World Loom Cloudflare Pages

This client can be deployed as a static Cloudflare Pages site. Pages serves the browser files only; it does not proxy Minecraft traffic and does not need a Worker.

## Pages Git Integration

Connect the `world-loom-client` repository to Cloudflare Pages.

Use these build settings:

```text
Framework preset: None
Build command: pnpm build:world-loom:pages
Build output directory: dist
Root directory: /
Node version: 22
Package manager: pnpm 10.32.1
```

`wrangler.jsonc` records the same output directory for local Wrangler usage, but the preferred V1.2 path is Pages Git integration.

## Production Environment Variables

Set these in the Pages project under Settings -> Environment variables.

```text
WORLD_LOOM_CLIENT_SERVER=localhost:25565
WORLD_LOOM_CLIENT_PROXY=https://<machine>.<tailnet>.ts.net
WORLD_LOOM_CLIENT_USERNAME=loom_family{0-9999}
WORLD_LOOM_CLIENT_SERVER_NAME=World Loom Family
```

`WORLD_LOOM_CLIENT_SERVER=localhost:25565` is intentional when the Rust bridge runs on the same Tailscale host as the Valence server. The browser sends that target to the bridge, and the bridge connects to its own local game server.

Use a full HTTPS URL for `WORLD_LOOM_CLIENT_PROXY` on Pages. A Pages site is HTTPS, so an insecure `http://` or `ws://` proxy will be blocked by browsers as mixed content. The Rust server still speaks local HTTP/WebSocket; Caddy or Tailscale HTTPS terminates TLS in front of it.

Chrome 142+ also treats Tailscale addresses as local/private network targets when the page is served from public Pages. The client uses `fetch(..., { targetAddressSpace: "local" })` for the proxy connect request so Chrome can show its Local Network Access permission prompt. Family players may need to allow local network access for the Pages site the first time they connect.

Optional overrides:

```text
WORLD_LOOM_CLIENT_VERSION=1.20.1
WORLD_LOOM_CLIENT_CONNECT_TEXT=Connect to World Loom
WORLD_LOOM_CLIENT_DESCRIPTION=World Loom family server through the Rust browser bridge.
```

Advanced fallback: `CONFIG_JSON` is still supported by `rsbuild.config.ts`, but `pnpm build:world-loom:pages` is the normal V1.2 path because it turns the simple `WORLD_LOOM_CLIENT_*` variables above into `dist/config.json`.

## Local Static Build Check

```sh
pnpm install --frozen-lockfile
pnpm build:world-loom:pages
```

For a local build pointed at a real Tailscale host:

```sh
WORLD_LOOM_CLIENT_SERVER=localhost:25565 \
WORLD_LOOM_CLIENT_PROXY=https://<machine>.<tailnet>.ts.net \
pnpm build:world-loom:pages
```

## Browser URL

After Pages deploys, family players open:

```text
https://<project>.pages.dev/
```

or the custom domain attached to the Pages project. Their device must be joined to the same tailnet so the browser can resolve and reach `<machine>.<tailnet>.ts.net`.

## Server And MCP URLs

- Browser client URL: `https://<project>.pages.dev/`
- Browser bridge URL: `https://<machine>.<tailnet>.ts.net/api/vm/net`
- Game server target from bridge: `localhost:25565`
- MCP URL: `http://127.0.0.1:8765/mcp` on the server host only by default

Do not put private tailnet names, tokens, certificates, SQLite files, logs, or MCP secrets into git. The placeholders above are examples only.
