/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * driveWorker.ts: Background worker thread for non-blocking driver ETA computation.
 * Runs in worker_threads off the main event loop to avoid freezing Express/SOS events.
 */

import { parentPort, workerData } from 'worker_threads';
import { readFileSync, existsSync } from 'fs';
import { gunzipSync } from 'zlib';
import { RoadGraph, RoadGraphData } from './graph';
import { Router } from './router';
import { SpeedProfileEngine } from './speedProfiles';
import { IncidentLayer, TrafficIncident } from './incidents';
import { ErpEngine } from './erp';

let router: Router | null = null;
let speedProfiles: SpeedProfileEngine | null = null;
let incidents: IncidentLayer | null = null;
let erp: ErpEngine | null = null;

function loadGraphFromFile(graphPath: string): RoadGraph {
  if (!existsSync(graphPath)) {
    throw new Error(`Graph file not found: ${graphPath}`);
  }
  let jsonString: string;
  if (graphPath.endsWith('.gz')) {
    const compressed = readFileSync(graphPath);
    jsonString = gunzipSync(compressed).toString('utf8');
  } else {
    jsonString = readFileSync(graphPath, 'utf8');
  }
  const data: RoadGraphData = JSON.parse(jsonString);
  return new RoadGraph(data);
}

function initWorker(graphPath?: string) {
  try {
    const resolvedPath =
      graphPath ||
      process.env.ROUTING_GRAPH_PATH ||
      (existsSync('/tmp/singapore-road-graph.json') ? '/tmp/singapore-road-graph.json' : undefined) ||
      (existsSync('/tmp/singapore-road-graph.json.gz') ? '/tmp/singapore-road-graph.json.gz' : undefined) ||
      'data/graph/singapore-road-graph.json';

    const graph = loadGraphFromFile(resolvedPath);
    router = new Router(graph);
    speedProfiles = new SpeedProfileEngine();
    incidents = new IncidentLayer();
    erp = new ErpEngine();

    parentPort?.postMessage({
      type: 'ready',
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
    });
  } catch (err: any) {
    parentPort?.postMessage({
      type: 'init_error',
      message: err.message,
    });
  }
}

if (parentPort) {
  parentPort.on('message', (msg: any) => {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'init') {
      initWorker(msg.graphPath);
      return;
    }

    if (msg.type === 'update_incidents') {
      if (incidents && Array.isArray(msg.incidents)) {
        incidents.setIncidents(msg.incidents);
      }
      return;
    }

    if (msg.type === 'route_many') {
      const { id, origin, targets, departureTime, liveIncidents } = msg;
      if (!router) {
        parentPort?.postMessage({
          type: 'error',
          id,
          message: 'Router not initialized in worker',
        });
        return;
      }

      try {
        const t0 = performance.now();
        if (liveIncidents && incidents) {
          incidents.setIncidents(liveIncidents);
        }

        const departure = departureTime ? new Date(departureTime) : new Date();
        const routes = router.findRoutesToMany(origin, targets, {
          departureTime: departure,
          speedProfiles: speedProfiles ?? undefined,
          incidents: incidents ?? undefined,
          erp: erp ?? undefined,
        });
        const durationMs = Math.round(performance.now() - t0);

        const results: Array<[string, { seconds: number; meters: number } | null]> = [];
        for (const [targetId, r] of routes.entries()) {
          results.push([
            targetId,
            r ? { seconds: r.durationSeconds, meters: r.distanceMeters } : null,
          ]);
        }

        parentPort?.postMessage({
          type: 'route_many_result',
          id,
          results,
          durationMs,
        });
      } catch (err: any) {
        parentPort?.postMessage({
          type: 'error',
          id,
          message: err.message,
        });
      }
    }
  });
}

// Auto-initialize if workerData contains graphPath
if (workerData?.graphPath) {
  initWorker(workerData.graphPath);
}
