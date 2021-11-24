import * as idex from '@idexio/idex-sdk';
import { RestPublicClient } from '@idexio/idex-sdk';
import fs from 'fs';
import http from 'http';
import { pipeline, Readable } from 'stream';
import url from 'url';
import zlib from 'zlib';
import config from './config';
import { logger } from './logger';
import { getL1BookFromL2Book, updateL2Levels } from './utils';

const logStream = config.logging.accessLogPath
  ? fs.createWriteStream(config.logging.accessLogPath, { flags: 'a' })
  : null;

function logApiRequest(
  ip: string,
  path: string,
  status: number,
  bytes: number,
): void {
  if (logStream) {
    const msg = `${new Date().toUTCString()} ${ip} ${path} ${status} ${bytes}\n`;
    logStream.write(msg);
  }
}

function getOrderBookKey(
  chain: idex.types.enums.MultiverseChain,
  market: string,
): string {
  return `${chain}.${market}`;
}

export default class StakingServer {
  private chains: idex.types.enums.MultiverseChain[];

  private readonly l1OrderBooks: Map<
    string,
    idex.RestResponseOrderBookLevel1
  > = new Map();

  private readonly l2OrderBooks: Map<
    string,
    idex.RestResponseOrderBookLevel2
  > = new Map();

  private readonly l2OrderBookUpdates = new Map<
    string,
    idex.RestResponseOrderBookLevel2[]
  >();

  private readonly marketIsLoading = new Set<string>();

  private readonly publicClient: Partial<
    Record<idex.types.enums.MultiverseChain, RestPublicClient>
  > = {};

  private readonly port: number;

  private readonly server: http.Server;

  private webSocketClient: Partial<
    Record<idex.types.enums.MultiverseChain, idex.WebSocketClient>
  > = {};

  private readonly webSocketSubscriptions = new Set<string>();

  private readonly webSocketTimeouts = new Map<string, NodeJS.Timeout>();

  constructor(port: number, sandbox = false) {
    this.chains = Object.keys(
      sandbox ? idex.constants.URLS.sandbox : idex.constants.URLS.production,
    ) as idex.types.enums.MultiverseChain[];

    for (const multiverseChain of this.chains) {
      this.publicClient[multiverseChain] = new idex.RestPublicClient({
        multiverseChain,
        sandbox,
      });
      const wsClient = new idex.WebSocketClient({
        multiverseChain,
        sandbox,
        shouldReconnectAutomatically: true,
      });
      this.webSocketClient[multiverseChain] = wsClient;
      wsClient.onConnect(() => {
        wsClient.onResponse((response: idex.WebSocketResponse) => {
          if (response.type === 'l2orderbook') {
            return this.handleL2OrderBookMessage(
              multiverseChain,
              response.data,
            );
          }
        });
      });
    }

    this.port = port;
    this.server = http.createServer(
      (request: http.IncomingMessage, response: http.ServerResponse) => {
        if (request.method === 'GET') {
          return this.processApiRequest(request, response);
        }
        if (request.method === 'POST') {
          request.destroy();
        }
        StakingServer.sendHttpError(
          request,
          response,
          'Unsupported HTTP method POST',
          400,
        );
      },
    );
  }

  public async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        logger.info(`Listening on port ${this.port}`);
        resolve();
      });
    });
  }

  public stop(): void {
    this.server.close();
    for (const chain of this.chains) {
      this.webSocketClient[chain]?.disconnect();
    }
  }

  // load an order book that will overlap with queued L2 updates
  // should only run once at a time
  private async loadOrderBookWithMinimumSequence(
    chain: idex.types.enums.MultiverseChain,
    market: string,
    sequence: number,
  ): Promise<void> {
    if (this.marketIsLoading.has(market)) {
      return;
    }
    this.marketIsLoading.add(market);
    const client = this.publicClient[chain];
    if (!client) {
      throw new Error(`Unexpected missing public client for ${chain}`);
    }
    let book = await client.getOrderBookLevel2(market, 1000);
    while (book.sequence < sequence) {
      await new Promise((resolve) => setTimeout(resolve, 1000)); // eslint-disable-line
      book = await client.getOrderBookLevel2(market, 1000); // eslint-disable-line
    }
    const key = getOrderBookKey(chain, market);

    this.l2OrderBooks.set(key, book);
    this.applyOrderBookUpdates(chain, market, book);
    this.marketIsLoading.delete(key);
  }

  // apply L2 updates and update the L1 as well
  private applyOrderBookUpdates(
    chain: idex.types.enums.MultiverseChain,
    market: string,
    book: idex.RestResponseOrderBookLevel2,
  ): void {
    const key = getOrderBookKey(chain, market);

    const updates = this.l2OrderBookUpdates.get(key);
    if (!updates) {
      return;
    }
    for (const update of updates) {
      if (book.sequence === update.sequence - 1) {
        updateL2Levels(book, update);
      }
    }

    this.l1OrderBooks.set(key, getL1BookFromL2Book(book));
    this.l2OrderBookUpdates.set(key, []);
  }

  // queue the L2 updates
  // if order book doesn't exist, start loading it from REST API
  // if order book does exist, then go ahead and apply the updates
  private async handleL2OrderBookMessage(
    chain: idex.types.enums.MultiverseChain,
    message: idex.WebSocketResponseL2OrderBookLong,
  ): Promise<void> {
    const key = getOrderBookKey(chain, message.market);

    // after we unsubscribe, in-flight messages may still arrive
    if (!this.webSocketSubscriptions.has(key)) {
      return;
    }

    const updatesToApply = this.l2OrderBookUpdates.get(key) || [];
    updatesToApply.push(message);
    this.l2OrderBookUpdates.set(key, updatesToApply);

    const l2Book = this.l2OrderBooks.get(key);
    if (!l2Book) {
      if (!this.marketIsLoading.has(key)) {
        this.loadOrderBookWithMinimumSequence(
          chain,
          message.market,
          updatesToApply[0].sequence,
        );
      }
      return;
    }
    this.applyOrderBookUpdates(chain, message.market, l2Book);
    this.l2OrderBooks.set(key, l2Book);
  }

  private async processApiRequest(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<void> {
    const parsedUrl = url.parse(request.url || '', true);
    const path = parsedUrl.pathname?.toLowerCase() || '/';

    // health check
    if (path === '/health') {
      return StakingServer.sendJsonResponse(
        request,
        response,
        JSON.stringify({}),
      );
    }

    if (path === '/') {
      response.statusCode = 200;
      response.end(
        'IDEX Replicator\n\nIt works!\n\nYou successfully connected to this replicator, but did not make a valid API request.\n\nReplicator supports the Get Order Books endpoint (https://docs.idex.io/#get-order-books). For example, try /v1/orderbook?market=IDEX-ETH&level=2.',
      );
      return;
    }

    const legacyPath = '/v1/orderbook';

    const orderBookRegEx = new RegExp(
      `${legacyPath}|/v1/(${this.chains.join('|')})/orderbook`,
      'i',
    );

    // if not a valid orderbook path, we don't handle it
    if (orderBookRegEx.test(path) !== true) {
      return StakingServer.sendHttpError(request, response, 'Not Found', 404);
    }

    const chain: idex.types.enums.MultiverseChain =
      path === legacyPath
        ? 'matic'
        : (path.split('/')[2] as idex.types.enums.MultiverseChain);

    // order book
    try {
      const wsClient = this.webSocketClient[chain];

      if (!wsClient) {
        throw new Error(`Unexpected missing ws client for ${chain}`);
      }

      if (!wsClient.isConnected()) {
        await wsClient.connect(true);
      }

      if (typeof parsedUrl.query.market !== 'string') {
        return StakingServer.sendHttpError(
          request,
          response,
          'Bad Request',
          400,
        );
      }
      switch (parsedUrl.query.level) {
        case '1':
          return StakingServer.sendJsonResponse(
            request,
            response,
            JSON.stringify(
              await this.getOrderBookL1(chain, parsedUrl.query.market),
            ),
          );
        case '2': {
          let limit = 50;
          if (typeof parsedUrl.query.limit === 'string') {
            const newLimit = parseInt(parsedUrl.query.limit, 10);
            if (newLimit > 0 && newLimit <= Number.MAX_SAFE_INTEGER) {
              limit = newLimit;
            }
          }
          try {
            const l2 = await this.getOrderBookL2(chain, parsedUrl.query.market);
            return StakingServer.sendJsonResponse(
              request,
              response,
              JSON.stringify({
                asks: l2.asks.slice(0, limit),
                bids: l2.bids.slice(0, limit),
              }),
            );
          } catch (e) {
            if (e.response?.data && e.response?.status) {
              return StakingServer.sendJsonResponse(
                request,
                response,
                JSON.stringify(e.response.data),
                e.response.status,
              );
            }
            throw e;
          }
        }
        default:
          return StakingServer.sendJsonResponse(
            request,
            response,
            JSON.stringify(
              await this.getOrderBookL1(chain, parsedUrl.query.market),
            ),
          );
      }
    } catch (e) {
      if (e instanceof Error) {
        return StakingServer.sendHttpError(request, response, e.message, 500);
      }
    }
  }

  private async refreshWebSocketSubscription(
    chain: idex.types.enums.MultiverseChain,
    subscription:
      | idex.WebSocketRequestL1OrderBookSubscription
      | idex.WebSocketRequestL2OrderBookSubscription,
  ): Promise<void> {
    logger.info(`Refresh WS subscription to ${subscription.markets[0]}`);

    const wsClient = this.webSocketClient[chain];

    if (!wsClient) {
      throw new Error(`Unexpected missing ws client for ${chain}`);
    }

    if (!wsClient.isConnected()) {
      await wsClient.connect(true);
    }

    const market = subscription.markets[0];
    const key = getOrderBookKey(chain, market);

    if (!this.webSocketSubscriptions.has(key)) {
      wsClient.subscribe([subscription]);
      this.webSocketSubscriptions.add(key);
    }
    const existingTimeout = this.webSocketTimeouts.get(key);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }
    this.webSocketTimeouts.set(
      key,
      setTimeout(() => {
        if (wsClient.isConnected()) {
          wsClient.unsubscribe([subscription]);
        }
        this.webSocketSubscriptions.delete(key);
        this.l1OrderBooks.delete(key);
        this.l2OrderBooks.delete(key);
        logger.info(`Subscription timeout for ${market}`);
      }, config.webSocket.idleTimeout),
    );
  }

  // return the L1 order book for market
  // if we don't have it yet, return the public API value immediately and start loading
  private async getOrderBookL1(
    chain: idex.types.enums.MultiverseChain,
    market: string,
  ): Promise<idex.RestResponseOrderBookLevel1> {
    const client = this.publicClient[chain];
    if (!client) {
      throw new Error(`Unexpected missing public client for ${chain}`);
    }

    const key = getOrderBookKey(chain, market);
    let orderBook = this.l1OrderBooks.get(key);

    if (!orderBook) {
      orderBook = await client.getOrderBookLevel1(market);
    }
    this.refreshWebSocketSubscription(chain, {
      name: 'l2orderbook',
      markets: [market],
    });
    return orderBook;
  }

  // return the L2 order book for market
  // if we don't have it yet, return the public API value immediately and start loading
  private async getOrderBookL2(
    chain: idex.types.enums.MultiverseChain,
    market: string,
  ): Promise<idex.RestResponseOrderBookLevel2> {
    const client = this.publicClient[chain];
    if (!client) {
      throw new Error(`Unexpected missing public client for ${chain}`);
    }

    const key = getOrderBookKey(chain, market);
    let orderBook = this.l2OrderBooks.get(key);

    if (!orderBook) {
      orderBook = await client.getOrderBookLevel2(market, 1000);
    }
    this.refreshWebSocketSubscription(chain, {
      name: 'l2orderbook',
      markets: [market],
    });
    return orderBook;
  }

  public static sendHttpError(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    errorMessage: string,
    statusCode = 500,
  ): void {
    this.sendJsonResponse(
      request,
      response,
      JSON.stringify({ error: errorMessage }),
      statusCode,
    );
  }

  public static sendJsonResponse(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    payload: string,
    statusCode = 200,
  ): void {
    logApiRequest(
      request.socket.remoteAddress || 'unknown',
      request.url || '/',
      statusCode,
      payload.length,
    );

    const acceptEncoding = (request.headers['accept-encoding'] as string) || '';

    if (/\bgzip\b/.test(acceptEncoding)) {
      response.writeHead(statusCode, { 'Content-Encoding': 'gzip' });
      pipeline(Readable.from([payload]), zlib.createGzip(), response, (err) => {
        if (err) {
          response.end();
          logger.error('An error occurred send gzip response:', err);
        }
      });
      return;
    }

    response.writeHead(statusCode, { 'Content-Type': 'application/json' });
    response.end(payload);
  }
}
