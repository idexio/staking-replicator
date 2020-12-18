const { env } = process;

export default Object.freeze({
  apiKey: env.API_KEY || '',
  client: {
    keepAliveTimeout: parseInt(env.KEEP_ALIVE_INTERVAL || '30000', 10),
  },
  idex: {
    stakingCoordinatorUrl: env.STAKING_COORDINATOR_URL || 'https://sc.idex.io',
  },
  logging: {
    accessLogPath: env.IDEX_STAKING_ACCESS_LOG_PATH || '',
    activityLogPath: env.IDEX_STAKING_ACTIVITY_LOG_PATH || '',
    errorLogPath: env.IDEX_STAKING_ERROR_LOG_PATH || '',
  },
  server: {
    port: parseInt(env.IDEX_STAKING_SERVER_PORT || '8081', 10),
    trueClientIp: env.TRUE_CLIENT_IP || '',
  },
  webSocket: {
    host: env.IDEX_WEBSOCKET_API_URL || 'wss://websocket.idex.io/v1',
    idleTimeout: parseInt(env.IDEX_WEBSOCKET_MAX_IDLE || '60000', 10),
  },
});
