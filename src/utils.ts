/* eslint-disable no-param-reassign */

import config from './config';
import { version } from '../package.json';
import { KeepAlivePayload } from './types';

export const getKeepAlivePayload = function getKeepAlivePayload(): KeepAlivePayload {
  return {
    apiKey: config.apiKey,
    version,
    clientPort: config.server.port,
  };
};
