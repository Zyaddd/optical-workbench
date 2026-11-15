import './build-pages.mjs';
import {readFile,writeFile} from 'node:fs/promises';
const workbench = await readFile('dist/Optical_Workbench.html','utf8');
const homepage = await readFile('dist/index.html','utf8');
await Promise.all([
 writeFile('dist/Account_Workbench.html',workbench.replace('<head>','<head><meta name="workbench-accounts" content="enabled">')),
 writeFile('dist/Accounts.html',homepage.replace('href="./Optical_Workbench.html">Launch workbench','href="./Account_Workbench.html">Launch workbench').replace('</nav>','</nav><p>Create an account in the workbench to save projects and reopen them from another device.</p>')),
]);
