import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';
import {createRouteUI} from '../src/route-ui.mjs';
test('beam Properties controls update actual rendered cylinders, colours, opacity and expansion',()=>{
 const nodes=new Map();class Element{constructor(){this.children=[];this.value='';this.style={};this.classList={add(){},remove(){}};}set innerHTML(s){for(const m of s.matchAll(/id="([^"]+)"/g))nodes.set(m[1],new Element());}append(...e){this.children.push(...e);}after(){}replaceChildren(){this.children=[];}setAttribute(){}addEventListener(){}focus(){}getContext(){return {beginPath(){},arc(){},fill(){},fillText(){}};}}
 const old=globalThis.document;globalThis.document={createElement:()=>new Element(),querySelector:()=>new Element(),addEventListener(){},activeElement:null};
 try{const $=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};const scene=new THREE.Scene(),objects=new Map(),state={items:[],beams:[{id:'b',name:'Beam',color:'#ff0000',width:2,enabled:true,points:[{x:0,y:0,z:0},{x:100,y:0,z:0},{x:100,y:0,z:100}]}]};let n=0,ui;const errors=[];
 ui=createRouteUI({THREE,$,scene,objects,getState:()=>state,checkpoint:()=>n++,commit:()=>ui.refresh(),uid:()=> 'new-beam',toast:e=>errors.push(e),renderer:{domElement:new Element()},viewport:new Element(),setPlacing(){},prepare(){},showProperties(){}});
 $('routeList').children[0].onclick();assert.equal($('routeWidth').value,2);$('routeWidth').value='8';$('routeWidth').onchange();assert.equal(state.beams[0].width,8);
 $('routeOpacity').value='35';$('routeOpacity').onchange();assert.equal(state.beams[0].opacity,.35);
 $('routeExpand').checked=true;$('routeExpand').onchange();$('routeExpandStart').value='1';$('routeExpandStart').onchange();$('routeEndDiameter').value='30';$('routeEndDiameter').onchange();assert.deepEqual(state.beams[0].expansion,{start:1,endDiameter:30});
 $('routeColour').value='#00ff00';$('routeColour').onchange();const cylinders=scene.children[0].children.filter(o=>o.geometry?.type==='CylinderGeometry');assert.equal(cylinders.length,6);const core=cylinders.filter(o=>o.material.blending===THREE.NormalBlending);assert.equal(core.length,2);assert.equal(core[0].geometry.parameters.radiusTop,4);assert.equal(core[1].geometry.parameters.radiusTop,15);assert.equal(core[1].geometry.parameters.radiusBottom,4);assert.equal(core[1].material.opacity,.35);assert.equal(core[1].material.color.getHexString(),'00ff00');
 const underlying=new THREE.Object3D();objects.set('underlying',underlying);const ray={intersectObjects:targets=>!targets.length?[]:targets.includes(underlying)?[{object:underlying}]:[{object:{userData:{routeId:'b'}}}]};assert.equal(ui.pick(ray),false);objects.clear();assert.equal(ui.pick(ray),true);
 $('routeOpacity').value='0';$('routeOpacity').onchange();assert.equal(scene.children[0].children.length,0);$('routeEndDiameter').value='-1';$('routeEndDiameter').onchange();assert.equal(errors.length,1);assert.equal(state.beams[0].expansion.endDiameter,30);assert.equal(n,7);
 }finally{globalThis.document=old;}
});


