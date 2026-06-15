const serverHost = process.env.WORLD_LOOM_CLIENT_SERVER || 'localhost:25565'
const proxyUrl = process.env.WORLD_LOOM_CLIENT_PROXY || ':18081'
const version = process.env.WORLD_LOOM_CLIENT_VERSION || '1.20.1'
const username = process.env.WORLD_LOOM_CLIENT_USERNAME || 'loom_family{0-9999}'
const serverName = process.env.WORLD_LOOM_CLIENT_SERVER_NAME || 'World Loom Family'
const connectText = process.env.WORLD_LOOM_CLIENT_CONNECT_TEXT || 'Connect to World Loom'
const description =
  process.env.WORLD_LOOM_CLIENT_DESCRIPTION ||
  'World Loom family server through the Rust browser bridge.'

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
