import {localToWorld} from './planning.mjs';
import {reflect,unit} from './beam.mjs';
export function validateRoutes(routes,ids){if(routes==null)return [];if(!Array.isArray(routes)||routes.length>100)throw Error('Limit: 100 beams.');const seen=new Set();return routes.map(b=>{if(!b||typeof b.id!=='string'||seen.has(b.id)||typeof b.name!=='string'||!/^#[0-9a-f]{6}$/i.test(b.color)||!Number.isFinite(b.width)||b.width<.1||b.width>100||!Array.isArray(b.points)||b.points.length<2||b.points.length>66)throw Error('Invalid beam route.');beamAppearance(b);if(b.physics!=null&&typeof b.physics!=='boolean')throw Error('Invalid beam route.');seen.add(b.id);const points=b.points.map(p=>{if(!p||![p.x,p.y,p.z].every(v=>Number.isFinite(v)&&Math.abs(v)<20000)||p.itemId&&!ids.has(p.itemId)||p.normal&&(!Array.isArray(p.normal)||p.normal.length!==3||!p.normal.every(Number.isFinite)||Math.hypot(...p.normal)<.9))throw Error('Invalid beam route point.');return {...p}});return {...b,name:b.name.slice(0,100),enabled:b.enabled!==false,points}})}
export function routeWorld(points,items){return points.map(p=>{const i=p.itemId&&items.find(i=>i.id===p.itemId);if(p.itemId&&!i)return null;return i?localToWorld(i,p):p})}
export function routeSegments(b,items){const p=routeWorld(b.points,items),segments=[];for(let k=1;k<p.length;k++)if(p[k-1]&&p[k])segments.push({a:[p[k-1].x,p[k-1].y,p[k-1].z],b:[p[k].x,p[k].y,p[k].z]});return segments}
export function beamAppearance(b){
 const diameter=b.width,opacity=b.opacity??1,expansion=b.expansion??null;
 if(!Number.isFinite(diameter)||diameter<.1||diameter>100||!Number.isFinite(opacity)||opacity<0||opacity>1)throw Error('Use beam diameter 0.1–100 mm and opacity 0–100%.');
 if(expansion&&(!Number.isInteger(expansion.start)||expansion.start<0||expansion.start>=b.points.length-1||!Number.isFinite(expansion.endDiameter)||expansion.endDiameter<diameter||expansion.endDiameter>200))throw Error('Choose an expansion start before the endpoint and an end diameter between the beam diameter and 200 mm.');
 return {diameter,opacity,expansion};
}
export function beamEnvelope(b,items){
 const {diameter,opacity,expansion}=beamAppearance(b),points=routeWorld(b.points,items),lengths=[0];
 for(let k=1;k<points.length;k++){const a=points[k-1],p=points[k];lengths.push(lengths[k-1]+(a&&p?Math.hypot(p.x-a.x,p.y-a.y,p.z-a.z):0));}
 const start=expansion?lengths[expansion.start]:Infinity,total=lengths.at(-1),growth=total-start;
 const at=k=>diameter+(expansion&&growth>1e-9?(expansion.endDiameter-diameter)*Math.max(0,Math.min(1,(lengths[k]-start)/growth)):0),segments=[];
 for(let k=1;k<points.length;k++)if(points[k-1]&&points[k]&&lengths[k]-lengths[k-1]>1e-6)segments.push({a:['x','y','z'].map(c=>points[k-1][c]),b:['x','y','z'].map(c=>points[k][c]),startDiameter:at(k-1),endDiameter:at(k),opacity,index:k-1});
 return segments;
}
export function removeRoutePoint(b,index){if(b.points.length<=2)throw Error('A beam needs two points.');b.points.splice(index,1);if(b.expansion){if(index<b.expansion.start)b.expansion.start--;b.expansion.start=Math.min(b.expansion.start,b.points.length-2);}}
export function reorderRoutePoint(b,index,offset){const next=index+offset;if(index<=0||index>=b.points.length-1||next<=0||next>=b.points.length-1)throw Error('Keep start and endpoint fixed.');[b.points[index],b.points[next]]=[b.points[next],b.points[index]];if(b.expansion?.start===index)b.expansion.start=next;else if(b.expansion?.start===next)b.expansion.start=index;}
export function reflectionWarnings(b,items,tolerance=5){const p=routeWorld(b.points,items),warnings=[];for(let k=1;k<p.length-1;k++){const point=b.points[k],i=items.find(i=>i.id===point.itemId);if(!point.normal||!p[k-1]||!p[k]||!p[k+1])continue;const a=(i?.angle||0)*Math.PI/180,[x,y,z]=point.normal,n=[x*Math.cos(a)+z*Math.sin(a),y,-x*Math.sin(a)+z*Math.cos(a)];try{const incoming=unit(['x','y','z'].map(c=>p[k][c]-p[k-1][c])),outgoing=unit(['x','y','z'].map(c=>p[k+1][c]-p[k][c])),r=reflect(incoming,n),error=Math.acos(Math.max(-1,Math.min(1,r.reduce((s,v,j)=>s+v*outgoing[j],0))))*180/Math.PI;if(error>tolerance)warnings.push({index:k,error})}catch{warnings.push({index:k,error:180})}}return warnings}
export function detachRoutes(routes,ids,items){for(const b of routes||[])b.points=b.points.map(p=>{if(!ids.has(p.itemId))return p;const i=items.find(i=>i.id===p.itemId);return i?{...localToWorld(i,p),label:p.label||i.name}:p})}
