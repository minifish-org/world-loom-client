const readEnv = name => {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

const serverHost = readEnv('WORLD_LOOM_CLIENT_SERVER') || 'localhost:25565'
const envProxyUrl = readEnv('WORLD_LOOM_CLIENT_PROXY')
const proxyUrl = envProxyUrl || ':18081'
const version = readEnv('WORLD_LOOM_CLIENT_VERSION') || '1.20.1'
const username = readEnv('WORLD_LOOM_CLIENT_USERNAME') || 'loom_family{0-9999}'
const serverName = readEnv('WORLD_LOOM_CLIENT_SERVER_NAME') || 'World Loom Family'
const connectText = readEnv('WORLD_LOOM_CLIENT_CONNECT_TEXT') || 'Connect to World Loom'
const description =
  readEnv('WORLD_LOOM_CLIENT_DESCRIPTION') ||
  'World Loom family server through the Rust browser bridge.'

if (process.env.CF_PAGES === '1' && !envProxyUrl) {
  console.error(
    '[world-loom-pages-config] WORLD_LOOM_CLIENT_PROXY is required for Cloudflare Pages builds. ' +
      'Set it in the Production environment variables and redeploy.',
  )
  process.exit(1)
}

console.error(
  `[world-loom-pages-config] server=${serverHost} proxy=${proxyUrl} source=${envProxyUrl ? 'WORLD_LOOM_CLIENT_PROXY' : 'default'}`,
)

const config = {
  defaultHost: serverHost,
  defaultProxy: proxyUrl,
  allowAutoConnect: true,
  appParams: {
    ip: serverHost,
    version,
    proxy: proxyUrl,
    username,
    autoConnect: 'true',
    onlyConnect: 'true',
    connectText,
    worldLoomProtocolCompat: 'true',
  },
  promoteServers: [
    {
      ip: serverHost,
      name: serverName,
      version,
      description,
      proxyOverride: proxyUrl,
    },
  ],
  rightSideText: serverName,
  splashText: `Connecting to ${serverName}`,
  splashTextFallback: 'World Loom Online',
  defaultUsername: username,
}

process.stdout.write(JSON.stringify(config))
