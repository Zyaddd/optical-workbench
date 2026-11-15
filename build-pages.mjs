import './build.mjs';
import {cp, readFile, writeFile} from 'node:fs/promises';
import {validateProject, DEFAULT_BOARD} from './src/core.mjs';
const load = async name => JSON.parse(await readFile(new URL('./src/'+name+'.json',import.meta.url)));
const [lasers, defaults] = await Promise.all([load('lasers'),load('default-components')]);
const modelIds = ['supplied-nanoplus','default-flat-mirror','default-vigo-detector'];
const models = modelIds.map(id => [...lasers,...defaults].find(asset => asset.id === id));
const project = validateProject({format:'optical-workbench',version:2,name:'Laser, mirror and detector',
 board:DEFAULT_BOARD, assets:models,
 items:modelIds.map((assetId,i)=>({assetId,id:'demo-'+i,name:models[i].name,x:[80,-50,-50][i],y:[0,0,6][i],z:[-60,-60,75][i],angle:[180,-45,180][i]})),
 beams:[{id:'demo-beam', name:'Example beam', enabled:true,color:'#ef4444',width:1.2,opacity:.85,
  points:[{x:28,y:26,z:0,itemId:'demo-0'},{x:17,y:26,z:1,itemId:'demo-1'},{x:-2.4,y:20,z:42.5,itemId:'demo-2'}]}],
});
await Promise.all([
 cp('web/index.html','dist/index.html'),
 writeFile('dist/Example.optics.json',JSON.stringify(project)),
 cp('SOURCE_NOTICES.md','dist/SOURCE_NOTICES.md'),
 cp('THIRD_PARTY_LICENSES.txt','dist/THIRD_PARTY_LICENSES.txt'),
 cp('vendor/license.occt.txt','dist/license.occt.txt'),
 cp('vendor/license.occt-import-js.txt','dist/license.occt-import-js.txt'),
]);
