function rgbHex(rgb){return '#'+rgb.map(v=>Math.round(Math.max(0,Math.min(1,v))*255).toString(16).padStart(2,'0')).join('')}

let engine=null;
self.onmessage=async event=>{try{
if(!engine){const bytes=Uint8Array.from(atob('__WASM_BASE64__'),c=>c.charCodeAt(0));engine=await occtimportjs({wasmBinary:bytes,print:()=>{},printErr:()=>{}})}
const {bytes,ext}=event.data,params={linearUnit:'millimeter',linearDeflectionType:'absolute_value',linearDeflection:0.25,angularDeflection:0.5};
const result=ext==='iges'||ext==='igs'?engine.ReadIgesFile(new Uint8Array(bytes),params):engine.ReadStepFile(new Uint8Array(bytes),params);
if(!result.success||!result.meshes?.length)throw Error('No geometry was found. Use a valid STEP, IGES or STL file.');
let triangles=0;const meshes=result.meshes.map(m=>{triangles+=m.index.array.length/3;const rgb=m.color||[.42,.48,.53],color='#'+rgb.map(v=>Math.round(Math.max(0,Math.min(1,v))*255).toString(16).padStart(2,'0')).join('');return {name:m.name||'Part',hasSourceColour:!!m.color||(m.brep_faces||[]).some(f=>!!f.color),positions:m.attributes.position.array,indices:m.index.array,color,normals:m.attributes.normal?.array,faces:(m.brep_faces||[]).filter(f=>Number.isInteger(f.first)&&Number.isInteger(f.last)&&f.first>=0&&f.last>=f.first&&f.last<m.index.array.length/3).map(f=>({first:f.first,last:f.last,color:f.color?rgbHex(f.color):undefined}))}});
if(triangles>2000000)throw Error('This model exceeds 2 million triangles. Export a simplified STEP file.');
self.postMessage({meshes});
}catch(e){self.postMessage({error:e?.message||'CAD conversion failed. Try a simpler STEP model.'})}};
