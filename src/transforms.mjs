import {localToWorld,worldToLocal} from './planning.mjs';
import {syncMounts} from './holders.mjs';
const normal=d=>((d%360)+360)%360;
export function groupMembers(items,id){const item=items.find(i=>i.id===id);return item?.groupId?items.filter(i=>i.groupId===item.groupId).map(i=>i.id):item?[id]:[];}
export function movingRoots(items,ids){const chosen=new Set(ids),byId=new Map(items.map(i=>[i.id,i]));return items.filter(i=>{if(!chosen.has(i.id))return false;let p=byId.get(i.mount?.holderId);while(p){if(chosen.has(p.id))return false;p=byId.get(p.mount?.holderId);}return true;});}
export function descendantIds(items,ids){const all=new Set(ids);for(let n=0;n<items.length;n++)for(const i of items)if(all.has(i.mount?.holderId))all.add(i.id);return all;}
function applyPose(i,pose,items){Object.assign(i,pose);if(i.mount){const p=items.find(p=>p.id===i.mount.holderId);if(p){const q=worldToLocal(p,i);i.mount.x=q.x;i.mount.z=q.z;i.mount.angle=normal(i.angle-p.angle);}}}
export function translateItems(items,ids,dx,dz,dy,assets){const roots=movingRoots(items,ids);for(const i of roots){if(i.mount&&dy!==0)i.mount.offset=Math.max(0,i.mount.offset+dy);applyPose(i,{x:i.x+dx,z:i.z+dz,y:i.y+dy},items);}syncMounts(items,assets);}
export function rotateItems(items,ids,degrees,pivot,assets){
 const selected=new Set(ids),roots=movingRoots(items,ids),preserved=[];
 for(const r of roots)if(r.rotateContents===false)for(const child of items)if(child.mount?.holderId===r.id&&!selected.has(child.id))preserved.push({id:child.id,x:child.x,y:child.y,z:child.z,angle:child.angle});
 const a=degrees*Math.PI/180;for(const i of roots){const x=i.x-pivot.x,z=i.z-pivot.z;applyPose(i,{x:pivot.x+x*Math.cos(a)+z*Math.sin(a),z:pivot.z-x*Math.sin(a)+z*Math.cos(a),angle:normal(i.angle+degrees)},items);}
 for(const pose of preserved){const i=items.find(i=>i.id===pose.id);applyPose(i,pose,items);}syncMounts(items,assets);
}
export function canMount(child,parent,items,assets){if(!child||!parent||child.id===parent.id||!assets.get(parent.assetId)?.holderSpec)return false;let p=parent;while(p){if(p.id===child.id)return false;p=items.find(i=>i.id===p.mount?.holderId);}return true;}
export function groupSelection(items,ids,id,name='Group'){const chosen=new Set(ids);if(chosen.size<2)throw Error('Select at least two components to group.');if(items.some(i=>chosen.has(i.id)&&i.locked))throw Error('Unlock the selected components before grouping.');for(const i of items)if(chosen.has(i.id)){i.groupId=id;i.groupName=name;}}
export function ungroupSelection(items,ids){const idsSet=new Set(ids),groups=new Set(items.filter(i=>idsSet.has(i.id)).map(i=>i.groupId).filter(Boolean));if(items.some(i=>groups.has(i.groupId)&&i.locked))throw Error('Unlock the group before ungrouping.');for(const i of items)if(groups.has(i.groupId)){delete i.groupId;delete i.groupName;}}
