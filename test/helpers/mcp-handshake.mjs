import {spawn} from 'node:child_process';

const FRAME=1024**2;
const PROTOCOL='2025-03-26';
const fail=(code,message,preserve=false)=>Object.assign(new Error(message),{code,...(preserve?{preserveToolchainGate:true}:{})});
const label=value=>typeof value==='string'&&value.length>0&&value.length<=256&&!/[\x00-\x1f\x7f]/.test(value);
// Caller retains its runtime lease until this function confirms close. A failure
// marked preserveToolchainGate retains both lease and private diagnostics.
export async function qualifyMcpTransport(command,{cwd,timeoutMs=10000,spawnImpl=spawn}={}){
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw fail('MCP_ARGUMENT_INVALID','Invalid MCP handshake deadline.');
 let child,closed=false,completed=false,pending,timer,terminal,buffer=Buffer.alloc(0),total=0,nextId=0;
 const requests=[];
 const stop=error=>{terminal??=error;if(pending){const p=pending;pending=null;p.reject(terminal);}};
 try{
  try{child=spawnImpl(command.file,command.args??[],{cwd,env:command.env,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});}catch{throw fail('MCP_START_FAILED','MCP qualification bridge could not start.');}
  child.on('error',()=>stop(fail('MCP_START_FAILED','MCP qualification bridge could not start.')));
  child.on('close',()=>{closed=true;if(!completed)stop(fail('MCP_EXITED','MCP qualification bridge closed before the exchange completed.'));});
  child.stdin.on('error',()=>stop(fail('MCP_INPUT_CLOSED','MCP qualification input closed.')));
  child.stderr.on('data',chunk=>{total+=chunk.length;if(total>4*FRAME)stop(fail('MCP_PROTOCOL_INVALID','MCP qualification returned invalid or excessive protocol output.'));});
  child.stdout.on('data',chunk=>{try{
   total+=chunk.length;if(total>4*FRAME)throw Error();buffer=Buffer.concat([buffer,chunk]);
   for(;;){const end=buffer.indexOf(10);if(end<0){if(buffer.length>FRAME)throw Error();break;}if(end>FRAME)throw Error();const line=buffer.subarray(0,end).toString('utf8');buffer=buffer.subarray(end+1);if(!line.trim())continue;
    const message=JSON.parse(line);if(message?.jsonrpc!=='2.0')throw Error();
    if(message.id===undefined){if(typeof message.method!=='string')throw Error();continue;}
    if(!pending||message.id!==pending.id||message.error||!message.result||typeof message.result!=='object')throw Error();const p=pending;pending=null;p.resolve(message.result);
   }
  }catch{stop(fail('MCP_PROTOCOL_INVALID','MCP qualification returned invalid or excessive protocol output.'));}});
  const send=(method,params,id)=>{if(terminal)throw terminal;requests.push(method);try{child.stdin.write(JSON.stringify({jsonrpc:'2.0',...(id===undefined?{}:{id}),method,...(params===undefined?{}:{params})})+'\n');}catch{throw fail('MCP_INPUT_CLOSED','MCP qualification input closed.');}};
  const request=(method,params)=>new Promise((resolve,reject)=>{if(terminal){reject(terminal);return;}const id=++nextId;pending={id,resolve,reject};try{send(method,params,id);}catch(error){pending=null;reject(error);}});
  timer=setTimeout(()=>stop(fail('MCP_TIMEOUT','MCP qualification deadline expired.')),timeoutMs);
  const initialized=await request('initialize',{protocolVersion:PROTOCOL,capabilities:{},clientInfo:{name:'retoolkit-qualification',version:'1'}});
  if(initialized.protocolVersion!==PROTOCOL||!label(initialized.serverInfo?.version))throw fail('MCP_PROTOCOL_INVALID','MCP initialization facts are incomplete or unsupported.');
  send('notifications/initialized');
  const tools=[],names=new Set(),cursors=new Set();let cursor;
  for(let page=0;page<8;page++){
   const result=await request('tools/list',cursor?{cursor}:{});if(!Array.isArray(result.tools)||result.tools.length>4096)throw fail('MCP_PROTOCOL_INVALID','MCP tools inventory exceeds its bound.');
   for(const tool of result.tools){if(!label(tool?.name)||names.has(tool.name))throw fail('MCP_PROTOCOL_INVALID','MCP tool names are invalid or duplicated.');names.add(tool.name);tools.push(tool.name);}
   cursor=result.nextCursor;if(cursor===undefined||cursor===null||cursor==='')break;
   if(!label(cursor)||cursors.has(cursor)||page===7)throw fail('MCP_PROTOCOL_INVALID','MCP pagination exceeds its bound.');cursors.add(cursor);
  }
  if(terminal)throw terminal;completed=true;return {protocolVersion:initialized.protocolVersion,serverVersion:initialized.serverInfo.version,tools,requests,closed:true};
 }finally{
  clearTimeout(timer);
  if(child&&!closed){
   child.stdin.end();
   const wait=ms=>new Promise(resolve=>{if(closed){resolve();return;}const close=()=>{clearTimeout(deadline);resolve();},deadline=setTimeout(()=>{child.removeListener('close',close);resolve();},ms);child.once('close',close);});
   await wait(250);if(!closed){try{child.kill();}catch{}await wait(250);}if(!closed){try{child.kill('SIGKILL');}catch{}await wait(500);}
   if(!closed){child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();child.unref();throw fail('MCP_CHILD_UNCERTAIN','MCP child close is unconfirmed; retain runtime ownership and diagnostics.',true);}
  }
  if(child){child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();}
  if(completed&&terminal)throw terminal;
  if(completed&&buffer.length)throw fail('MCP_PROTOCOL_INVALID','MCP qualification ended with an incomplete protocol frame.');
 }
}
