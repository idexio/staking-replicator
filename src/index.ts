import axios from 'axios';
import * as Sentry from '@sentry/node';

import config from './config';
import { logger, trimLogs } from './logger';
import StakingServer from './stakingServer';
import * as utils from './utils';

Sentry.init({
  dsn:
    'https://bb760b6bd0f24f6ba4561a5e058ff633@o157426.ingest.sentry.io/5557206',
});

console.log('Starting IDEX client');
console.log(config);
console.log(utils.getKeepAlivePayload());

let isKeepAliveRunning = false;
const keepAlive = async function keepAlive(): Promise<void> {
  if (isKeepAliveRunning) {
    return;
  }
  isKeepAliveRunning = true;
  logger.info(`Sending Keep Alive @ ${new Date().toUTCString()}`);
  try {
    const url = `${config.idex.stakingCoordinatorUrl}/keepalive`;
    const payload = utils.getKeepAlivePayload();
    const headers = config.server.trueClientIp
      ? {
          'true-client-ip': config.server.trueClientIp,
        }
      : {};
    const stakingResponse = await axios.post(url, payload, {
      headers,
    });
    logger.info(`${stakingResponse.status} ${stakingResponse.statusText}`);
    if (stakingResponse.data) {
      logger.info(stakingResponse.data);
    }
  } catch (e) {
    if (e.response?.data) {
      logger.info(e.response.data);
    } else {
      logger.error(e);
    }
  } finally {
    await trimLogs();
  }
  isKeepAliveRunning = false;
};

const keepAliveInterval = setInterval(
  keepAlive,
  config.client.keepAliveTimeout,
);
const server = new StakingServer(config.server.port);
server.start().then(() => keepAlive());

process.on('SIGINT', () => {
  clearInterval(keepAliveInterval);
  server.stop();
  setTimeout(() => process.exit(0), 100);
});
