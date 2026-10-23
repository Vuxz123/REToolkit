import {createAdbClient,resolveAdbPath} from './client.js';
const serial={type:'string',minLength:1,maxLength:255,pattern:'^[A-Za-z0-9_][A-Za-z0-9_.:\\[\\]-]*$'},packageName={type:'string',minLength:1,maxLength:255,pattern:'^[A-Za-z][A-Za-z0-9_]*(?:\\.[A-Za-z][A-Za-z0-9_]*)+$'};
export const adbDefinitions={
 'adb.devices':{properties:{}},
 'adb.packages':{properties:{serial},required:['serial']},
 'adb.capture':{properties:{serial,packageName,binary:{type:'string',minLength:1,maxLength:4096},metadata:{type:'string',minLength:1,maxLength:4096}},required:['serial','packageName']},
};
export async function runAdbOperation(toolkit,name,method,params){
 if(method==='adb.capture'){
  const {packageName,...options}=params,result=await toolkit.pullLdPlayer(name,packageName,{...options,skipLaunch:true,includeData:true});
  const {files,...capture}=result.capture??{};
  return {kind:result.kind,schemaVersion:result.schemaVersion??1,state:result.state,capture:{...capture,files:files?.length??0},project:result.project?{name:result.project.name,platform:result.project.platform}:undefined,notice:result.notice};
 }
 const file=resolveAdbPath(undefined,{env:toolkit.env}),client=createAdbClient({file,run:toolkit.run,runOptions:{cwd:toolkit.root,env:toolkit.env,toolchainRoot:toolkit.root}});
 if(method==='adb.devices')return {kind:'retoolkit-adb-devices',schemaVersion:1,devices:await client.devices()};
 const serial=await client.selectDevice(params.serial);return {kind:'retoolkit-adb-packages',schemaVersion:1,serial,packages:await client.packages(serial)};
}
