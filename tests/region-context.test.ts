import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createCity } from '../src/simulation.ts';
import { createRegionContext, getRegionMargin } from '../src/region-context.ts';
import { sampleGroundHeight } from '../src/terrain-graphics.ts';

test('exterior continuation shares exact terrain boundaries and has no triangles inside the playable map',t=>{
  const city=createCity(2139,true,40),material=new THREE.MeshStandardMaterial({vertexColors:true});
  for(const tile of city.tiles)tile.elevation=tile.x>30?-2:Math.round((Math.sin(tile.z*.31)+1)*2)/2;
  const group=createRegionContext(city,{ground:material,earth:material,rock:material});
  const mesh=group.children[0] as THREE.Mesh;
  t.after(()=>{group.traverse(object=>{if(object instanceof THREE.Mesh||object instanceof THREE.LineSegments)object.geometry.dispose();});for(const item of group.userData.ownedMaterials)item.dispose();material.dispose();});
  assert.equal(mesh.material,material,'The PBR ground material and texture ownership remain with the scene');
  assert.equal(mesh.castShadow,false);assert.equal(mesh.receiveShadow,false);
  assert.equal(group.children[1].userData.raytracingExclude,true);
  const positions=mesh.geometry.getAttribute('position'),normals=mesh.geometry.getAttribute('normal'),indices=mesh.geometry.index!;
  const half=city.size/2,count=city.size*4;
  assert.equal(positions.count,count*7);
  assert.equal(getRegionMargin(city.size),80);
  assert.equal(getRegionMargin(128),128);
  for(let i=0;i<count;i++) {
    const x=positions.getX(i),z=positions.getZ(i);
    assert.ok(Math.abs(x)===half||Math.abs(z)===half);
    assert.ok(Math.abs(positions.getY(i)-sampleGroundHeight(city,x,z))<.000001,'Inner ring must meet the actual map height');
  }
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),edge=new THREE.Vector3(),normal=new THREE.Vector3();
  for(let i=0;i<indices.count;i+=3) {
    a.fromBufferAttribute(positions,indices.getX(i));b.fromBufferAttribute(positions,indices.getX(i+1));c.fromBufferAttribute(positions,indices.getX(i+2));
    const x=(a.x+b.x+c.x)/3,z=(a.z+b.z+c.z)/3;
    assert.ok(Math.abs(x)>half||Math.abs(z)>half,'No context triangle may cover buildable terrain');
    normal.subVectors(b,a).cross(edge.subVectors(c,a));
    assert.ok(normal.y>0,'Outside ground must slope upward-facing; it must not create vertical cut walls');
  }
  assert.ok(Array.from(normals.array).every(Number.isFinite));
  // The final ring settles to plains on land and negative seabed on the sea side.
  for(let i=count*6;i<positions.count;i++)assert.ok(positions.getY(i)===0||positions.getY(i)===-2);
});
