// Turns the static workbench and landing page into the Supabase account edition.
const escape = value => value.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');

export function cloudAccountPages({url, key}) {
 if (!url && !key) return null;
 if (!url || !key) throw Error('Set both SUPABASE_URL and SUPABASE_ANON_KEY, or neither.');
 const parsed = new URL(url);
 if (parsed.protocol !== 'https:' || parsed.pathname.replace(/\/+$/,'') !== '' || parsed.search || parsed.hash) throw Error('SUPABASE_URL must be the https project address, such as https://abcd.supabase.co');
 if (!/^[A-Za-z0-9._-]{20,1000}$/.test(key)) throw Error('SUPABASE_ANON_KEY does not look like a Supabase anon or publishable key.');
 if (/service_role|^sb_secret_/.test(key) || jwtRole(key) === 'service_role') throw Error('Use the anon or publishable key, never the service_role or secret key.');
 const meta = `<meta name="workbench-accounts" content="cloud" data-supabase-url="${escape(parsed.origin)}" data-supabase-key="${escape(key)}">`;
 return {
  workbench: html => replaceOnce(html,'<head>',`<head>${meta}`),
  homepage: html => replaceOnce(
   replaceOnce(html,'<a class="primary" href="./Optical_Workbench.html">Launch workbench</a>','<a class="primary" href="./Account_Workbench.html">Launch workbench</a>\n<a href="./Optical_Workbench.html">Use without an account</a>'),
   '</nav>','</nav>\n<p>Create a free account in the workbench with a username and password. Your saved projects then open from any computer under <strong>My projects</strong>.</p>'),
 };
}

function jwtRole(key) {
 try {return JSON.parse(Buffer.from(key.split('.')[1] ?? '','base64url').toString('utf8')).role;}
 catch {return undefined;}
}
function replaceOnce(text, find, replacement) {
 if (!text.includes(find)) throw Error('Expected markup not found: ' + find);
 return text.replace(find,() => replacement);
}
