// A source-owned native function, with an untouched neighboring function.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {createToolkit} from '../src/toolkit.js';
import {runProcess} from '../src/process.js';
import {connectClient} from '../src/ghidra/client.js';
import {mutationParams} from '../src/ghidra/protocol.js';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url))),engines=path.resolve(process.argv[2]??root);
const arch=process.argv[3]??'x86';if(!['x86','arm64'].includes(arch))throw Error('Fixture architecture must be x86 or arm64');
const toolkit=createToolkit(engines),temp=fs.mkdtempSync(path.join(os.tmpdir(),'retk-analysis-'));
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
let success=false;
try{
 const bytes=Buffer.alloc(arch==='arm64'?1536:512),code=arch==='arm64'?Buffer.from([0xe0,0,0x80,0x52,0xc0,3,0x5f,0xd6]):Buffer.from([0xb8,7,0,0,0,0xc3]);code.copy(bytes);code.copy(bytes,256);
 if(arch==='arm64'){
  // Independent source-owned AArch64 encodings; addresses are base 0x1000.
  code.copy(bytes,0x200); // 0x1200: mov w0,#7; ret (ordinary callee)
  Buffer.from([0xf8,0xff,0xff,0x17]).copy(bytes,0x220); // 0x1220: b 0x1200
  Buffer.from([0x30,0,0,0x14]).copy(bytes,0x240); // 0x1240: b 0x1300 (unknown)
  Buffer.from([0,0xfd,0xff,0x54,0xc0,3,0x5f,0xd6]).copy(bytes,0x260); // 0x1260: b.eq 0x1200; ret
  Buffer.from([0,0,0x1f,0xd6]).copy(bytes,0x280); // 0x1280: br x0
  Buffer.from([0xd9,0xff,0xff,0x17]).copy(bytes,0x2a0); // 0x12a0: b 0x1204 (callee interior)
  Buffer.from([0x40,0,0,0xb4,0xcf,0xff,0xff,0x17,0xc0,3,0x5f,0xd6]).copy(bytes,0x2c0); // cbz x0,0x12c8; b 0x1200; ret
  Buffer.from([0xfd,0x7b,0xbf,0xa9,0xfd,3,0,0x91,0xc6,0xff,0xff,0x97,0xfd,0x7b,0xc1,0xa8,0xc0,3,0x5f,0xd6]).copy(bytes,0x2e0); // framed BL caller: stp/mov/bl/ldp/ret
 }
 const native=path.join(temp,'owned.bin'),metadata=path.join(temp,'metadata.bin');fs.writeFileSync(native,bytes);fs.writeFileSync(metadata,'owned');
 fs.mkdirSync(path.join(temp,'04_Notes'));const config={version:1,workspace:temp,runId:'fixture',mode:'write',projectName:'Owned',program:'owned.bin',native:{path:native,sha256:sha(native)},metadata:{path:metadata,sha256:sha(metadata)},profile:'fixture',functionEnd:arch==='arm64'?'0x1007':'0x1005'};
 if(arch==='arm64')config.arm64Tail=true;
 const conf=path.join(temp,'config.json');fs.writeFileSync(conf,JSON.stringify(config));
 for(const name of fs.readdirSync(path.join(root,'scripts/ghidra')).filter(x=>/^Retk.*\.java$/.test(x)))fs.copyFileSync(path.join(root,'scripts/ghidra',name),path.join(temp,name));
 fs.writeFileSync(path.join(temp,'RetkAnalysisFixture.java'),String.raw`
import ghidra.app.script.GhidraScript;import ghidra.program.model.address.*;import ghidra.program.model.listing.FlowOverride;import ghidra.program.model.symbol.SourceType;import ghidra.util.task.*;import com.google.gson.*;import java.nio.file.*;import java.util.*;
public class RetkAnalysisFixture extends GhidraScript {
 byte[] nativeBytes;
 void check(boolean value,String message){if(!value)throw new IllegalStateException(message);}
 JsonObject request(String start,String end,String kind){JsonObject p=new JsonObject();p.addProperty("address",start);p.addProperty("endAddress",end);p.addProperty("kind",kind);p.addProperty("reason","Inspect gameplay fixture");p.addProperty("timeoutSeconds",30);p.addProperty("dryRun",true);return p;}
 JsonObject saved(RetkMutations m,JsonObject p)throws Exception {JsonObject v=m.execute("analysis.ensure",p);check(v.get("coverage").getAsString().equals("scoped"),"Preview must be scoped");p.addProperty("dryRun",false);p.addProperty("expectedRevision",m.revision);p.add("expectedOld",v.get("before"));p.addProperty("operationId",UUID.randomUUID().toString());p.addProperty("payloadHash",RetkMutations.payloadHash("analysis.ensure",p));return m.execute("analysis.ensure",p);}
 void rejectedFlow(RetkMutations m,RetkAnalysis analysis,String start,String end)throws Exception {
  JsonObject p=request(start,end,"function");AddressSet range=analysis.range(p);String before=RetkMutations.digest(analysis.observe(range,monitor));long revision=m.revision;boolean rejected=false;
  try{saved(m,p);}catch(IllegalArgumentException e){rejected=e.getMessage().startsWith("analysis_scope_invalid:");}
  check(rejected,"Unsafe flow must reject: "+start);check(m.revision==revision&&!m.needsRecovery,"Rejected flow must preserve revision and recovery state: "+start);
  check(before.equals(RetkMutations.digest(analysis.observe(range,monitor))),"Rejected flow must roll back instructions, references and functions: "+start);
 }
 void tailBodies()throws Exception {
  var fm=currentProgram.getFunctionManager();var caller=fm.getFunctionAt(toAddr(0x1220));var callee=fm.getFunctionAt(toAddr(0x1200));
  check(caller!=null&&caller.getBody().equals(new AddressSet(toAddr(0x1220),toAddr(0x1223))),"Tail caller body must be exactly its local instruction");
  check(callee!=null&&callee.getBody().equals(new AddressSet(toAddr(0x1200),toAddr(0x1207))),"Callee body must stay exact and disjoint");
  check(!caller.getBody().intersects(callee.getBody()),"Tail caller must not absorb callee");
  for(long[] scope:new long[][]{{0x1200,0x1207},{0x1220,0x1223},{0x12c0,0x12cb},{0x12e0,0x12f3}}){
   var function=fm.getFunctionAt(toAddr(scope[0]));AddressSet exact=new AddressSet(toAddr(scope[0]),toAddr(scope[1]));check(function!=null&&function.getBody().equals(exact),"Successful function body must be exact: "+Long.toHexString(scope[0]));
   byte[] actual=new byte[(int)(scope[1]-scope[0]+1)];check(currentProgram.getMemory().getBytes(toAddr(scope[0]),actual)==actual.length,"Readable bytes required");check(Arrays.equals(actual,Arrays.copyOfRange(nativeBytes,(int)scope[0]-0x1000,(int)scope[1]-0x1000+1)),"Successful analysis must preserve native bytes");
   var instructions=currentProgram.getListing().getInstructions(exact,true);while(instructions.hasNext())check(instructions.next().getFlowOverride()==FlowOverride.NONE,"Successful analysis must preserve FlowOverride.NONE");
  }
  for(long address:new long[]{0x1240,0x1260,0x1280,0x12a0,0x1300})check(currentProgram.getListing().getInstructionAt(toAddr(address))==null&&fm.getFunctionAt(toAddr(address))==null,"Rejected/dependency flow must remain undefined: "+Long.toHexString(address));
 }
 // Semantic fixture assertions: direct B lowers to goto in AARCH64 Sleigh.
 // The decompiler may follow that edge and fold mov w0,#7;ret to return 7.
 String compactBody(String code){return code.substring(code.indexOf('{')).replaceAll("\\s+","");}
 boolean foldedSeven(String code){return compactBody(code).equals("{return7;}");}
 boolean foldedConditionalSeven(String code){
  String body=compactBody(code);
  return body.matches("\\{if\\(([A-Za-z_][A-Za-z_0-9]*)!=0\\)\\{\\1=7;\\}return\\1;\\}")
   ||body.matches("\\{if\\(([A-Za-z_][A-Za-z_0-9]*)==0\\)\\{return\\1;\\}return7;\\}")
   ||body.matches("\\{if\\(([A-Za-z_][A-Za-z_0-9]*)!=0\\)\\{return7;\\}return\\1;\\}")
   ||body.matches("\\{if\\([A-Za-z_][A-Za-z_0-9]*==0\\)\\{return0;\\}return7;\\}")
   ||body.matches("\\{if\\([A-Za-z_][A-Za-z_0-9]*!=0\\)\\{return7;\\}return0;\\}");
 }
 // End semantic fixture assertions.
 void directTailDependency(long from)throws Exception {
  var instruction=currentProgram.getListing().getInstructionAt(toAddr(from));Address target=toAddr(0x1200);
  check(instruction!=null&&instruction.getMnemonicString().equalsIgnoreCase("b")&&instruction.getFlowType().isJump()&&!instruction.getFlowType().isConditional()&&!instruction.getFlowType().isComputed()&&instruction.getFallThrough()==null&&instruction.getFlows().length==1&&instruction.getFlows()[0].equals(target),"Caller must retain the exact unique direct tail edge");
  boolean reference=false;for(var ref:instruction.getReferencesFrom())if(ref.getToAddress().equals(target)&&ref.getReferenceType().isJump()&&!ref.getReferenceType().isConditional())reference=true;check(reference,"Stored direct jump reference must identify the actual separate callee");
  if(from==0x12c4){var branch=currentProgram.getListing().getInstructionAt(toAddr(0x12c0));check(branch!=null&&branch.getMnemonicString().equalsIgnoreCase("cbz")&&branch.getDefaultOperandRepresentation(0).equalsIgnoreCase("x0")&&branch.getFlowType().isConditional()&&branch.getFlows().length==1&&branch.getFlows()[0].equals(toAddr(0x12c8))&&branch.getFallThrough().equals(toAddr(0x12c4)),"Conditional fixture must preserve x0==0 local path and nonzero tail path");check(currentProgram.getListing().getInstructionAt(toAddr(0x12c8)).getMnemonicString().equalsIgnoreCase("ret"),"Zero path must return original zero x0");}
 }
 void completeDecompile(RetkQueries q,RetkMutations m,String address,boolean dependency)throws Exception {
  JsonObject p=new JsonObject();p.addProperty("selector",address);p.addProperty("limit",500);JsonObject result=q.execute("functions.decompile",p,m.revision);
  check(result.get("address").getAsString().equals(RetkQueries.hex(toAddr(Long.decode(address)))),"Decompiler must return exact requested entry");check(result.get("nextCursor").isJsonNull(),"Decompiler result must contain the complete function");
  var rows=result.getAsJsonArray("items");check(rows.size()>0,"Decompiler must return code");StringBuilder code=new StringBuilder();for(var row:rows)code.append(row.getAsJsonObject().get("text").getAsString()).append('\n');
  Files.writeString(Path.of(getScriptArgs()[0]+".decompile-"+address+".json"),result.toString());
  if(address.equals("0x1200"))check(foldedSeven(code.toString()),"Separate callee must decompile to its exact return-7 semantics: "+code);
  if(dependency){String callee=currentProgram.getFunctionManager().getFunctionAt(toAddr(0x1200)).getName();boolean named=code.toString().contains(callee+"(");
   if(address.equals("0x1220")){directTailDependency(0x1220);check(named||foldedSeven(code.toString()),"Tail caller must retain callee identity or exact folded return-7 semantics: "+code);}
   else if(address.equals("0x12c0")){directTailDependency(0x12c4);check(named||foldedConditionalSeven(code.toString()),"Conditional tail must preserve zero/nonzero return semantics: "+code);}
   else check(named,"Ordinary BL caller must retain actual callee identity: "+callee+" in "+code);
  }
 }
 public void run()throws Exception {
  JsonObject c=JsonParser.parseString(Files.readString(Path.of(getScriptArgs()[0]))).getAsJsonObject();boolean reopen=getScriptArgs().length>1;String phase=reopen?getScriptArgs()[1]:"first";nativeBytes=Files.readAllBytes(Path.of(c.getAsJsonObject("native").get("path").getAsString()));end(true);currentProgram.flushEvents();currentProgram.setEventsEnabled(false);
  RetkQueries q=new RetkQueries(currentProgram,monitor);RetkSymbols s=new RetkSymbols(currentProgram,c,new JsonObject(),monitor);RetkMutations m=new RetkMutations(currentProgram,c,q,s,monitor);
  if(phase.startsWith("edit-")||phase.startsWith("verify-")){
   check(c.has("arm64Tail")&&m.revision==7&&!m.needsRecovery,"Cache-edit fixture must preserve REToolkit revision");RetkAnalysis analysis=new RetkAnalysis(currentProgram,monitor);AddressSet scope=new AddressSet(toAddr(0x1220),toAddr(0x1223));String before=RetkMutations.digest(analysis.observe(scope,monitor));
   if(phase.startsWith("edit-")){
    int transaction=currentProgram.startTransaction("Source-owned between-session GUI callee edit");boolean commit=false;try{var fm=currentProgram.getFunctionManager();fm.removeFunction(toAddr(0x1200));fm.removeFunction(toAddr(0x11fc));if(phase.equals("edit-interior"))fm.createFunction("ShiftedCallee",toAddr(0x11fc),new AddressSet(toAddr(0x11fc),toAddr(0x1207)),SourceType.USER_DEFINED);else if(phase.equals("edit-restore"))fm.createFunction(null,toAddr(0x1200),new AddressSet(toAddr(0x1200),toAddr(0x1207)),SourceType.ANALYSIS);commit=true;}finally{currentProgram.endTransaction(transaction,commit);}currentProgram.save("Fixture stopped-session callee edit",monitor);
   }else{
    JsonObject historic=JsonParser.parseString(Files.readString(Path.of(getScriptArgs()[0]+".tail-request.json"))).getAsJsonObject();JsonObject receipt=JsonParser.parseString(Files.readString(Path.of(getScriptArgs()[0]+".tail-receipt.json"))).getAsJsonObject();check(m.execute("analysis.ensure",historic).equals(receipt),"Historical operation UUID must retain its saved receipt");
    rejectedFlow(m,analysis,"0x1220","0x1223");check(m.revision==7&&!m.needsRecovery,"Fresh invalid cached request must not advance revision or require recovery");
   }
   check(before.equals(RetkMutations.digest(analysis.observe(scope,monitor))),"Between-session dependency edit/check must preserve caller state");q.close();Files.writeString(Path.of(getScriptArgs()[0]+"."+phase),"verified");return;
  }
  Address a=toAddr(0x1000),neighbor=toAddr(0x1100);
  String functionEnd=c.get("functionEnd").getAsString();
  if(!reopen){check(currentProgram.getListing().getInstructionAt(a)==null,"Import must start undefined");JsonObject p=request("0x1000",functionEnd,"function");JsonObject r=saved(m,p);check(r.get("status").getAsString().equals("saved"),"Analysis must save");check(m.execute("analysis.ensure",p).equals(r),"Exact retry must reuse receipt");check(currentProgram.getFunctionManager().getFunctionAt(a)!=null,"Must create function");check(currentProgram.getListing().getInstructionAt(neighbor)==null,"Must not analyze neighbor");JsonObject again=saved(m,request("0x1000",functionEnd,"function"));check(again.get("status").getAsString().equals("noop"),"Repeat must reuse coverage");
   for(String[] bad:new String[][]{{"0x1000","0x11000","function"},{"0x1000","0x1001","function"},{"0x1000","0x1005","all"},{"0x1001","0x1005","function"}}){boolean rejected=false;try{m.execute("analysis.ensure",request(bad[0],bad[1],bad[2]));}catch(IllegalArgumentException e){rejected=true;}check(rejected,"Must reject invalid scope");}
   boolean rolled=false;try{saved(m,request("0x1100","0x1101","function"));}catch(IllegalArgumentException e){rolled=true;}check(rolled&&m.revision==1&&!m.needsRecovery&&currentProgram.getListing().getInstructionAt(neighbor)==null,"Truncated new flow must roll back every instruction");
   TaskMonitorAdapter expire=new TaskMonitorAdapter(true){boolean slept=false;public void checkCancelled()throws ghidra.util.exception.CancelledException{if(!slept&&currentProgram.getCurrentTransactionInfo()!=null&&currentProgram.getListing().getInstructionAt(neighbor)!=null){slept=true;try{Thread.sleep(1100);}catch(InterruptedException e){Thread.currentThread().interrupt();}}}};
   RetkMutations timed=new RetkMutations(currentProgram,c,q,s,expire);JsonObject timeout=request("0x1100","0x110f","disassemble");timeout.addProperty("timeoutSeconds",1);boolean expired=false;try{saved(timed,timeout);}catch(IllegalArgumentException e){expired=e.getMessage().startsWith("analysis_cancelled:");}check(expired&&timed.revision==1&&!timed.needsRecovery&&currentProgram.getListing().getInstructionAt(neighbor)==null,"Deadline expiration after decoding must roll back");
   check(saved(m,request("0x1000",functionEnd,"stack")).get("status").getAsString().equals("saved"),"Stack must save scoped result");
   if(c.has("arm64Tail")){
    RetkAnalysis analysis=new RetkAnalysis(currentProgram,monitor);
    rejectedFlow(m,analysis,"0x1220","0x1223"); // callee bytes exist but are not analyzed yet
    check(currentProgram.getListing().getInstructionAt(toAddr(0x1200))==null,"Rejected tail must not analyze dependency");
    check(saved(m,request("0x1200","0x1207","function")).get("status").getAsString().equals("saved"),"Callee must first use ordinary function ensure");
    String calleeBefore=RetkMutations.digest(analysis.observe(new AddressSet(toAddr(0x1200),toAddr(0x1207)),monitor));
    check(saved(m,request("0x1220","0x1223","function")).get("status").getAsString().equals("saved"),"Known AArch64 direct tail must save");
    check(calleeBefore.equals(RetkMutations.digest(analysis.observe(new AddressSet(toAddr(0x1200),toAddr(0x1207)),monitor))),"Tail recovery must leave callee unchanged");
    for(String[] bad:new String[][]{{"0x1240","0x1243"},{"0x1260","0x1267"},{"0x1280","0x1283"},{"0x12a0","0x12a3"}})rejectedFlow(m,analysis,bad[0],bad[1]);
    check(saved(m,request("0x12c0","0x12cb","function")).get("status").getAsString().equals("saved"),"Local conditional paths ending in qualified tail must save");
    check(saved(m,request("0x12e0","0x12f3","function")).get("status").getAsString().equals("saved"),"Ordinary framed BL plus RET must save");
    JsonObject historic=request("0x1220","0x1223","function"),receipt=saved(m,historic);check(receipt.get("status").getAsString().equals("saved"),"Refresh caller cache at final revision");Files.writeString(Path.of(getScriptArgs()[0]+".tail-request.json"),historic.toString());Files.writeString(Path.of(getScriptArgs()[0]+".tail-receipt.json"),receipt.toString());
    check(saved(m,request("0x1220","0x1223","function")).get("status").getAsString().equals("noop"),"Fresh qualified tail request must reuse revalidated coverage");tailBodies();check(m.revision==7,"Only explicit successful function analyses may advance revision");
   }
  }else{check(currentProgram.getFunctionManager().getFunctionAt(a)!=null,"Function must survive reopen");check(currentProgram.getListing().getInstructionAt(neighbor)==null,"Neighbor must stay undefined on disk");check(m.revision==(c.has("arm64Tail")?7:2),"Noop and rollback must not advance revision");check(!m.needsRecovery,"Receipts must verify");if(c.has("arm64Tail"))tailBodies();}
  JsonObject readonly=c.deepCopy();readonly.addProperty("mode","read");RetkMutations read=new RetkMutations(currentProgram,readonly,q,s,monitor);boolean denied=false;try{read.execute("analysis.ensure",request("0x1000",functionEnd,"function"));}catch(IllegalArgumentException e){denied=e.getMessage().startsWith("write_session_required:");}check(denied,"Read-only analysis must fail");
  JsonObject dp=new JsonObject();dp.addProperty("selector","0x1000");check(q.execute("functions.decompile",dp,m.revision).getAsJsonArray("items").size()>0,"Must decompile");
  if(c.has("arm64Tail")){completeDecompile(q,m,"0x1200",false);for(String address:new String[]{"0x1220","0x12c0","0x12e0"})completeDecompile(q,m,address,true);}
  q.close();Files.writeString(Path.of(getScriptArgs()[0]+(reopen?".reopen":".first")),"verified");
 }
}`);
 const env={...toolkit.env,APPDATA:temp,LOCALAPPDATA:temp,USERPROFILE:temp,_JAVA_OPTIONS:`-Dapplication.settingsdir=${temp} -Dapplication.cachedir=${temp} -Dapplication.tempdir=${temp} -Duser.home=${temp}`};
 const scripts=temp;
 await runProcess(toolkit.tools.headless,[temp,'Owned','-import',native,'-loader','BinaryLoader','-loader-baseAddr','0x1000','-processor',arch==='arm64'?'AARCH64:LE:64:v8A':'x86:LE:64:default','-noanalysis'],{env,logFile:path.join(temp,'import.log')});
 await runProcess(toolkit.tools.headless,[temp,'Owned','-process','owned.bin','-noanalysis','-scriptPath',scripts,'-postScript','RetkAnalysisFixture.java',conf],{env,logFile:path.join(temp,'first.log')});
 if(!fs.existsSync(conf+'.first'))throw Error('Analysis fixture failed: '+fs.readFileSync(path.join(temp,'first.log'),'utf8').slice(-8000));
 await runProcess(toolkit.tools.headless,[temp,'Owned','-process','owned.bin','-noanalysis','-scriptPath',scripts,'-postScript','RetkAnalysisFixture.java',conf,'reopen'],{env,logFile:path.join(temp,'reopen.log')});
 if(!fs.existsSync(conf+'.reopen'))throw Error('Reopen fixture failed: '+fs.readFileSync(path.join(temp,'reopen.log'),'utf8').slice(-8000));
 if(arch==='arm64')for(const phase of ['edit-missing','verify-missing','edit-interior','verify-interior','edit-restore','reopen']){
  fs.rmSync(conf+'.'+phase,{force:true});
  await runProcess(toolkit.tools.headless,[temp,'Owned','-process','owned.bin','-noanalysis','-scriptPath',scripts,'-postScript','RetkAnalysisFixture.java',conf,phase],{env,logFile:path.join(temp,phase+'.log')});
  if(!fs.existsSync(conf+'.'+phase))throw Error('Cache dependency phase failed: '+phase+' '+fs.readFileSync(path.join(temp,phase+'.log'),'utf8').slice(-8000));
 }
 // Exercise the actual authenticated bridge and Node mutation wire contract.
 const live={...config,runId:randomUUID(),token:randomBytes(32).toString('hex'),projectDir:temp,endpointPath:path.join(temp,'endpoint.json'),idleMs:120000},liveConfig=path.join(temp,'live.json');fs.writeFileSync(liveConfig,JSON.stringify(live));
 let finished=false,launchError;const launched=runProcess(toolkit.tools.headless,[temp,'Owned','-process','owned.bin','-noanalysis','-scriptPath',scripts,'-postScript','RetkSessionBridge.java',liveConfig],{env,logFile:path.join(temp,'bridge.log')}).catch(error=>{launchError=error;}).finally(()=>{finished=true;});
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),until=Date.now()+120000;
 while(!finished&&!fs.existsSync(live.endpointPath)&&Date.now()<until)await pause(100);
 if(!fs.existsSync(live.endpointPath))throw Error('Bridge did not start: '+(launchError?.message??fs.readFileSync(path.join(temp,'bridge.log'),'utf8').slice(-6000)));
 const client=await connectClient({...JSON.parse(fs.readFileSync(live.endpointPath)),token:live.token});let timer;
 try{
  await client.request('control.attach');timer=setInterval(()=>client.request('control.heartbeat').catch(()=>{}),3000);
  const exact=await client.request('instructions.list',{address:'0x1000',endAddress:config.functionEnd,limit:100});
  if(exact.result.items.length!==2||exact.result.nextCursor!==null)throw Error('Bounded instruction query escaped the fixture function');
  for(const endAddress of ['0x1001','0xfff','0x11000','0x8000000000001000']){let rejected=false;try{await client.request('instructions.list',{address:'0x1000',endAddress,limit:100});}catch{rejected=true;}if(!rejected)throw Error('Bounded query accepted invalid end '+endAddress);}
  const params={address:'0x1000',endAddress:config.functionEnd,kind:'function',reason:'Live Agent request',timeoutSeconds:30},preview=await client.request('analysis.ensure',{...params,dryRun:true});
  const saved=await client.request('analysis.ensure',mutationParams('analysis.ensure',params,preview));
  if(saved.result.status!=='saved'||saved.result.globalAnalysisComplete!==false)throw Error('Bridge must save scoped analysis without global readiness');
  if(!(await client.request('functions.decompile',{selector:'0x1000'})).result.items.length)throw Error('Live bridge must decompile analyzed function');
  if((await client.request('memory.read',{address:'0x1100',length:code.length})).result.hex!==code.toString('hex'))throw Error('Neighbor bytes changed');
 }finally{clearInterval(timer);try{await client.request('session.stop');}finally{client.close();}await launched;}
 if(launchError)throw launchError;
 success=true;console.log(JSON.stringify({state:'passed',fixture:'source-owned-'+arch,temp}));
}finally{if(!success)console.error('Preserved fixture: '+temp);}
