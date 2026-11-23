// The landing page: web/index.html with the live 3D bench (src/landing.mjs) bundled inline.
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';

export async function landingHtml() {
 const result = await build({entryPoints:['src/landing.mjs'], bundle:true, write:false, format:'iife', minify:true, target:['chrome100', 'edge100', 'safari15', 'firefox100'], legalComments:'inline'});
 const script = result.outputFiles[0].text.replace(/<\/script/gi, '<\/script');
 return (await readFile('web/index.html', 'utf8')).replace('__LANDING_JS__', () => script);
}

// Points every "Launch workbench" button at the account edition and shows the account copy.
export function accountHomepage(html, href = './Account_Workbench.html') {
 const launches = html.split('data-launch href="./Optical_Workbench.html"').length - 1;
 if (!launches || !html.includes('data-guest hidden') || !html.includes('data-accounts hidden')) throw Error('Landing page markup changed: account hooks not found.');
 return html
  .replaceAll('data-launch href="./Optical_Workbench.html"', `data-launch href="${href}"`)
  .replaceAll('data-guest hidden', 'data-guest')
  .replaceAll('data-accounts hidden', 'data-accounts')
  .replaceAll('data-no-accounts', 'data-no-accounts hidden');
}
