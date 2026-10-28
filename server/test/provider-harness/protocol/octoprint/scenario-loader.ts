const fs = require('node:fs');
const { validateFixture } = require('../../core/fixture-loader.ts');

type OctoPrintMode = 'LEGACY' | 'V2_COMPAT' | 'V2_NATIVE';
type RouteAction = 'respond' | 'disconnect';

type OctoPrintRoute = {
  method: string;
  path: string;
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  malformedBody?: string;
  delayMs?: number;
  action?: RouteAction;
};

type OctoPrintScenario = {
  fixtureId: string;
  mode: OctoPrintMode;
  routes: OctoPrintRoute[];
};

function assertScenario(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid OctoPrint scenario: ${message}`);
}

function loadOctoPrintScenario(fixturePath: string): OctoPrintScenario {
  const fixture = validateFixture(JSON.parse(fs.readFileSync(fixturePath, 'utf8')), fixturePath);
  const octoprint = fixture.input.octoprint as Record<string, unknown> | undefined;
  assertScenario(octoprint && typeof octoprint === 'object', 'input.octoprint is required');
  assertScenario(['LEGACY', 'V2_COMPAT', 'V2_NATIVE'].includes(String(octoprint.mode)), 'unsupported mode');
  assertScenario(Array.isArray(octoprint.routes), 'routes must be an array');

  const routes = octoprint.routes.map((raw: unknown, index: number) => {
    assertScenario(raw && typeof raw === 'object' && !Array.isArray(raw), `route ${index} must be an object`);
    const route = raw as Record<string, unknown>;
    assertScenario(typeof route.method === 'string' && route.method.length > 0, `route ${index} method is required`);
    assertScenario(typeof route.path === 'string' && route.path.startsWith('/'), `route ${index} path must start with /`);
    if (route.delayMs !== undefined) assertScenario(Number.isFinite(route.delayMs) && Number(route.delayMs) >= 0, `route ${index} delayMs must be non-negative`);
    if (route.action !== undefined) assertScenario(['respond', 'disconnect'].includes(String(route.action)), `route ${index} action is invalid`);
    return {
      method: route.method.toUpperCase(),
      path: route.path,
      status: route.status === undefined ? 200 : Number(route.status),
      headers: (route.headers ?? {}) as Record<string, string>,
      body: route.body,
      malformedBody: route.malformedBody as string | undefined,
      delayMs: route.delayMs === undefined ? 0 : Number(route.delayMs),
      action: (route.action ?? 'respond') as RouteAction
    };
  });

  return { fixtureId: fixture.id, mode: octoprint.mode as OctoPrintMode, routes };
}

module.exports = { loadOctoPrintScenario };
