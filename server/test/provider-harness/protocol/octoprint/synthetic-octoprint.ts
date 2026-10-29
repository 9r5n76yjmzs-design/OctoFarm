/**
 * Local-only synthetic OctoPrint HTTP server driven by deterministic fixtures; no printer network involved.
 * @module
 */
const http = require('node:http');

type Scheduler = { schedule(delayMs: number, callback: () => void): number };
type Route = {
  method: string;
  path: string;
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  malformedBody?: string;
  delayMs?: number;
  action?: 'respond' | 'disconnect';
};
type Scenario = {
  fixtureId: string;
  mode: 'LEGACY' | 'V2_COMPAT' | 'V2_NATIVE';
  routes: Route[];
};
type CapturedRequest = {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
};

/**
 * Serves fixture HTTP routes on loopback and records requests for assertions.
 */
class SyntheticOctoPrint {
  private scenario: Scenario;
  private scheduler?: Scheduler;
  private server: any = null;
  private endpointValue: string | null = null;
  private requests: CapturedRequest[] = [];

  /**
   * Configures the synthetic API scenario and optional fake scheduler.
   * @param scenario - Validated fixture route set.
   * @param options - Optional test scheduler.
   */
  constructor(scenario: Scenario, options: { scheduler?: Scheduler } = {}) {
    this.scenario = scenario;
    this.scheduler = options.scheduler;
  }

  /**
   * Gets the loopback URL after startup.
   * @returns Local endpoint.
   * @throws Error before start or after stop.
   */
  endpoint(): string {
    if (!this.endpointValue) throw new Error('SyntheticOctoPrint is not started');
    return this.endpointValue;
  }

  /**
   * Reads configured OctoPrint protocol mode.
   * @returns Scenario mode.
   */
  mode(): string { return this.scenario.mode; }
  /**
   * Reads source fixture identifier.
   * @returns Fixture ID.
   */
  fixtureId(): string { return this.scenario.fixtureId; }
  /**
   * Returns copies of observed HTTP request metadata.
   * @returns Read-only request list.
   */
  capturedRequests(): readonly CapturedRequest[] {
    return this.requests.map((request) => ({ ...request, headers: { ...request.headers } }));
  }
  /**
   * Resets captured requests.
   * @returns Nothing.
   */
  clearCapturedRequests(): void { this.requests = []; }

  /**
   * Starts an ephemeral listener on 127.0.0.1 and serves declared responses, delays and disconnects.
   * @returns Promise resolved when listening.
   * @throws Error on double-start or listener failure.
   */
  async start(): Promise<void> {
    if (this.server) throw new Error('SyntheticOctoPrint is already started');

    this.server = http.createServer(async (req: any, res: any) => {
      const body = await this.readBody(req);
      const requestPath = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
      const method = String(req.method ?? 'GET').toUpperCase();

      this.requests.push({
        method,
        path: requestPath,
        headers: { ...req.headers },
        body
      });

      const route = this.scenario.routes.find(
        (candidate) => candidate.method === method && candidate.path === requestPath
      );

      if (!route) {
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'fixture route not found' }));
        return;
      }

      const respond = () => {
        if (route.action === 'disconnect') {
          req.socket.destroy();
          return;
        }

        res.statusCode = route.status ?? 200;
        for (const [name, value] of Object.entries(route.headers ?? {})) {
          res.setHeader(name, value);
        }

        if (route.malformedBody !== undefined) {
          res.end(route.malformedBody);
          return;
        }

        if (!res.hasHeader('content-type')) {
          res.setHeader('content-type', 'application/json');
        }
        res.end(route.body === undefined ? '' : JSON.stringify(route.body));
      };

      const delay = route.delayMs ?? 0;
      if (delay > 0 && this.scheduler) this.scheduler.schedule(delay, respond);
      else if (delay > 0) setTimeout(respond, delay);
      else respond();
    });

    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => {
        const address = this.server.address();
        this.endpointValue = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  }

  /**
   * Stops HTTP listener and releases its ephemeral port; safe when already stopped.
   * @returns Promise resolved after close.
   * @throws Error if server close fails.
   */
  async stop(): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    this.endpointValue = null;
    await new Promise<void>((resolve, reject) =>
      server.close((error: Error | undefined) => error ? reject(error) : resolve())
    );
  }

  /**
   * Buffers a synthetic client request body for assertions.
   * @param req - Incoming Node HTTP request.
   * @returns UTF-8 body text.
   * @throws Error if the request stream fails.
   */
  private readBody(req: any): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }
}

module.exports = { SyntheticOctoPrint };
