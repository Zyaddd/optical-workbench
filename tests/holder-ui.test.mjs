import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {createHolderUI} from '../src/holder-ui.mjs';import {syncMounts} from '../src/holders.mjs';
// Exercise the actual Properties event handlers with a small DOM adapter.
test('Properties workflow adjusts, attaches, offsets, detaches and resets without losing saved values',()=>{
 const nodes=new Map();
 class Element{constructor(){this.children=[];this.value='';}set innerHTML(s){for(const m of s.matchAll(/id="([^"]+)"/g))nodes.set(m[1],new Element());}prepend(e){this.children.unshift(e);}append(e){this.children.push(e);}replaceChildren(){this.children=[];}querySelectorAll(){return [...nodes.values()];}}
 const old=globalThis.document;globalThis.document={createElement:()=>new Element()};
 try{const $=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
 const asset=JSON.parse(fs.readFileSync(new URL('../src/holder.json',import.meta.url))),catalog=new Map([[asset.id,asset]]);
 const h={id:'h',name:'Holder 1',assetId:asset.id,x:10,y:0,z:20,angle:0},c={id:'c',name:'Laser',assetId:'builtin-mirror',x:50,y:0,z:50,angle:0};const state={items:[h,c]};let current=h,checkpoints=0,ui;const errors=[];
 ui=createHolderUI({$,item:()=>current,getState:()=>state,catalog,checkpoint:()=>checkpoints++,commit:()=>{syncMounts(state.items,catalog);ui.sync();},toast:e=>errors.push(e)});ui.sync();
 assert.equal($('holderBody').value,25.4);$('holderBody').value='60';$('holderPost').value='80';$('holderBody').onchange();assert.deepEqual(h.holder,{body:60,post:80});assert.match($('holderTop').textContent,/142.39/);
 current=c;ui.sync();assert.equal($('heightControls').hidden,true);assert.equal($('mountHolder').children[1].textContent,'Holder 1');$('mountHolder').value='h';$('mountHolder').onchange();assert.equal(c.mount.holderId,'h');assert.equal(c.x,10);assert.equal(c.z,20);assert.ok(Math.abs(c.y-142.3876)<1e-6);
 $('mountX').value='7';$('mountOffset').value='2';$('mountX').onchange();assert.equal(c.x,17);assert.ok(Math.abs(c.y-144.3876)<1e-6);ui.sync();assert.equal($('mountX').value,7);
 const y=c.y;$('detachHolder').onclick();assert.equal(c.mount,undefined);assert.equal(c.y,y);
 current=h;ui.sync();$('holderBody').value='-5';$('holderBody').onchange();assert.equal(errors.length,1);assert.equal(h.holder.body,60);assert.equal($('holderBody').value,60);$('resetHolder').onclick();assert.equal(h.holder,undefined);assert.equal($('holderBody').value,25.4);assert.equal(checkpoints,5);
 }finally{globalThis.document=old;}
});
