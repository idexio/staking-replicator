/* eslint-disable no-param-reassign */

import * as idex from '@idexio/idex-sdk';
import config from './config';
import { version } from '../package.json';
import { KeepAlivePayload } from './types';

function updateLevel2Side(
  side: idex.RestResponseOrderBookPriceLevel[],
  updates: idex.RestResponseOrderBookPriceLevel[],
): idex.RestResponseOrderBookPriceLevel[] {
  let nextUpdate = updates.shift();
  if (!nextUpdate) {
    return side;
  }
  side.forEach((level: idex.RestResponseOrderBookPriceLevel, index: number) => {
    if (!nextUpdate) {
      return;
    }
    if (level[0] === nextUpdate[0]) {
      side[index] = nextUpdate;
      nextUpdate = updates.shift();
    }
  });
  return side.filter((ask) => parseFloat(ask[1]) > 0);
}

export const updateL2Levels = function updateL2Levels(
  book: idex.RestResponseOrderBookLevel2,
  updatedLevels: idex.RestResponseOrderBookLevel2,
): void {
  book.asks = updateLevel2Side(book.asks, updatedLevels.asks);
  book.bids = updateLevel2Side(book.bids, updatedLevels.bids);
  book.sequence = updatedLevels.sequence;
};

export const getL1BookFromL2Book = function getL1BookFromL2Book(
  l2: idex.RestResponseOrderBookLevel2,
): idex.RestResponseOrderBookLevel1 {
  return {
    asks: l2.asks.length ? [l2.asks[0]] : [],
    bids: l2.bids.length ? [l2.bids[0]] : [],
    sequence: l2.sequence,
  };
};

export const getKeepAlivePayload = function getKeepAlivePayload(): KeepAlivePayload {
  return {
    apiKey: config.apiKey,
    version,
    clientPort: config.server.port,
  };
};
