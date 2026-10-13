import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createBridge, digest } from '../netlify/lib/bridge.mjs';

const base = 'https://casa-universal.netlify.app';
const env = {CASA_PUBLIC_URL:base,CASA_BRIDGE_TOKEN:'B'.repeat(43),CASA_OAUTH_SECRET:'S'.repeat(43),CASA_PAIRING_HASH:digest('test-pairing-key')};
class Store {
  entries = new Map(); sequence = 0;
  async get(key) { return structuredClone(this.entries.get(key)?.data ?? null); }
  async getWithMetadata(key) { return structuredClone(this.entries.get(key) ?? null); }
  async setJSON(key,data,options = {}) {
    const old = this.entries.get(key);
    if (options.onlyIfNew && old || options.onlyIfMatch && options.onlyIfMatch !== old?.etag) return {modified:false};
    const etag = `${++this.sequence}`;this.entries.set(key,{data:structuredClone(data),etag});return {modified:true,etag};
  }
}
function setup() {
  const store = new Store();let clock = Date.now(), onWait;
  const handle = createBridge({env,store,now:() => clock,wait:async ms => {clock += ms;if(onWait) await onWait();}});
  const request = (path,method='GET',value,headers={}) => handle(new Request(base+path,{method,headers:{'Content-Type':typeof value==='string'?'application/x-www-form-urlencoded':'application/json',...headers},body:value===undefined?undefined:typeof value==='string'?value:JSON.stringify(value)}),{ip:'test'});
  const bridgeHeaders = {Authorization:`Bearer ${env.CASA_BRIDGE_TOKEN}`};
  const rpc = async (token,method,params) => {
    const response=await request('/mcp','POST',{jsonrpc:'2.0',id:1,method,params},{Authorization:`Bearer ${token}`});
    if(response.status!==200&&token!==env.CASA_BRIDGE_TOKEN&&method==='tools/call') assert.fail(`${response.status}: ${await response.text()}`);
    return response;
  };
  async function authorize(control = false) {
    const clientResponse = await request('/oauth/register','POST',{client_name:'ChatGPT',redirect_uris:['https://chatgpt.com/connector_platform/oauth_callback'],token_endpoint_auth_method:'none'});
    assert.equal(clientResponse.status,201);const client = await clientResponse.json();
    const verifier = 'v'.repeat(43),challenge = createHash('sha256').update(verifier).digest('base64url');
    const params = new URLSearchParams({client_id:client.client_id,redirect_uri:client.redirect_uris[0],response_type:'code',code_challenge_method:'S256',code_challenge:challenge,resource:base+'/mcp',state:'client-csrf',scope:'casa:read casa:control'});
    const login = await request('/oauth/authorize?'+params);assert.equal(login.status,200);
    assert.equal(login.headers.get('Referrer-Policy'),'same-origin');
    const html = await login.text(), signed = html.match(/name="request" value="([^"]+)"/)[1],cookie=login.headers.get('Set-Cookie').split(';')[0];
    const form = new URLSearchParams({request:signed,key:'test-pairing-key',...(control?{control:'yes'}:{})}).toString();
    const approval = await request('/oauth/authorize','POST',form,{Origin:base,Cookie:cookie});assert.equal(approval.status,303);
    const redirect = new URL(approval.headers.get('Location'));assert.equal(redirect.searchParams.get('state'),'client-csrf');
    const tokenBody = new URLSearchParams({grant_type:'authorization_code',code:redirect.searchParams.get('code'),client_id:client.client_id,redirect_uri:client.redirect_uris[0],code_verifier:verifier,resource:base+'/mcp'}).toString();
    const response = await request('/oauth/token','POST',tokenBody);assert.equal(response.status,200);
    return {tokens:await response.json(),client,tokenBody,form,cookie};
  }
  const call=(token,name,args)=>rpc(token,'tools/call',{name,arguments:args});
  return {store,request,rpc,call,bridgeHeaders,authorize,advance:ms=>clock+=ms,onWait:fn=>onWait=fn};
}

test('missing deployment secrets fail closed and expose no tools or queue',async () => {
  const handle = createBridge({env:{},store:new Store()});
  assert.equal((await handle(new Request(base+'/mcp',{method:'POST'}))).status,503);
});
test('MCP and device bridge require different credentials; metadata supplies OAuth discovery',async () => {
  const s=setup();const response=await s.request('/mcp','POST',{});
  assert.equal(response.status,401);assert.match(response.headers.get('WWW-Authenticate'),/oauth-protected-resource\/mcp/);
  assert.equal((await s.request('/bridge/poll','POST',{})).status,401);
  const {tokens}=await s.authorize();
  assert.equal((await s.request('/bridge/poll','POST',{}, {Authorization:`Bearer ${tokens.access_token}`})).status,401);
  assert.equal((await s.rpc(env.CASA_BRIDGE_TOKEN,'tools/list',{})).status,401);
  assert.equal((await s.request('/.well-known/oauth-protected-resource/mcp')).status,200);
});
test('OAuth rejects external redirect destinations, wrong resource and missing PKCE',async () => {
  const s=setup();assert.equal((await s.request('/oauth/register','POST',{redirect_uris:['https://evil.example/callback']})).status,400);
  const {client}=await s.authorize();
  const params=new URLSearchParams({client_id:client.client_id,redirect_uri:client.redirect_uris[0],response_type:'code',state:'s',resource:base+'/mcp'});
  assert.equal((await s.request('/oauth/authorize?'+params)).status,400);
  params.set('code_challenge_method','S256');params.set('code_challenge','a'.repeat(43));params.set('resource','https://evil.example/mcp');
  assert.equal((await s.request('/oauth/authorize?'+params)).status,400);
});
test('consent is bound to browser cookie and same origin; authorization code is single use',async () => {
  const s=setup(),auth=await s.authorize();
  assert.equal((await s.request('/oauth/authorize','POST',auth.form,{Origin:base})).status,401);
  assert.equal((await s.request('/oauth/authorize','POST',auth.form,{Origin:'https://evil.example',Cookie:auth.cookie})).status,403);
  for (const origin of [null,'null']) {
    const rejected=await s.request('/oauth/authorize','POST',auth.form,{...(origin===null?{}:{Origin:origin}),Cookie:auth.cookie});
    assert.equal(rejected.status,403);
    assert.equal(rejected.headers.get('Content-Type'),'application/json; charset=utf-8');
    assert.equal((await rejected.json()).error,'Origem inválida.');
  }
  assert.equal((await s.request('/oauth/token','POST',auth.tokenBody)).status,400);
});
test('query-only consent cannot enqueue a command and accepts supported read tools',async () => {
  const s=setup(),{tokens}=await s.authorize();
  const result=await (await s.call(tokens.access_token,'controlar_dispositivo',{device_id:'tv',action:'power'})).json();
  assert.equal(result.result.isError,true);assert.match(result.result.content[0].text,/somente para consultas/);assert.equal(await s.store.get('pending'),null);
  assert.equal((await (await s.rpc(tokens.access_token,'tools/list',{})).json()).result.tools.length,5);
});
test('offline central, arbitrary arguments and unlock never create a pending command',async () => {
  const s=setup(),{tokens}=await s.authorize(true);
  for(const args of [{device_id:'tv',action:'power'},{device_id:'tv',action:'power',ip:'127.0.0.1'},{device_id:'lock',action:'unlock'}]){
    assert.equal((await (await s.call(tokens.access_token,'controlar_dispositivo',args)).json()).result.isError,true);assert.equal(await s.store.get('pending'),null);
  }
});
test('queue claims atomically once and waits for real result instead of assuming success',async () => {
  const s=setup(),{tokens}=await s.authorize(true);await s.request('/bridge/poll','POST',{},s.bridgeHeaders);
  let deliveries=0;
  s.onWait(async()=>{
    const responses=await Promise.all([s.request('/bridge/poll','POST',{},s.bridgeHeaders),s.request('/bridge/poll','POST',{},s.bridgeHeaders)]);
    const jobs=await Promise.all(responses.map(r=>r.json()));assert.equal(jobs.filter(v=>v.job).length,1);
    const job=jobs.find(v=>v.job).job;deliveries++;
    const result={isError:false,content:[{type:'text',text:'{"sent":true}'}],structuredContent:{sent:true}};
    assert.equal((await s.request('/bridge/result','POST',{id:job.id,result},s.bridgeHeaders)).status,200);s.onWait(undefined);
  });
  const result=await (await s.call(tokens.access_token,'controlar_dispositivo',{device_id:'tv',action:'volume_up'})).json();
  assert.equal(result.result.structuredContent.sent,true);assert.equal(deliveries,1);
  assert.equal((await (await s.request('/bridge/poll','POST',{},s.bridgeHeaders)).json()).job,null);
});
test('queued commands which time out unclaimed cannot execute after reconnection',async () => {
  const s=setup(),{tokens}=await s.authorize(true);await s.request('/bridge/poll','POST',{},s.bridgeHeaders);
  const response=await (await s.call(tokens.access_token,'controlar_dispositivo',{device_id:'tv',action:'power'})).json();
  assert.match(response.result.content[0].text,/cancelado sem execução/);
  assert.equal((await (await s.request('/bridge/poll','POST',{},s.bridgeHeaders)).json()).job,null);
});
test('executing command timeout reports uncertainty and never delivers the same job twice',async () => {
  const s=setup(),{tokens}=await s.authorize(true);await s.request('/bridge/poll','POST',{},s.bridgeHeaders);
  let claimed;
  s.onWait(async()=>{claimed=await (await s.request('/bridge/poll','POST',{},s.bridgeHeaders)).json();s.onWait(undefined);});
  const response=await (await s.call(tokens.access_token,'controlar_dispositivo',{device_id:'tv',action:'power'})).json();
  assert.ok(claimed.job);assert.match(response.result.content[0].text,/Não repita automaticamente/);
  assert.equal((await (await s.request('/bridge/poll','POST',{},s.bridgeHeaders)).json()).job,null);
});
test('refresh token rotates; replay and expired access tokens are rejected',async () => {
  const s=setup(),{tokens,client}=await s.authorize();
  const form=new URLSearchParams({grant_type:'refresh_token',refresh_token:tokens.refresh_token,client_id:client.client_id,resource:base+'/mcp'}).toString();
  const refresh=await s.request('/oauth/token','POST',form);assert.equal(refresh.status,200);assert.notEqual((await refresh.json()).refresh_token,tokens.refresh_token);
  assert.equal((await s.request('/oauth/token','POST',form)).status,400);
  s.advance(601000);assert.equal((await s.rpc(tokens.access_token,'tools/list',{})).status,401);
});
