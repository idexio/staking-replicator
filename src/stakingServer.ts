import * as idex from '@idexio/idex-sdk';
import { OrderBookRealTimeClient } from '@idexio/idex-sdk';
import { AxiosError } from 'axios';
import http from 'http';
import { pipeline, Readable } from 'stream';
import url from 'url';
import zlib from 'zlib';
import { logger } from './logger';

function handleAxiosResponse(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  e: any,
): void {
  if (isAxiosError(e) && e.response) {
    if (e.response?.data && e.response?.status) {
      return StakingServer.sendJsonResponse(
        request,
        response,
        JSON.stringify(e.response.data),
        e.response.status,
      );
    }
  }
  throw e;
}

function isAxiosError(error: any): error is AxiosError {
  return (error as AxiosError).isAxiosError !== undefined;
}

function logApiRequest(
  ip: string,
  path: string,
  status: number,
  bytes: number,
): void {
  const msg = `${new Date().toUTCString()} ${ip} ${path} ${status} ${bytes}\n`;
  logger.access(msg);
}

const legacyPath = '/v1/orderbook';
const marketRegEx = new RegExp('^[a-zA-Z0-9]{1,10}[-][a-zA-Z0-9]{1,10}$', 'i');

function orderBookClientKey(
  chain: idex.MultiverseChain,
  market: string,
): string {
  return `${chain}::${market}`;
}

export default class StakingServer {
  private chains: idex.MultiverseChain[];

  private readonly port: number;

  private readonly orderBookClient: Record<
    string,
    idex.OrderBookRealTimeClient
  > = {};

  private readonly sandbox: boolean;

  private readonly server: http.Server;

  private readonly timeouts: Record<string, NodeJS.Timeout> = {};

  constructor(port: number, sandbox = false) {
    this.chains = Object.keys(
      sandbox ? idex.URLS.sandbox : idex.URLS.production,
    ) as idex.MultiverseChain[];
    this.port = port;
    this.sandbox = sandbox;
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

  private extendOrCreateClientTimeout(
    chain: idex.MultiverseChain,
    market: string,
  ): idex.OrderBookRealTimeClient {
    const key = orderBookClientKey(chain, market);
    const client = this.orderBookClient[key];
    if (!client) {
      throw new Error('Unexpected missing order book client for timeout');
    }
    const existingTimeout = this.timeouts[key];
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }
    this.timeouts[key] = setTimeout(() => {
      client.stop();
      delete this.orderBookClient[key];
    }, 60000);
    return client;
  }

  private async loadOrCreateOrderBookClient(
    chain: idex.MultiverseChain,
    market: string,
  ): Promise<idex.OrderBookRealTimeClient> {
    const key = orderBookClientKey(chain, market);
    let client = this.orderBookClient[key];
    if (!client) {
      client = new OrderBookRealTimeClient({
        multiverseChain: chain,
        sandbox: this.sandbox,
      });
      await client.start([market]);
      this.orderBookClient[key] = client;
    }
    return client;
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
    for (const client of Object.values(this.orderBookClient)) {
      client.stop();
    }
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

    const orderBookRegEx = new RegExp(
      `${legacyPath}|/(${this.chains.join('|')})/v1/orderbook`,
      'i',
    );

    // only valid orderbook paths
    if (orderBookRegEx.test(path) !== true) {
      return StakingServer.sendHttpError(request, response, 'Not Found', 404);
    }

    // only valid market pairs
    const { market } = parsedUrl.query;
    if (typeof market !== 'string' || marketRegEx.test(market) !== true) {
      return StakingServer.sendHttpError(
        request,
        response,
        'Invalid Market Pair',
        400,
      );
    }

    // only valid chains
    const chain: idex.MultiverseChain =
      path === legacyPath
        ? 'matic'
        : (path.split('/')[1]?.toLowerCase() as idex.MultiverseChain);

    if (!this.chains.includes(chain)) {
      return StakingServer.sendHttpError(
        request,
        response,
        'Invalid Chain',
        400,
      );
    }

    // only l1 or l2
    const level = parsedUrl.query.level || '1';
    if (level !== '1' && level !== '2') {
      return StakingServer.sendHttpError(
        request,
        response,
        'Invalid Orderbook Level',
        400,
      );
    }

    try {
      const client = await this.loadOrCreateOrderBookClient(chain, market);
      this.extendOrCreateClientTimeout(chain, market);
      switch (level) {
        case '1':
          try {
            return StakingServer.sendJsonResponse(
              request,
              response,
              JSON.stringify(await client.getOrderBookL1(market)),
            );
          } catch (e) {
            return handleAxiosResponse(request, response, e);
          }
        case '2': {
          try {
            let limit = 50;
            if (typeof parsedUrl.query.limit === 'string') {
              const newLimit = parseInt(parsedUrl.query.limit, 10);
              if (newLimit > 0 && newLimit <= Number.MAX_SAFE_INTEGER) {
                limit = newLimit;
              }
            }
            const l2 = await client.getOrderBookL2(market);
            // between 1 and 500 levels per side
            const limitPerSide = Math.min(
              500,
              Math.max(1, Math.floor(limit / 2)),
            );
            return StakingServer.sendJsonResponse(
              request,
              response,
              JSON.stringify({
                ...l2,
                asks: l2.asks.slice(0, limitPerSide),
                bids: l2.bids.slice(0, limitPerSide),
              }),
            );
          } catch (e) {
            return handleAxiosResponse(request, response, e);
          }
        }
        default:
          return StakingServer.sendHttpError(
            request,
            response,
            'Bad Request',
            400,
          );
      }
    } catch (e) {
      if (e instanceof Error) {
        return StakingServer.sendHttpError(request, response, e.message, 500);
      }
    }
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
