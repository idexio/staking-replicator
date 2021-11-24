/* eslint-disable no-param-reassign */

import * as idex from '@idexio/idex-sdk';
import config from './config';
import { version } from '../package.json';
import { KeepAlivePayload } from './types';

// this ain't right
function updateLevel2Side(
  isAscending: boolean,
  side: idex.RestResponseOrderBookPriceLevel[],
  updates: idex.RestResponseOrderBookPriceLevel[],
): idex.RestResponseOrderBookPriceLevel[] {
  let nextUpdate = updates.shift();
  if (!nextUpdate) {
    return side;
  }

  const isBefore = function isBefore(
    a: idex.RestResponseOrderBookPriceLevel,
    b: idex.RestResponseOrderBookPriceLevel,
  ): boolean {
    if (isAscending && a[0] < b[0]) {
      return true;
    }
    if (!isAscending && a[0] > b[0]) {
      return true;
    }
    return false;
  };

  const newLevels: idex.RestResponseOrderBookPriceLevel[] = [];

  side.forEach((level: idex.RestResponseOrderBookPriceLevel) => {
    // add all new updates before the existing level
    while (nextUpdate && isBefore(nextUpdate, level)) {
      newLevels.push(nextUpdate);
      nextUpdate = updates.shift();
    }

    // add either the next update (if overwriting), or the next level
    if (nextUpdate && level[0] === nextUpdate[0]) {
      if (parseFloat(nextUpdate[1]) > 0) {
        newLevels.push(nextUpdate);
      }
      nextUpdate = updates.shift();
    } else {
      newLevels.push(level);
    }
  });

  // add all updates that go beyond the end
  while (nextUpdate) {
    newLevels.push(nextUpdate);
    nextUpdate = updates.shift();
  }

  return newLevels;
}

export const updateL2Levels = function updateL2Levels(
  book: idex.RestResponseOrderBookLevel2,
  updatedLevels: idex.RestResponseOrderBookLevel2,
): void {
  book.asks = updateLevel2Side(true, book.asks, updatedLevels.asks);
  book.bids = updateLevel2Side(false, book.bids, updatedLevels.bids);
  book.sequence = updatedLevels.sequence;
};

export const getL1BookFromL2Book = function getL1BookFromL2Book(
  l2: idex.RestResponseOrderBookLevel2,
): idex.RestResponseOrderBookLevel1 {
  return {
    asks: l2.asks.length ? [l2.asks[0]] : [],
    bids: l2.bids.length ? [l2.bids[0]] : [],
    sequence: l2.sequence,
    pool: l2.pool,
  };
};

export const getKeepAlivePayload = function getKeepAlivePayload(): KeepAlivePayload {
  return {
    apiKey: config.apiKey,
    version,
    clientPort: config.server.port,
  };
};
