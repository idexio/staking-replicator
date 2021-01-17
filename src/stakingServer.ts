import * as idex from '@idexio/idex-sdk';
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

export default class StakingServer {
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

  private readonly publicClient: idex.RestPublicClient;

  private readonly port: number;

  private readonly server: http.Server;

  private webSocketClient: idex.WebSocketClient;

  private readonly webSocketSubscriptions = new Set<string>();

  private readonly webSocketTimeouts = new Map<string, NodeJS.Timeout>();

  constructor(port: number, sandbox = false) {
    this.publicClient = new idex.RestPublicClient({
      sandbox,
    });
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
    this.webSocketClient = new idex.WebSocketClient({
      sandbox,
      shouldReconnectAutomatically: true,
    });
    this.webSocketClient.onConnect(() => {
      this.webSocketClient.onResponse((response: idex.WebSocketResponse) => {
        if (response.type === 'l2orderbook') {
          return this.handleL2OrderBookMessage(response.data);
        }
      });
    });
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
    this.webSocketClient.disconnect();
  }

  // load an order book that will overlap with queued L2 updates
  // should only run once at a time
  private async loadOrderBookWithMinimumSequence(
    market: string,
    sequence: number,
  ): Promise<void> {
    if (this.marketIsLoading.has(market)) {
      return;
    }
    this.marketIsLoading.add(market);
    let book = await this.publicClient.getOrderBookLevel2(market, 1000);
    while (book.sequence < sequence) {
      await new Promise((resolve) => setTimeout(resolve, 1000)); // eslint-disable-line
      book = await this.publicClient.getOrderBookLevel2(market, 1000); // eslint-disable-line
    }
    this.l2OrderBooks.set(market, book);
    this.applyOrderBookUpdates(market, book);
    this.marketIsLoading.delete(market);
  }

  // apply L2 updates and update the L1 as well
  private applyOrderBookUpdates(
    market: string,
    book: idex.RestResponseOrderBookLevel2,
  ): void {
    const updates = this.l2OrderBookUpdates.get(market);
    if (!updates) {
      return;
    }
    for (const update of updates) {
      if (book.sequence === update.sequence - 1) {
        updateL2Levels(book, update);
      }
    }
    this.l1OrderBooks.set(market, getL1BookFromL2Book(book));
    this.l2OrderBookUpdates.set(market, []);
  }

  // queue the L2 updates
  // if order book doesn't exist, start loading it from REST API
  // if order book does exist, then go ahead and apply the updates
  private async handleL2OrderBookMessage(
    message: idex.WebSocketResponseL2OrderBookLong,
  ): Promise<void> {
    // after we unsubscribe, in-flight messages may still arrive
    if (!this.webSocketSubscriptions.has(message.market)) {
      return;
    }
    const updatesToApply = this.l2OrderBookUpdates.get(message.market) || [];
    updatesToApply.push(message);
    this.l2OrderBookUpdates.set(message.market, updatesToApply);

    const l2Book = this.l2OrderBooks.get(message.market);
    if (!l2Book) {
      if (!this.marketIsLoading.has(message.market)) {
        this.loadOrderBookWithMinimumSequence(
          message.market,
          updatesToApply[0].sequence,
        );
      }
      return;
    }
    this.applyOrderBookUpdates(message.market, l2Book);
  }

  private async processApiRequest(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<void> {
    if (!this.webSocketClient.isConnected) {
      await this.webSocketClient.connect(true);
    }
    const parsedUrl = url.parse(request.url || '', true);
    const path = parsedUrl.pathname?.toLowerCase() || '/';
    try {
      switch (path) {
        case '/health':
          return StakingServer.sendJsonResponse(
            request,
            response,
            JSON.stringify({}),
          );
        case '/v1/orderbook':
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
                  await this.getOrderBookL1(parsedUrl.query.market),
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
                const l2 = await this.getOrderBookL2(parsedUrl.query.market);
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
                  await this.getOrderBookL1(parsedUrl.query.market),
                ),
              );
          }
        default:
          response.statusCode = 200;
          response.end(
            'IDEX Replicator\n\nIt works!\n\nYou successfully connected to this replicator, but did not make a valid API request.\n\nReplicator supports the Get Order Books endpoint (https://docs.idex.io/#get-order-books). For example, try /v1/orderbook?market=IDEX-ETH&level=2.',
          );
      }
    } catch (e) {
      if (e instanceof Error) {
        return StakingServer.sendHttpError(request, response, e.message, 500);
      }
    }
  }

  private refreshWebSocketSubscription(
    subscription:
      | idex.WebSocketRequestL1OrderBookSubscription
      | idex.WebSocketRequestL2OrderBookSubscription,
  ): void {
    console.log(`Refresh WS subscription to ${subscription.markets[0]}`);
    const market = subscription.markets[0];
    if (!this.webSocketSubscriptions.has(market)) {
      this.webSocketClient.subscribe([subscription]);
      this.webSocketSubscriptions.add(market);
    }
    const existingTimeout = this.webSocketTimeouts.get(market);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }
    this.webSocketTimeouts.set(
      market,
      setTimeout(() => {
        this.webSocketClient.unsubscribe([subscription]);
        this.webSocketSubscriptions.delete(market);
        this.l1OrderBooks.delete(market);
        this.l2OrderBooks.delete(market);
        console.log(`Subscription timeout for ${market}`);
      }, config.webSocket.idleTimeout),
    );
  }

  // return the L1 order book for market
  // if we don't have it yet, return the public API value immediately and start loading
  private async getOrderBookL1(
    market: string,
  ): Promise<idex.RestResponseOrderBookLevel1> {
    let orderBook = this.l1OrderBooks.get(market);
    if (!orderBook) {
      orderBook = await this.publicClient.getOrderBookLevel1(market);
      this.refreshWebSocketSubscription({
        name: 'l2orderbook',
        markets: [market],
      });
    }
    return orderBook;
  }

  // return the L2 order book for market
  // if we don't have it yet, return the public API value immediately and start loading
  private async getOrderBookL2(
    market: string,
  ): Promise<idex.RestResponseOrderBookLevel2> {
    let orderBook = this.l2OrderBooks.get(market);
    if (!orderBook) {
      orderBook = await this.publicClient.getOrderBookLevel2(market, 1000);
      this.refreshWebSocketSubscription({
        name: 'l2orderbook',
        markets: [market],
      });
    }
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
          console.error('An error occurred send gzip response:', err);
        }
      });
      return;
    }

    response.writeHead(statusCode, { 'Content-Type': 'application/json' });
    response.end(payload);
  }
}
