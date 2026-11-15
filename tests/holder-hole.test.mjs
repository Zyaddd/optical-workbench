import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import * as THREE from 'three';
import {holderMeshes} from '../src/holders.mjs';
const asset=JSON.parse(fs.readFileSync(new URL('../src/holder.json',import.meta.url)));
test('silver post cross-hole is closed at original and extended heights',()=>{
 assert.equal(asset.geometryRevision,2);
 for(const dimensions of [undefined,{body:50,post:75}]){
  const meshes=holderMeshes(asset,dimensions),part=meshes.find(m=>m.name==='0335-E0W.stp.STEP.STEP001');
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(part.positions,3));geometry.setIndex(part.indices);const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));mesh.updateMatrixWorld(true);
  const y=39.8526+(dimensions?24.6+52.775*(39.8526-36.5)/4:0),ray=new THREE.Raycaster(new THREE.Vector3(0,y,-20),new THREE.Vector3(0,0,1)),hits=ray.intersectObject(mesh);
  assert.ok(hits.length>=2);assert.ok(hits[0].point.z < -6,'ray must strike the closed front wall');geometry.dispose();mesh.material.dispose();
 }
});
