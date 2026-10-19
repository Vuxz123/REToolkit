// Source-owned protocol fixture; never used as evidence for Ghidra API behavior.
import fs from 'node:fs';
import net from 'node:net';
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
let priorReceipt;
if(process.argv[3]?.startsWith('prior')) {
  priorReceipt=config.workspace+'/04_Notes/bridge/receipts/22222222-2222-4222-8222-222222222222.json';
  fs.mkdirSync(config.workspace+'/04_Notes/bridge/receipts',{recursive:true});
  fs.writeFileSync(priorReceipt,JSON.stringify({runId:'33333333-3333-4333-8333-333333333333',operationId:'22222222-2222-4222-8222-222222222222',
    status:process.argv[3]==='prior-noop'?'noop':'saved',revision:process.argv[3]==='prior-noop'?0:1,payloadHash:'a'.repeat(64),method:'symbols.apply',coverage:'complete',native:config.native,metadata:config.metadata,
    workspace:config.workspace,program:config.program,projectName:config.projectName,profile:process.argv[3]==='prior-stale'?{...config.profile,scriptSha256:'b'.repeat(64)}:config.profile}));
}
let control;
const stateFile=config.workspace+'/04_Notes/fixture-engine-state.json';
const state=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile)):{revision:0,functionName:'Original',ledger:[],writes:0};
let {revision,functionName,writes}=state;const ledger=new Map(state.ledger);
const sockets=new Set();
const server=net.createServer(socket=>{
  sockets.add(socket);let buffer='';
  socket.on('data',data=>{buffer+=data;let split;while((split=buffer.indexOf('\n'))!==-1){
    const request=JSON.parse(buffer.slice(0,split));buffer=buffer.slice(split+1);
    let result={state:'ready',mode:config.mode,revision,enginePid:process.pid,writes};
    if(request.method==='control.attach'&&priorReceipt)result.verifiedReceipts=[priorReceipt];
    const valid=request.token===config.token&&request.runId===config.runId;
    if(request.method==='functions.rename'&&valid) {
      if(request.params.dryRun)result={before:functionName,after:request.params.name};
      else if(ledger.has(request.params.operationId))result=ledger.get(request.params.operationId);
      else {functionName=request.params.name;revision++;writes++;result={before:request.params.expectedOld,after:functionName,operationId:request.params.operationId,status:'saved',requestHash:request.params.payloadHash};ledger.set(request.params.operationId,result);fs.writeFileSync(stateFile,JSON.stringify({revision,functionName,writes,ledger:[...ledger]}));}
    }
    if(request.method==='symbols.apply'&&valid) {
      if(!request.params.plan||!request.params.planHash)throw new Error('Symbol wire contract requires plan and planHash');
      result=request.params.dryRun?{before:'sha256:before',after:'sha256:after',status:'preview'}:{status:'saved',plan:request.params.plan,planHash:request.params.planHash};
    }
    socket.write(JSON.stringify({version:1,id:request.id,runId:config.runId,ok:valid,
      ...(valid?{result,revision,programIdentity:{program:config.program,sha256:config.native.sha256}}:{error:{code:'authentication_failed',message:'rejected'}})})+'\n');
    if(request.method==='control.attach'&&valid)control=socket;
    if(request.method==='session.stop'&&valid) shutdown();
  }});
  socket.on('error',()=>{});socket.on('close',()=>{sockets.delete(socket);if(control===socket)shutdown();});
});
function shutdown(){for(const socket of sockets)socket.end();server.close();}
server.listen(0,'127.0.0.1',()=>fs.writeFileSync(config.endpointPath,JSON.stringify({version:1,runId:config.runId,host:'127.0.0.1',port:server.address().port,programIdentity:{program:config.program,sha256:config.native.sha256}})));
