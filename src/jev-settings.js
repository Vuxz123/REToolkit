import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fingerprint,withWorkspaceLock} from './state.js';
import {assertAssetPath} from './assets/context.js';
import {TYPESAFE_ENDPOINT,runJevRequest} from './jev.js';
const MAX_SETTINGS_BYTES=16384;
export const DEFAULT_JEV_SETTINGS=Object.freeze({kind:'retoolkit-jev-settings',schemaVersion:1,endpoint:TYPESAFE_ENDPOINT,model:'jev-latest',apiKeyEnv:'TYPESAFE_API_KEY'});
const error=(code,message)=>Object.assign(new Error(message),{code});
const invalid=()=>error('jev_settings_invalid','Invalid Jev settings; use the supported endpoint, model, and an environment-variable reference only.');
export function validateJevSettings(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Object.keys(value).length!==5||Object.keys(value).some(k=>!Object.hasOwn(DEFAULT_JEV_SETTINGS,k))||value.kind!==DEFAULT_JEV_SETTINGS.kind||value.schemaVersion!==1||value.endpoint!==TYPESAFE_ENDPOINT||typeof value.model!=='string'||!/^[A-Za-z0-9._-]{1,128}$/.test(value.model)||typeof value.apiKeyEnv!=='string'||!/^(TYPESAFE|JEV)_[A-Z][A-Z0-9_]{0,95}$/.test(value.apiKeyEnv))throw invalid();
 return {kind:value.kind,schemaVersion:1,endpoint:value.endpoint,model:value.model,apiKeyEnv:value.apiKeyEnv};
}
function settingsPath(root){if(typeof root!=='string'||!root)throw invalid();return assertAssetPath(path.join(path.resolve(root),'config/jev.json'));}
/** Fatal UTF-8, a regular descriptor and bounded reads avoid echoing malformed secrets. */
export function readJevSettingsRequest(file){
 assertAssetPath(file);let fd;
 try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.size>MAX_SETTINGS_BYTES)throw invalid();fd=fs.openSync(file,'r');if(!fs.fstatSync(fd).isFile())throw invalid();const bytes=Buffer.alloc(MAX_SETTINGS_BYTES+1);let count=0,n;while(count<=MAX_SETTINGS_BYTES&&(n=fs.readSync(fd,bytes,count,bytes.length-count,null))>0)count+=n;if(count>MAX_SETTINGS_BYTES)throw invalid();return validateJevSettings(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,count)).replace(/^\uFEFF/,'')));}
 catch(e){if(e.code==='ENOENT')throw error('ENOENT','Jev settings file does not exist.');throw invalid();}finally{if(fd!==undefined)fs.closeSync(fd);}
}
function authentication(settings,env){const value=env[settings.apiKeyEnv];return {environmentVariable:settings.apiKeyEnv,present:typeof value==='string'&&value.length>0,valid:typeof value==='string'&&/^[\x21-\x7e]{1,8192}$/.test(value)};}
export function loadJevSettings(root,{env=process.env}={}){
 const file=settingsPath(root);let settings,configured=true;try{settings=readJevSettingsRequest(file);}catch(e){if(e.code!=='ENOENT')throw e;settings={...DEFAULT_JEV_SETTINGS};configured=false;}
 return {kind:'retoolkit-jev-settings-status',schemaVersion:1,configured,settings,settingsSha256:fingerprint(settings),authentication:authentication(settings,env),storedSettings:'config/jev.json',network:'not-sent'};
}
export async function saveJevSettings(root,value,{env=process.env}={}){
 const settings=validateJevSettings(value),file=settingsPath(root),directory=assertAssetPath(path.dirname(file));
 return withWorkspaceLock(directory,async()=>{
 assertAssetPath(file);if(fs.existsSync(file)&&!fs.lstatSync(file).isFile())throw invalid();const temporary=assertAssetPath(path.join(directory,'.jev-'+randomUUID()+'.tmp'));let fd;
 try{fd=fs.openSync(temporary,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(settings,null,2)+'\n');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;assertAssetPath(file);fs.renameSync(temporary,file);return loadJevSettings(root,{env});}
 finally{if(fd!==undefined)fs.closeSync(fd);fs.rmSync(temporary,{force:true});}
 });
}
function configuredKey(status,env){if(!status.authentication.present)throw error('jev_auth_missing','The configured Jev authentication environment variable is not set.');if(!status.authentication.valid)throw error('jev_auth_invalid','The configured Jev authentication environment variable has invalid header characters or length.');return env[status.settings.apiKeyEnv];}
function unchanged(root,before,env){const now=loadJevSettings(root,{env});if(now.configured!==before.configured||now.settingsSha256!==before.settingsSha256)throw error('jev_settings_stale','Jev settings changed during the operation; any sent request was not automatically retried.');}
/** Preserve the saved evidence body. A configured model change requires a new request. */
export async function runConfiguredJevRequest(root,request,{env=process.env,fetchImpl=fetch,timeoutMs=60000}={}){
 const status=loadJevSettings(root,{env});if(status.configured&&request?.model!==status.settings.model)throw error('jev_settings_mismatch','Saved request model differs from configured Jev model; build a new request instead of rewriting evidence.');
 const apiKey=configuredKey(status,env);const result=await runJevRequest(request,{apiKey,timeoutMs,fetchImpl:async(...args)=>{unchanged(root,status,env);return fetchImpl(...args);}});unchanged(root,status,env);return result;
}
const testRequest=model=>({model,state:{kind:'retoolkit-synthetic-connection-test',marker:'REToolkit synthetic connectivity probe'},questions:{connectivity:{type:'noul',instructions:'Does the state marker equal REToolkit synthetic connectivity probe?'}}});
const failureMessages={jev_auth_missing:'The configured authentication environment variable is not set.',jev_auth_invalid:'The configured authentication environment variable is invalid.',jev_auth_failed:'TypeSafe rejected authentication.',jev_request_too_large:'TypeSafe rejected request size.',jev_validation_failed:'TypeSafe rejected the synthetic request or model.',jev_rate_limited:'TypeSafe rate limit reached; retry explicitly.',jev_overloaded:'TypeSafe is overloaded; retry explicitly.',jev_http_error:'TypeSafe returned an HTTP error.',jev_response_invalid:'TypeSafe returned an invalid typed response.',jev_connection_failed:'The TypeSafe connection failed; retry explicitly.',jev_timeout:'The TypeSafe connection test timed out; retry explicitly.',jev_settings_stale:'Jev settings changed during the test; retry explicitly.'};
export async function testJevSettings(root,{env=process.env,fetchImpl=fetch,timeoutMs=10000}={}){
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw error('jev_settings_invalid','Jev connection test timeout must be 1..30000ms.');const status=loadJevSettings(root,{env});
 const result={kind:'retoolkit-jev-connection-test',schemaVersion:1,settingsSha256:status.settingsSha256,endpoint:status.settings.endpoint,model:status.settings.model,authentication:status.authentication,content:'synthetic-only',gameContentSent:false,automaticRetries:0,ok:false,authenticationVerified:false,typedResponseVerified:false,network:'not-sent'};
 try{configuredKey(status,env);result.network='attempted';const response=await runConfiguredJevRequest(root,testRequest(status.settings.model),{env,fetchImpl,timeoutMs});return {...result,ok:true,state:'connected',authenticationVerified:true,typedResponseVerified:true,network:'sent',usage:{input_tokens:response.usage.input_tokens,output_tokens:response.usage.output_tokens}};}
 catch(e){const code=Object.hasOwn(failureMessages,e.code)?e.code:'jev_connection_failed';return {...result,state:result.network==='not-sent'?'blocked':'failed',error:{code,message:failureMessages[code]}};}
}
