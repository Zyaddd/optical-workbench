import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudTransport} from '../src/cloud-accounts.mjs';
import {cloudAccountPages} from '../build-cloud.mjs';

const memoryStorage = () => {
 const map = new Map();
 return {getItem:k=>map.get(k) ?? null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k),map};
};

test('cloud transport maps account calls to Supabase functions and keeps the session token', async () => {
 const calls = [], replies = [];
 const fetch = async (url, options) => {
  calls.push({url,options,body:JSON.parse(options.body)});
  const [status, data] = replies.shift();
  return {ok:status < 400,status,json:async()=>data};
 };
 const storage = memoryStorage();
 const api = createCloudTransport({url:'https://demo.supabase.co/',key:'anon-key-1234567890',storage,fetch});
 assert.deepEqual(await api('session'),{username:null});
 assert.equal(calls.length,0);

 replies.push([200,{username:'Ada',token:'t1'}]);
 assert.deepEqual(await api('signup','POST',{username:'Ada',password:'eightabc'}),{username:'Ada'});
 assert.equal(calls[0].url,'https://demo.supabase.co/rest/v1/rpc/workbench_signup');
 assert.equal(calls[0].options.headers.apikey,'anon-key-1234567890');
 assert.deepEqual(calls[0].body,{p_username:'Ada',p_password:'eightabc',p_previous:null});
 assert.equal(storage.map.get('ow_cloud_session'),'t1');

 replies.push([200,{projects:[]}]);
 await api('projects','GET',undefined,'Ada');
 assert.deepEqual(calls[1].body,{p_token:'t1',p_expected:'Ada'});

 const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
 replies.push([200,{id,revision:2}]);
 await api('projects/'+id,'PUT',{project:{name:'x'},revision:1},'Ada');
 assert.match(calls[2].url,/workbench_save_project$/);
 assert.deepEqual(calls[2].body,{p_token:'t1',p_id:id,p_project:{name:'x'},p_revision:1,p_expected:'Ada'});

 replies.push([200,{status:401,error:'Sign in to access your saved projects.'}]);
 await assert.rejects(api('projects/'+id,'DELETE',undefined,'Ada'),e=>e.status===401 && /Sign in/.test(e.message));

 replies.push([413,{message:'Payload Too Large'}]);
 await assert.rejects(api('projects','POST',{project:{}}),e=>e.status===413 && /too large/.test(e.message));

 replies.push([200,{username:null}]);
 assert.deepEqual(await api('session'),{username:null});
 assert.equal(storage.map.has('ow_cloud_session'),false);

 const offline = createCloudTransport({url:'https://demo.supabase.co',key:'k',storage,fetch:async()=>{throw TypeError('fetch failed');}});
 storage.setItem('ow_cloud_session','t2');
 await assert.rejects(offline('projects'),e=>e.status===0 && /internet connection/.test(e.message));
 assert.deepEqual(await offline('logout','POST').catch(()=>'rejected'),'rejected');
 assert.equal(storage.map.has('ow_cloud_session'),false);
});

test('cloud build adds the account meta tag only with a valid public key', () => {
 assert.equal(cloudAccountPages({}),null);
 assert.throws(()=>cloudAccountPages({url:'https://demo.supabase.co'}),/both/);
 assert.throws(()=>cloudAccountPages({url:'http://demo.supabase.co',key:'sb_publishable_abcdefghijklmnop'}),/https/);
 assert.throws(()=>cloudAccountPages({url:'https://demo.supabase.co',key:'sb_secret_abcdefghijklmnopqrs'}),/never the service_role/);
 const serviceJwt = ['e30',Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url'),'sig'].join('.');
 assert.throws(()=>cloudAccountPages({url:'https://demo.supabase.co',key:serviceJwt}),/never the service_role/);
 const pages = cloudAccountPages({url:'https://demo.supabase.co/',key:'sb_publishable_abcdefghijklmnop'});
 assert.equal(pages.workbench('<html><head><title>x</title>'),'<html><head><meta name="workbench-accounts" content="cloud" data-supabase-url="https://demo.supabase.co" data-supabase-key="sb_publishable_abcdefghijklmnop"><title>x</title>');
 const home = pages.homepage('<nav><a class="primary" href="./Optical_Workbench.html">Launch workbench</a></nav>');
 assert.match(home,/href="\.\/Account_Workbench\.html">Launch workbench/);
 assert.match(home,/Use without an account/);
});
