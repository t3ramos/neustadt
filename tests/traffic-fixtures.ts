import { buildRoadNetwork,roadPointKey,type RoadNetwork } from '../src/traffic-network';
import type { Tile } from '../src/types';

/**
 * Controller unit fixtures depict interior junctions, with real approach storage
 * beyond their drawn boundary. Keep remote terminal-turn controllers out of the
 * controller under test. Motion tests use the complete network instead.
 */
export function interiorRoadNetwork(points:[number,number][]):RoadNetwork {
  const original=new Map(points.map(([x,z])=>[`${x},${z}`,{x,z}]));
  const extended=new Map(original),directions=[[0,-1],[1,0],[0,1],[-1,0]];
  for(const p of original.values()){
    const neighbors=directions.map(([x,z])=>({x:p.x+x,z:p.z+z})).filter(n=>original.has(roadPointKey(n)));
    if(neighbors.length!==1)continue;
    const dx=p.x-neighbors[0].x,dz=p.z-neighbors[0].z;
    for(let i=1;i<=2;i++){const next={x:p.x+dx*i,z:p.z+dz*i};extended.set(roadPointKey(next),next);}
  }
  const network=buildRoadNetwork({tiles:[...extended.values()].map(p=>({...p,kind:'road'} as Tile))});
  network.junctions=network.junctions.filter(j=>j.cells.some(p=>original.has(roadPointKey(p))));
  const ids=new Set(network.junctions.map(j=>j.id));
  network.junctionAt=new Map([...network.junctionAt].filter(([,j])=>ids.has(j.id)));
  network.approaches=new Map([...network.approaches].filter(([,a])=>ids.has(a.junctionId)));
  return network;
}
