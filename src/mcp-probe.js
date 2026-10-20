import {spawn} from 'node:child_process';
import {acquireToolchainRead} from './toolchain/lease.js';
import {prepareMcpCommand} from './python-runtime/launcher.js';

const MAX_FRAME=1024*1024;
const safeText=value=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,'').slice(0,256):null;
const failure=(code,message)=>Object.assign(new Error(message),{code});

// This probe owns only its stdio child. It never connects/switches a GUI instance,
// invokes target-content tools, or terminates the JVM behind the bridge.
export async function probeMcp(toolkit,{project,program,timeoutMs=10000,launch,spawnImpl=spawn}={}) {
  if(!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw Error('MCP probe timeout must be 1..30000ms');
  const evidence={tools:[],instances:[]};
  const limitations=['Discovery names do not verify a Program executable hash.','The probe starts a separate bridge; its discovery may clean stale discovery sockets.'];
  const outcome=(state,code,message)=>({state,code,message,evidence,limitations});
  let child,timer,pending,lease,closed=false,buffer=Buffer.alloc(0),total=0,nextId=0;
  let terminal;
  const fail=error=>{terminal??=error;if(pending){const current=pending;pending=null;current.reject(error);}};
  const deadline=Date.now()+timeoutMs;
  try {
    lease=acquireToolchainRead(toolkit.root);
    const command=launch??await prepareMcpCommand(toolkit);
    try {child=spawnImpl(command.file,command.args??[],{cwd:toolkit.root,env:command.env??toolkit.env,windowsHide:true,stdio:['pipe','pipe','pipe'],shell:false});}
    catch {throw failure('MCP_BRIDGE_START_FAILED','The configured MCP bridge could not start.');}
    child.on('error',()=>fail(failure('MCP_BRIDGE_START_FAILED','The configured MCP bridge could not start.')));
    child.on('close',()=>{closed=true;fail(failure('MCP_BRIDGE_EXITED','The MCP bridge exited before discovery completed.'));});
    child.stdin.on('error',()=>fail(failure('MCP_BRIDGE_EXITED','The MCP bridge closed its input.')));
    // Drain but never retain or expose stderr: it can contain paths or secrets.
    child.stderr.on('data',()=>{});
    child.stdout.on('data',chunk=>{
      try {
        total+=chunk.length;if(total>4*MAX_FRAME)throw Error('output limit');
        buffer=Buffer.concat([buffer,chunk]);
        for(;;){
          const newline=buffer.indexOf(10);if(newline<0){if(buffer.length>MAX_FRAME)throw Error('frame limit');break;}
          if(newline>MAX_FRAME)throw Error('frame limit');
          const line=buffer.subarray(0,newline).toString('utf8');buffer=buffer.subarray(newline+1);if(!line.trim())continue;
          const response=JSON.parse(line);
          if(response?.jsonrpc!=='2.0')throw Error('invalid envelope');
          if(response.id===undefined){if(typeof response.method!=='string')throw Error('invalid notification');continue;}
          if(!pending||response.id!==pending.id)throw Error('unexpected response');
          if(response.error)throw failure('MCP_RPC_ERROR','The MCP bridge rejected a diagnostic request.');
          if(!response.result||typeof response.result!=='object')throw Error('missing result');
          const current=pending;pending=null;current.resolve(response.result);
        }
      }catch(error){fail(error.code?error:failure('MCP_PROTOCOL_ERROR','The MCP bridge returned invalid or excessive protocol output.'));}
    });
    const send=message=>child.stdin.write(JSON.stringify(message)+'\n');
    const request=(method,params)=>new Promise((resolve,reject)=>{
      if(terminal){reject(terminal);return;}
      const id=++nextId;pending={id,resolve,reject};send({jsonrpc:'2.0',id,method,params});
    });
    timer=setTimeout(()=>fail(failure('MCP_PROBE_TIMEOUT','The MCP discovery deadline expired.')),Math.max(1,deadline-Date.now()));
    const initialized=await request('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'retoolkit-doctor',version:'1'}});
    if(!initialized.serverInfo||typeof initialized.protocolVersion!=='string')throw failure('MCP_PROTOCOL_ERROR','The MCP initialize response is incomplete.');
    evidence.protocolVersion=safeText(initialized.protocolVersion);
    // FastMCP reports its SDK version here, which is not the bridge release.
    evidence.serverVersion=safeText(initialized.serverInfo.version)??'unknown';
    send({jsonrpc:'2.0',method:'notifications/initialized'});
    let cursor;let discovered=[];
    for(let page=0;page<8;page++){
      const listed=await request('tools/list',cursor?{cursor}:{});
      if(!Array.isArray(listed.tools)||listed.tools.length>4096)throw failure('MCP_PROTOCOL_ERROR','The MCP tool list is invalid or excessive.');
      discovered.push(...listed.tools);cursor=listed.nextCursor;
      if(!cursor)break;if(typeof cursor!=='string'||page===7)throw failure('MCP_PROTOCOL_ERROR','The MCP tool list exceeds the discovery bound.');
    }
    evidence.tools=discovered.map(tool=>safeText(tool?.name)).filter(Boolean);
    const discovery=discovered.find(tool=>tool.name==='list_instances');
    if(!discovery)return outcome('unknown','MCP_DISCOVERY_UNAVAILABLE','The bridge does not advertise list_instances discovery.');
    const schema=discovery.inputSchema;
    if(schema?.type!=='object'||(schema.required?.length??0)>0)return outcome('unknown','MCP_DISCOVERY_UNAVAILABLE','The advertised discovery schema requires unsupported arguments.');
    const listed=await request('tools/call',{name:discovery.name,arguments:{}});
    if(listed.isError)throw failure('MCP_RPC_ERROR','The discovery tool returned an error.');
    let instances=listed.structuredContent;
    if(typeof instances?.result==='string')try{instances=JSON.parse(instances.result);}catch{throw failure('MCP_PROTOCOL_ERROR','Instance discovery returned invalid wrapped JSON.');}
    if(!instances){const text=listed.content?.filter(item=>item.type==='text').map(item=>item.text).join('\n');try{instances=JSON.parse(text);}catch{throw failure('MCP_PROTOCOL_ERROR','Instance discovery did not return structured JSON.');}}
    if(!Array.isArray(instances?.instances)||instances.instances.length>1024)throw failure('MCP_PROTOCOL_ERROR','Instance discovery returned an invalid inventory.');
    evidence.instances=instances.instances.map(instance=>({project:safeText(instance?.project),currentProgram:safeText(instance?.current_program),
      programs:Array.isArray(instance?.programs)?instance.programs.slice(0,256).map(value=>safeText(typeof value==='string'?value:value?.name)).filter(Boolean):[]}));
    if(evidence.instances.length===0)return outcome('blocked','MCP_INSTANCE_NOT_RUNNING','No running Ghidra MCP instance was discovered.');
    if(!project)return outcome('unknown','MCP_WORKSPACE_UNSELECTED','Choose a workspace to compare exact project and Program names.');
    const matches=evidence.instances.filter(instance=>instance.project===project);
    if(!matches.length){
      if(evidence.instances.every(instance=>instance.project))return outcome('blocked','MCP_PROJECT_MISMATCH','Discovered instances do not match the selected project exactly.');
      return outcome('unknown','MCP_IDENTITY_UNVERIFIED','Discovery lacks an exact project identity.');
    }
    if(matches.length!==1)return outcome('unknown','MCP_INSTANCE_AMBIGUOUS','More than one instance reports the selected project name.');
    if(program&&matches[0].currentProgram&&matches[0].currentProgram!==program)return outcome('blocked','MCP_PROGRAM_MISMATCH','The current GUI Program does not match the selected Program exactly.');
    return outcome('unknown','MCP_IDENTITY_UNVERIFIED','Instance discovery cannot attest the selected Program native hash; verify identity through an appropriate read-only capability.');
  }catch(error){return outcome(error.code==='MCP_PROBE_TIMEOUT'?'unknown':'blocked',error.code??'MCP_PROTOCOL_ERROR',error.code?error.message:'The MCP probe could not complete its protocol exchange.');}
  finally {
    clearTimeout(timer);
    if(child){
      child.stdin.destroy();
      if(!closed){child.kill();await new Promise(resolve=>{const wait=setTimeout(resolve,250);child.once('close',()=>{clearTimeout(wait);resolve();});});}
      if(!closed)child.kill('SIGKILL');
      child.stdout.destroy();child.stderr.destroy();
    }
    if(!child||closed)lease?.release();
    else child.once('close',()=>{try{lease?.release();}catch{/* Preserve uncertain ownership for inspection. */}});
  }
}
