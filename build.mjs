import {build} from 'esbuild';import fs from 'node:fs/promises';
await fs.mkdir('dist',{recursive:true});
const factory=await fs.readFile('vendor/occt-import-js.js','utf8'),wasm=await fs.readFile('vendor/occt-import-js.wasm');
const worker=factory+'\n'+(await fs.readFile('src/cad-worker.js','utf8')).replace('__WASM_BASE64__',wasm.toString('base64'));
const result=await build({entryPoints:['src/main.js'],bundle:true,write:false,format:'iife',minify:true,target:['chrome100','edge100'],legalComments:'inline'});
const script='window.__CAD_WORKER__='+JSON.stringify(worker)+';\n'+result.outputFiles[0].text;
const fsCSS=await fs.readFile('src/style.css','utf8');
const html=(await fs.readFile('src/index.html','utf8')).replace('__CSS__',()=>fsCSS).replace('__JS__',()=>script.replace(/<\/script/gi,'<\\/script'));
await fs.writeFile('dist/Optical_Workbench.html',html);console.log('Built fully offline HTML: '+(Buffer.byteLength(html)/1048576).toFixed(2)+' MB');
