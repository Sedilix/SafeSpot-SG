/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * map-links-to-graph.ts: Maps LTA DataMall speed-band links to OSM road graph edges
 * by geometry and bearing.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { RoadGraph, pointToSegmentDistance } from '../../src/routing/graph';

const LINKS_FILE = join(process.cwd(), 'tools', 'speedbands', 'data', 'lta-links.json');
const MAP_OUTPUT = join(process.cwd(), 'tools', 'speedbands', 'data', 'link-to-edge-map.json');

export interface LinkEdgeMatch {
  linkId: string;
  roadName: string;
  roadCat: string;
  edgeId: number;
  edgeHighway: string;
  edgeName: string;
  distMeters: number;
  bearingDiffDeg: number;
}

export function buildLinkToEdgeMap(maxDistM = 25, maxAngleDiffDeg = 35): Record<string, LinkEdgeMatch> {
  if (!existsSync(LINKS_FILE)) {
    throw new Error(`Links metadata file missing: ${LINKS_FILE}`);
  }
  const links: Record<string, any> = JSON.parse(readFileSync(LINKS_FILE, 'utf8'));
  console.log(`Loaded ${Object.keys(links).length} LTA links.`);

  console.log('Loading default road graph...');
  const graph = RoadGraph.loadDefault();
  console.log(`Graph loaded: ${graph.nodes.length} nodes, ${graph.edges.length} edges.`);

  // Build spatial grid over graph edges (~110 m per cell)
  const CELL_SIZE = 0.001; // ~110 m
  const grid = new Map<string, number[]>();

  for (let eid = 0; eid < graph.edges.length; eid++) {
    const e = graph.edges[eid];
    const lat1 = graph.nodeLat[e.from], lon1 = graph.nodeLng[e.from];
    const lat2 = graph.nodeLat[e.to], lon2 = graph.nodeLng[e.to];
    const minLat = Math.min(lat1, lat2), maxLat = Math.max(lat1, lat2);
    const minLon = Math.min(lon1, lon2), maxLon = Math.max(lon1, lon2);

    const minGx = Math.floor(minLon / CELL_SIZE), maxGx = Math.floor(maxLon / CELL_SIZE);
    const minGy = Math.floor(minLat / CELL_SIZE), maxGy = Math.floor(maxLat / CELL_SIZE);

    for (let gx = minGx; gx <= maxGx; gx++) {
      for (let gy = minGy; gy <= maxGy; gy++) {
        const k = `${gx},${gy}`;
        let list = grid.get(k);
        if (!list) { list = []; grid.set(k, list); }
        list.push(eid);
      }
    }
  }
  console.log(`Spatial grid built with ${grid.size} active cells.`);

  const linkMap: Record<string, LinkEdgeMatch> = {};
  let matchCount = 0;

  for (const [linkId, link] of Object.entries(links)) {
    const latMid = (link.startLat + link.endLat) / 2;
    const lonMid = (link.startLon + link.endLon) / 2;
    const gx = Math.floor(lonMid / CELL_SIZE);
    const gy = Math.floor(latMid / CELL_SIZE);

    let bestEid = -1;
    let bestDist = Infinity;
    let bestAngleDiff = Infinity;

    // Check 3x3 neighborhood
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const cell = grid.get(`${gx + dx},${gy + dy}`);
        if (!cell) continue;

        for (const eid of cell) {
          const edgeBearing = graph.edgeBearings[eid];
          const angleDiff = Math.abs(((link.bearing - edgeBearing + 540) % 360) - 180);
          if (angleDiff > maxAngleDiffDeg) continue;

          const e = graph.edges[eid];
          const p1Lat = graph.nodeLat[e.from], p1Lon = graph.nodeLng[e.from];
          const p2Lat = graph.nodeLat[e.to], p2Lon = graph.nodeLng[e.to];
          const d = pointToSegmentDistance(latMid, lonMid, p1Lat, p1Lon, p2Lat, p2Lon);

          if (d <= maxDistM && d < bestDist) {
            bestDist = d;
            bestEid = eid;
            bestAngleDiff = angleDiff;
          }
        }
      }
    }

    if (bestEid !== -1) {
      const e = graph.edges[bestEid];
      linkMap[linkId] = {
        linkId,
        roadName: link.roadName,
        roadCat: link.roadCat,
        edgeId: bestEid,
        edgeHighway: e.highway,
        edgeName: e.name || '',
        distMeters: Number(bestDist.toFixed(1)),
        bearingDiffDeg: Number(bestAngleDiff.toFixed(1)),
      };
      matchCount++;
    }
  }

  console.log(`Matched ${matchCount} of ${Object.keys(links).length} LTA links (${((matchCount / Object.keys(links).length) * 100).toFixed(1)}%).`);
  writeFileSync(MAP_OUTPUT, JSON.stringify(linkMap, null, 2), 'utf8');
  console.log(`Saved mapping to ${MAP_OUTPUT}`);
  return linkMap;
}

const isMain = process.argv[1] && (process.argv[1].endsWith('map-links-to-graph.ts') || process.argv[1].endsWith('map-links-to-graph.js'));
if (isMain) {
  buildLinkToEdgeMap();
}
