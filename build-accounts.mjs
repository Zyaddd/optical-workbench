import './build-pages.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {landingHtml,accountHomepage} from './build-landing.mjs';
const workbench = await readFile('dist/Optical_Workbench.html','utf8');
const homepage = await landingHtml();
await Promise.all([
 writeFile('dist/Account_Workbench.html',workbench.replace('<head>','<head><meta name="workbench-accounts" content="enabled">')),
 writeFile('dist/Accounts.html',accountHomepage(homepage)),
]);
