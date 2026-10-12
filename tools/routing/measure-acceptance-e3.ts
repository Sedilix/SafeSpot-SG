import { RoadGraph } from '../../src/routing/graph';
import { Router } from '../../src/routing/router';
import { SpeedProfileEngine } from '../../src/routing/speedProfiles';
import { IncidentLayer } from '../../src/routing/incidents';
import { ErpEngine } from '../../src/routing/erp';
import { findPickupOptions } from '../../src/utils/pickupService';

async function main() {
  console.log('--- 1. Testing Router.findRoutesToMany for 14 candidates ---');
  const graph = RoadGraph.loadDefault();
  const router = new Router(graph);
  const speedProfiles = new SpeedProfileEngine();
  const incidents = new IncidentLayer();
  const erp = new ErpEngine();

  const origin = { lat: 1.3327, lng: 103.8479 }; // Toa Payoh
  // 14 candidate points scattered around 1-3 km
  const targets = Array.from({ length: 14 }, (_, i) => ({
    id: `cand-${i + 1}`,
    lat: 1.3327 + (Math.sin(i * 0.5) * 0.015),
    lng: 103.8479 + (Math.cos(i * 0.5) * 0.015),
  }));

  const t0 = performance.now();
  const routes = router.findRoutesToMany(origin, targets, {
    departureTime: new Date(),
    speedProfiles,
    incidents,
    erp,
  });
  const t1 = performance.now();
  const searchDurationMs = Math.round(t1 - t0);

  console.log(`findRoutesToMany settled ${routes.size} targets in ${searchDurationMs} ms (Target < 1000 ms: ${searchDurationMs < 1000 ? 'PASS' : 'FAIL'}).`);

  console.log('\n--- 2. Testing /api/pickup/options latency with shadow-off vs shadow-on ---');
  // Measure shadow-off
  delete process.env.ROUTING_SHADOW_DRIVE;
  process.env.ROUTING_ENGINE_DRIVE = 'google';

  // Warmup
  await findPickupOptions({
    senior: origin,
    driver: { lat: 1.3300, lng: 103.8450 },
    customRoadRouter: router,
  });

  const runs = 5;
  let shadowOffTotal = 0;
  for (let i = 0; i < runs; i++) {
    const s0 = performance.now();
    await findPickupOptions({
      senior: origin,
      driver: { lat: 1.3300, lng: 103.8450 },
      customRoadRouter: router,
    });
    shadowOffTotal += (performance.now() - s0);
  }
  const shadowOffAvg = Number((shadowOffTotal / runs).toFixed(1));

  // Measure shadow-on
  process.env.ROUTING_SHADOW_DRIVE = '1';
  let shadowOnTotal = 0;
  for (let i = 0; i < runs; i++) {
    const s0 = performance.now();
    await findPickupOptions({
      senior: origin,
      driver: { lat: 1.3300, lng: 103.8450 },
      customRoadRouter: router,
    });
    shadowOnTotal += (performance.now() - s0);
  }
  const shadowOnAvg = Number((shadowOnTotal / runs).toFixed(1));

  const deltaMs = Number(Math.abs(shadowOnAvg - shadowOffAvg).toFixed(1));
  console.log(`Shadow OFF avg response time: ${shadowOffAvg} ms`);
  console.log(`Shadow ON avg response time:  ${shadowOnAvg} ms`);
  console.log(`Response time delta:          ${deltaMs} ms (Target <= 50 ms: ${deltaMs <= 50 ? 'PASS' : 'FAIL'})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
