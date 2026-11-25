// Packs the MCP server as a Claude Desktop extension: dist/Optical_Workbench.mcpb (a zip with manifest.json,
// the bundled server and the offline workbench page for the live view). Run `node build.mjs` first.
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import zlib from 'node:zlib';

const page = 'dist/Optical_Workbench.html';
await fs.access(page).catch(() => { throw Error(`Missing ${page}. Run "node build.mjs" first.`); });
const bundle = await build({entryPoints:['mcp/server.mjs'], bundle:true, write:false, platform:'node', format:'esm', target:'node18', minify:true, legalComments:'inline'});
const server = bundle.outputFiles[0].contents;
const {version} = JSON.parse(await fs.readFile('package.json', 'utf8'));
const source = await fs.readFile('mcp/server.mjs', 'utf8');
const tools = [...source.matchAll(/\{name:'([a-z_]+)', description:'((?:[^'\\]|\\.)*)'/g)].map(m => ({name:m[1], description:m[2].replace(/\\'/g, "'").split('. ')[0].replace(/\.$/, '') + '.'}));
const manifest = {
 manifest_version:'0.2',
 name:'optical-workbench',
 display_name:'Optical Workbench',
 version,
 description:'Build optical breadboard setups by describing them: lasers, lenses, mirrors, beam splitters, gas cells and detectors on post holders, with physical beam tracing and a live 3D workbench.',
 long_description:'Claude places each part on a post holder at the beam height, aims mirrors and splitters, draws physical beams (Gaussian beams with M², lens dispersion, power losses, gas absorption, detector signal and fibre coupling) and checks for collisions. The setup appears live in the Optical Workbench in your browser, where your own edits go back to Claude. Setups save as .optics.json files the Optical Workbench app opens.',
 author:{name:'Optical Workbench'},
 homepage:'https://zyaddd.github.io/optical-workbench/',
 server:{type:'node', entry_point:'server/index.mjs', mcp_config:{command:'node', args:['${__dirname}/server/index.mjs'], env:{}}},
 tools,
 keywords:['optics', 'laser', 'spectroscopy', 'breadboard', 'beam'],
 compatibility:{platforms:['darwin', 'win32', 'linux'], runtimes:{node:'>=18.0.0'}},
};
const files = [
 ['manifest.json', Buffer.from(JSON.stringify(manifest, null, 2))],
 ['server/index.mjs', Buffer.from(server)],
 ['server/Optical_Workbench.html', await fs.readFile(page)],
 ['LICENSES.txt', await fs.readFile('THIRD_PARTY_LICENSES.txt')],
];

// A plain zip writer (deflate), enough for an extension bundle.
function zip(entries) {
 const local = [], central = [];
 let offset = 0;
 for (const [name, data] of entries) {
  const packed = zlib.deflateRawSync(data, {level:9}), crc = zlib.crc32(data), fileName = Buffer.from(name);
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(8, 8);
  head.writeUInt32LE(0, 10); head.writeUInt32LE(crc, 14); head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(data.length, 22);
  head.writeUInt16LE(fileName.length, 26); head.writeUInt16LE(0, 28);
  local.push(head, fileName, packed);
  const dir = Buffer.alloc(46);
  dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(0x031e, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(0x0800, 8); dir.writeUInt16LE(8, 10);
  dir.writeUInt32LE(0, 12); dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(packed.length, 20); dir.writeUInt32LE(data.length, 24);
  dir.writeUInt16LE(fileName.length, 28); dir.writeUInt32LE((0o100644 << 16) >>> 0, 38); dir.writeUInt32LE(offset, 42);
  central.push(dir, fileName);
  offset += head.length + fileName.length + packed.length;
 }
 const size = central.reduce((t, b) => t + b.length, 0), end = Buffer.alloc(22);
 end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
 end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16);
 return Buffer.concat([...local, ...central, end]);
}
const out = zip(files);
await fs.writeFile('dist/Optical_Workbench.mcpb', out);
console.log(`Built dist/Optical_Workbench.mcpb (${(out.length / 2 ** 20).toFixed(1)} MB, ${tools.length} tools).`);
