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

class SyntheticOctoPrint {
  private scenario: Scenario;
  private scheduler?: Scheduler;
  private server: any = null;
  private endpointValue: string | null = null;
  private requests: CapturedRequest[] = [];

  constructor(scenario: Scenario, options: { scheduler?: Scheduler } = {}) {
    this.scenario = scenario;
    this.scheduler = options.scheduler;
  }

  endpoint(): string {
    if (!this.endpointValue) throw new Error('SyntheticOctoPrint is not started');
    return this.endpointValue;
  }

  mode(): string { return this.scenario.mode; }
  fixtureId(): string { return this.scenario.fixtureId; }
  capturedRequests(): readonly CapturedRequest[] {
    return this.requests.map((request) => ({ ...request, headers: { ...request.headers } }));
  }
  clearCapturedRequests(): void { this.requests = []; }

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

  async stop(): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    this.endpointValue = null;
    await new Promise<void>((resolve, reject) =>
      server.close((error: Error | undefined) => error ? reject(error) : resolve())
    );
  }

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
