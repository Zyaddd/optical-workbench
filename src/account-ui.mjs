import {AccountError, createCloudTransport} from './cloud-accounts.mjs';

const accountMeta = () => document.querySelector('meta[name="workbench-accounts"]');
export const accountsEnabled = () => location.protocol !== 'file:' && !!accountMeta();

// The account server edition talks to /api on its own origin.
async function serverTransport(path, method = 'GET', body, expected) {
 const headers = {};
 if (expected) headers['X-Workbench-Account'] = expected;
 if (body !== undefined) headers['Content-Type'] = 'application/json';
 const response = await fetch(`/api/${path}`,{method,headers,credentials:'same-origin',cache:'no-store',body:body === undefined ? undefined : JSON.stringify(body)});
 const data = await response.json();
 if (!response.ok) throw new AccountError(response.status,data.error || 'Request failed.');
 return data;
}

export function mountAccountUI({projectData, openProject, hasWorkspace, toast}) {
 const meta = accountMeta();
 const cloud = meta?.content === 'cloud';
 const transport = cloud ? createCloudTransport({url:meta.dataset.supabaseUrl,key:meta.dataset.supabaseKey}) : serverTransport;
 let username = null;
 let current = null;
 let workspaceRevision = 0;
 let busy = false;
 let signup = false;
 const dialog = document.createElement('dialog');
 dialog.className = 'accountDialog';
 dialog.setAttribute('aria-labelledby','accountTitle');
 dialog.innerHTML = `
  <form method="dialog"><button class="close" aria-label="Close dashboard">×</button></form>
  <h2 id="accountTitle">My projects</h2>
  <p data-account-status role="status" aria-live="polite"></p>
  <form data-auth>
   <p data-auth-intro>Sign in to open your saved projects.</p>
   <label>Username<input name="username" autocomplete="username" required minlength="3" maxlength="32" pattern="[A-Za-z0-9_]{3,32}"></label>
   <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
   <div class="actionRow"><button class="primary" data-auth-submit>Sign in</button><button type="button" data-auth-switch>Create account</button></div>
  </form>
  <section data-dashboard hidden>
   <p data-account-user></p>
   <div class="actionRow"><button data-save-copy>Save a copy of current layout</button><button data-signout>Sign out</button></div>
   <ul data-project-list aria-label="Saved projects"></ul>
  </section>`;
 document.body.append(dialog);
 const find = selector => dialog.querySelector(selector);
 const status = find('[data-account-status]'), auth = find('[data-auth]');
 const dashboard = find('[data-dashboard]'), list = find('[data-project-list]');
 const nav = document.querySelector('.accountActions');
 const dashboardButton = document.createElement('button');
 dashboardButton.textContent = 'My projects';
 const saveButton = document.createElement('button');
 saveButton.textContent = 'Save to account';
 saveButton.className = 'primary';
 nav.append(dashboardButton,saveButton);

 async function api(path, method = 'GET', body) {
  const expected = username && path.startsWith('projects') ? username : undefined;
  try {return await transport(path,method,body,expected);}
  catch (error) {
   if (error.status === 401 && !['login','signup'].includes(path)) {
    username = null;
    current = null;
    renderAccount();
   }
   throw error;
  }
 }
 function renderAccount() {
  auth.hidden = !!username;
  dashboard.hidden = !username;
  find('[data-account-user]').textContent = username ? `Signed in as ${username}` : '';
  if (!username) list.replaceChildren();
 }
 function renderAuthMode() {
  find('[data-auth-intro]').textContent = signup
   ? 'Choose a username and a password of at least 8 characters. There is no password reset, so keep your password somewhere safe.'
   : 'Sign in to open your saved projects.';
  auth.elements.password.minLength = signup ? 8 : 1;
  auth.elements.password.autocomplete = signup ? 'new-password' : 'current-password';
  auth.elements.password.value = '';
  find('[data-auth-submit]').textContent = signup ? 'Create account' : 'Sign in';
  find('[data-auth-switch]').textContent = signup ? 'I already have an account' : 'Create account';
 }
 async function run(work, message) {
  if (busy) return;
  busy = true;
  saveButton.disabled = true;
  dialog.setAttribute('aria-busy','true');
  status.textContent = message ?? '';
  try {await work();}
  catch(error) {
   status.textContent = error.message;
   if (!dialog.open) toast(error.message);
  } finally {
   busy = false;
   saveButton.disabled = false;
   dialog.removeAttribute('aria-busy');
  }
 }
 async function refreshProjects() {
  const {projects} = await api('projects');
  list.replaceChildren();
  if (!projects.length) {
   const empty = document.createElement('li');
   empty.textContent = 'No saved projects yet. Use Save to account when your layout is ready.';
   list.append(empty);
  }
  for (const p of projects) {
   const row = document.createElement('li');
   const title = document.createElement('strong');
   title.textContent = p.name;
   const date = document.createElement('time');
   date.dateTime = p.updatedAt;
   date.textContent = new Date(p.updatedAt).toLocaleString();
   const open = document.createElement('button');
   open.textContent = 'Open';
   open.setAttribute('aria-label',`Open ${p.name}`);
   open.onclick = () => run(async()=>{
    const record = await api(`projects/${p.id}`);
    if (!openProject(record.project)) {status.textContent='';return;}
    current = record;
    dialog.close();
    toast('Opened account project.');
   },'Opening project…');
   const remove = document.createElement('button');
   remove.textContent = 'Delete';
   remove.setAttribute('aria-label',`Delete ${p.name}`);
   remove.onclick = () => {
    if (!confirm(`Delete “${p.name}” from your account?`)) return;
    void run(async()=>{
     await api(`projects/${p.id}`,'DELETE');
     if (p.id === current?.id) current = null;
     await refreshProjects();
     status.textContent = 'Project deleted.';
    },'Deleting project…');
   };
   const buttons = document.createElement('div');
   buttons.className = 'actionRow';
   buttons.append(open,remove);
   row.append(title,date,buttons);
   list.append(row);
  }
 }
 async function show() {
  if (!dialog.open) dialog.showModal();
  const session = await api('session');
  if (session.username !== username) current = null;
  username = session.username;
  renderAccount();
  if (username) await refreshProjects();
  status.textContent = '';
 }
 async function save(copy) {
  if (!username) {
   await show();
   if (!username) {status.textContent='Sign in, then choose Save to account.';return;}
  }
  const existing = copy ? null : current;
  const revision = workspaceRevision;
  const project = projectData();
  const saved = await api(existing ? `projects/${existing.id}`:'projects',existing?'PUT':'POST',{project,revision:existing?.revision});
  if (revision === workspaceRevision) current = saved;
  toast('Project saved to your account.');
  if (dialog.open) await refreshProjects();
  status.textContent = 'Project saved.';
 }
 dashboardButton.onclick = () => run(show,'Loading account…');
 saveButton.onclick = () => run(()=>save(false),'Saving project…');
 find('[data-save-copy]').onclick = () => run(()=>save(true),'Saving a copy…');
 find('[data-signout]').onclick = () => {
  if (hasWorkspace() && !confirm('Signing out will close this workspace. Save or download any changes you want to keep first. Sign out?')) return;
  void run(async()=>{await api('logout','POST');location.reload();},'Signing out…');
 };
 find('[data-auth-switch]').onclick = () => {if (!busy) {signup=!signup;status.textContent='';renderAuthMode();}};
 auth.onsubmit = event => {
  event.preventDefault();
  void run(async()=>{
   const credentials = Object.fromEntries(new FormData(auth));
   auth.elements.password.value = '';
   const session = await api(signup?'signup':'login','POST',credentials);
   username = session.username;
   current = null;
   renderAccount();
   await refreshProjects();
   status.textContent = 'Signed in.';
  },signup?'Creating account…':'Signing in…');
 };
 return {clearProject:()=>{current=null;workspaceRevision++;}};
}
