import {loadJevSettings,saveJevSettings,testJevSettings} from '../jev-settings.js';
import {withoutJevCredentials,snapshotJevEnvironment} from '../jev-environment.js';
export function createSettingsController(root,{env=process.env,load=loadJevSettings,save=saveJevSettings,test=testJevSettings,canModify=()=>true}={}){
 let active=false,sessionKey;
 const effectiveEnvironment=()=>({...snapshotJevEnvironment(env),...(sessionKey?{[sessionKey.name]:sessionKey.value}:{})});
 const get=()=>load(root,{env:effectiveEnvironment()});
 const jevEnvironment=()=>{const effective=effectiveEnvironment(),name=get().settings.apiKeyEnv,result=withoutJevCredentials(effective);if(effective[name]!==undefined)result[name]=effective[name];return result;};
 function claim(){if(active||!canModify())throw Error('Wait for the current task before changing or testing Jev settings');active=true;}
 return {get,jevEnvironment,busy:()=>active,async save(payload){claim();try{
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some(k=>!['settings','apiKey'].includes(k))||Buffer.byteLength(JSON.stringify(payload))>16384)throw Error('Invalid Jev settings payload');
  const {settings,apiKey}=payload;if(!/^(TYPESAFE|JEV)_[A-Z][A-Z0-9_]{0,95}$/.test(settings?.apiKeyEnv??'')||apiKey!==undefined&&(typeof apiKey!=='string'||apiKey.length<1||apiKey.length>4096||/[\x00-\x20\x7f]/.test(apiKey)))throw Error('Invalid Jev key environment reference or session key');
  await save(root,settings,{env:effectiveEnvironment()});if(apiKey!==undefined)sessionKey={name:settings.apiKeyEnv,value:apiKey};return get();
 }finally{active=false;}},async test(){claim();try{return await test(root,{env:effectiveEnvironment()});}finally{active=false;}}};
}
