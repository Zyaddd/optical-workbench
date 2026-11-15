export function studioUI({THREE,scene,camera,objects,getState,item,renderer,viewport,setMode}){
 const $=id=>document.getElementById(id),move=(id,parent)=>parent.append($(id));
 const menu = $('projectMenu');
 const menuItems = menu.querySelector('.projectMenuItems');
 for (const id of ['newProject','load','save','importCad','exportLibrary','importLibrary','planning']) move(id,menuItems);
 menuItems.addEventListener('click', () => { menu.open = false; });
 menu.addEventListener('keydown', event => {
  if (event.key === 'Escape' && menu.open) {
   menu.open = false;
   menu.querySelector('summary').focus();
  }
 });
 document.addEventListener('click', event => { if (!menu.contains(event.target)) menu.open = false; });
 const tools=document.querySelector('.workspaceBar .toolGroup'),select=document.createElement('button');select.textContent='Select';select.title='Select (Esc)';select.onclick=()=>setMode('select');tools.prepend(select);{const sep=document.createElement('span');sep.className='divider';tools.append(sep);}move('measureTool',tools);move('openBeam',tools);$('openBeam').classList.add('beamTool');$('openBeam').title='Draw a laser beam path';
 const categories=document.createElement('select');categories.className='categoryFilter';categories.setAttribute('aria-label','Component category');for(const name of ['All components','Lasers','Mirrors','Holders','Cells','Breadboards']){const o=document.createElement('option');o.textContent=name;categories.append(o);}document.querySelector('.searchWrap').after(categories);
 function filter(){const patterns=[null,/laser|qcl|nano/i,/mirror/i,/holder|post/i,/cell|cavity/i,/board/i],re=patterns[categories.selectedIndex];for(const card of document.querySelectorAll('#cards .card,#customCards .customCard'))if(re&&!re.test(card.textContent))card.hidden=true;}
 categories.onchange=()=>{$('search').dispatchEvent(new Event('input'));filter();};new MutationObserver(filter).observe($('customCards'),{childList:true});
 function fold(title,nodes,open=false){const d=document.createElement('details');d.className='studioSection';d.open=open;const s=document.createElement('summary');s.textContent=title;d.append(s);nodes[0].before(d);for(const n of nodes)d.append(n);return d;}
 const panel=$('selectedPanel'),position=[];let collecting=false;for(const n of [...panel.children]){if(n.classList.contains('propertyHeading'))collecting=true;if(collecting)position.push(n);}if(position.length)fold('Position & rotation',position,true);
 for(const [selector,title]of [['.holderProperties','Mounting'],['.groupProperties','Groups']]){const n=panel.querySelector(selector);if(n)fold(title,[n],title==='Mounting');}
 const appearance=document.createElement('details');appearance.className='studioSection';appearance.innerHTML='<summary>Appearance</summary><p>Edit model colours and orientation in the library.</p><button>Edit selected model</button>';appearance.querySelector('button').onclick=()=>{const id=item()?.assetId;document.querySelector('[data-asset-id="'+id+'"] button[aria-label^="Edit"]')?.click();};panel.append(appearance);
 fold('Beam expansion',[$('routeExpand').closest('label'),$('routeExpansionFields')]);
 const groupOpen=new Map();let listBusy=false;function groupList(){if(listBusy)return;listBusy=true;const rows=[...$('sceneList').querySelectorAll('.sceneRow')],groups=new Map();rows.forEach((row,n)=>{const i=getState().items[n];if(i?.groupId){if(!groups.has(i.groupId))groups.set(i.groupId,[]);groups.get(i.groupId).push(row);}});for(const [id,rows]of groups){const d=document.createElement('details');d.className='setupGroup';d.open=groupOpen.get(id)??true;const sum=document.createElement('summary');sum.textContent=(getState().items.find(i=>i.groupId===id)?.groupName||'Group')+' · '+rows.length;d.append(sum);rows[0].before(d);rows.forEach(r=>d.append(r));d.ontoggle=()=>groupOpen.set(id,d.open);}listBusy=false;}
 new MutationObserver(()=>{if(!$('sceneList').querySelector('.setupGroup'))groupList();}).observe($('sceneList'),{childList:true});
 const overlay=new THREE.Group();scene.add(overlay);const readout=document.createElement('div');readout.className='studioAngle';viewport.append(readout);let last=0;
 function frame(t){requestAnimationFrame(frame);if(t-last<120)return;last=t;for(const o of [...overlay.children]){overlay.remove(o);o.geometry?.dispose();o.material?.dispose();}const state=getState(),groups=new Map();for(const i of state.items)if(i.groupId){if(!groups.has(i.groupId))groups.set(i.groupId,[]);groups.get(i.groupId).push(i);}for(const members of groups.values()){const box=new THREE.Box3();members.forEach(i=>{const obj=objects.get(i.id);if(obj)box.union(new THREE.Box3().setFromObject(obj));});if(!box.isEmpty())overlay.add(new THREE.Box3Helper(box,new THREE.Color('#42a89c')));}
 const active=item();readout.hidden=!active;if(active){const p=new THREE.Vector3(active.x,active.y+25,active.z).project(camera),r=renderer.domElement.getBoundingClientRect();readout.style.left=((p.x+1)*r.width/2+18)+'px';readout.style.top=((-p.y+1)*r.height/2)+'px';readout.textContent=active.angle.toFixed(1)+'°';}
 const mounting=!!document.querySelector('.mountDropHint:not([hidden])')||!$('modeHint').hidden;for(const i of state.items){const obj=objects.get(i.id);if(!mounting||!obj?.userData.dynamicHolder)continue;const box=new THREE.Box3().setFromObject(obj),ring=new THREE.Mesh(new THREE.RingGeometry(8,11,40),new THREE.MeshBasicMaterial({color:'#29dcb1',side:THREE.DoubleSide,transparent:true,opacity:.7,depthTest:false}));ring.rotation.x=-Math.PI/2;ring.position.set(i.x,box.max.y+.5,i.z);overlay.add(ring);}
 }requestAnimationFrame(frame);
}
