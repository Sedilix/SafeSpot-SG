import { RoadGraph } from '../../src/routing/graph';
import { Router } from '../../src/routing/router';
import { SpeedProfileEngine } from '../../src/routing/speedProfiles';
import { IncidentLayer } from '../../src/routing/incidents';
import { ErpEngine } from '../../src/routing/erp';

const memBefore = process.memoryUsage();
const t0 = performance.now();
const g = RoadGraph.loadDefault();
const r = new Router(g);
const sp = new SpeedProfileEngine();
const inc = new IncidentLayer();
const erp = new ErpEngine();
const t1 = performance.now();
const memAfter = process.memoryUsage();

console.log('Load time:', (t1 - t0).toFixed(1), 'ms');
console.log('Heap used delta:', ((memAfter.heapUsed - memBefore.heapUsed) / 1e6).toFixed(1), 'MB');
console.log('Total RSS:', (memAfter.rss / 1e6).toFixed(1), 'MB');
console.log('Total Heap Used:', (memAfter.heapUsed / 1e6).toFixed(1), 'MB');
