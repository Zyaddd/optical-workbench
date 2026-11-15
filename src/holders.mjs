import {localToWorld,worldToLocal} from './planning.mjs';

export function holderDimensions(spec,value={}) {
 if(!spec)return null;
 if(![spec.bodyHeight,spec.postHeight,spec.top].every(v=>Number.isFinite(v)&&v>0&&v<=2000)||!['bodyBand','postBand'].every(k=>Array.isArray(spec[k])&&spec[k].length===2&&spec[k].every(Number.isFinite)&&spec[k][0]<spec[k][1]&&spec[k][1]-spec[k][0]<(k==='bodyBand'?spec.bodyHeight:spec.postHeight)))throw Error('Invalid adjustable holder specification.');
 const bodyMin=+(spec.bodyHeight-(spec.bodyBand[1]-spec.bodyBand[0])+0.1).toFixed(4),postMin=+(spec.postHeight-(spec.postBand[1]-spec.postBand[0])+0.1).toFixed(4);
 const body=value.body??spec.bodyHeight,post=value.post??spec.postHeight;
 if(![body,post].every(Number.isFinite)||body<bodyMin||post<postMin||body>500||post>500)throw Error(`Use body ${bodyMin}–500 mm and post ${postMin}–500 mm.`);
 return {body,post,bodyMin,postMin,top:spec.top+body-spec.bodyHeight+post-spec.postHeight};
}
export function holderMeshes(asset,value) {
 const d=holderDimensions(asset.holderSpec,value);if(!d)return asset.meshes;
 const s=asset.holderSpec,db=d.body-s.bodyHeight,dp=d.post-s.postHeight;
 const ramp=(y,band)=>Math.max(0,Math.min(1,(y-band[0])/(band[1]-band[0])));
 return asset.meshes.map(m=>({...m,normals:undefined,positions:m.positions.map((v,n)=>n%3!==1?v:m.holderRole==='body'?v+db*ramp(v,s.bodyBand):m.holderRole==='post'?v+db+dp*ramp(v,s.postBand):v)}));
}
export function validateMounts(items,assets) {
 const map=new Map(items.map(i=>[i.id,i]));
 for(const i of items){const spec=assets.get(i.assetId)?.holderSpec;if(i.holder&&!spec)throw Error('Adjustable holder model is missing.');if(spec)holderDimensions(spec,i.holder);
  if(!i.mount)continue;const m=i.mount,p=map.get(m.holderId);
  if(!p||p===i||!assets.get(p.assetId)?.holderSpec||![m.x,m.z,m.angle,m.offset].every(v=>Number.isFinite(v)&&Math.abs(v)<=10000)||m.offset<0)throw Error('Invalid holder attachment.');
  const seen=new Set([i.id]);let node=p;while(node){if(seen.has(node.id))throw Error('Holder attachment cycle.');seen.add(node.id);node=node.mount?map.get(node.mount.holderId):null;}
 }
}
export function syncMounts(items,assets) {
 const map=new Map(items.map(i=>[i.id,i])),done=new Set(),visiting=new Set();
 function resolve(i){if(done.has(i.id))return;if(visiting.has(i.id))throw Error('Holder attachment cycle.');visiting.add(i.id);
  const p=map.get(i.mount?.holderId),s=p&&assets.get(p.assetId)?.holderSpec;
  if(i.mount&&(!p||!s)){delete i.mount;}else if(s){resolve(p);const q=localToWorld(p,{x:i.mount.x,y:holderDimensions(s,p.holder).top+i.mount.offset,z:i.mount.z});Object.assign(i,q);i.angle=((p.angle+i.mount.angle)%360+360)%360;}
  visiting.delete(i.id);done.add(i.id);
 }
 items.forEach(resolve);
}
export function attachToHolder(child,parent,items,assets,{centre=true,offset=0}={}) {
 if(child===parent||child.id===parent.id)throw Error('A component cannot mount on itself.');
 const spec=assets.get(parent.assetId)?.holderSpec;if(!spec)throw Error('Choose an adjustable holder.');
 let p=parent;const map=new Map(items.map(i=>[i.id,i]));while(p){if(p.id===child.id)throw Error('This would create an attachment cycle.');p=map.get(p.mount?.holderId);}
 const q=worldToLocal(parent,child);
 child.mount={holderId:parent.id,x:centre?0:q.x,z:centre?0:q.z,angle:child.angle-parent.angle,offset};syncMounts(items,assets);
}
