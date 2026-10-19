import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProcess } from '../src/process.js';
import { createToolkit } from '../src/toolkit.js';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const engine=path.resolve(process.argv[2]??path.join(root,'../..'));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'retk-symbols-'));
// Synthetic native executables contain only code and inert fixture data; no game inputs.
function elfArm64() {
  const b=Buffer.alloc(0x3000);Buffer.from([0x7f,0x45,0x4c,0x46,2,1,1]).copy(b);
  b.writeUInt16LE(2,16);b.writeUInt16LE(183,18);b.writeUInt32LE(1,20);b.writeBigUInt64LE(0x401000n,24);b.writeBigUInt64LE(64n,32);
  b.writeUInt16LE(64,52);b.writeUInt16LE(56,54);b.writeUInt16LE(2,56);b.writeUInt16LE(64,58);
  for(const [index,offset,size,flags] of [[0,0,0x2000,5],[1,0x2000,0x1000,4]]) {
    const h=64+56*index;b.writeUInt32LE(1,h);b.writeUInt32LE(flags,h+4);b.writeBigUInt64LE(BigInt(offset),h+8);b.writeBigUInt64LE(0x400000n+BigInt(offset),h+16);b.writeBigUInt64LE(0x400000n+BigInt(offset),h+24);b.writeBigUInt64LE(BigInt(size),h+32);b.writeBigUInt64LE(BigInt(size),h+40);b.writeBigUInt64LE(0x1000n,h+48);
  }
  b.writeUInt32LE(0x528000e0,0x1000);b.writeUInt32LE(0xd65f03c0,0x1004);b.write('owned native literal',0x2020);return b;
}
function peAmd64() {
  const b=Buffer.alloc(0x600);b.write('MZ');b.writeUInt32LE(0x80,0x3c);b.write('PE\0\0',0x80);
  const c=0x84;b.writeUInt16LE(0x8664,c);b.writeUInt16LE(2,c+2);b.writeUInt16LE(0xf0,c+16);b.writeUInt16LE(0x22,c+18);
  const o=c+20;b.writeUInt16LE(0x20b,o);b[o+2]=14;b.writeUInt32LE(0x200,o+4);b.writeUInt32LE(0x200,o+8);b.writeUInt32LE(0x1000,o+16);b.writeUInt32LE(0x1000,o+20);b.writeBigUInt64LE(0x140000000n,o+24);b.writeUInt32LE(0x1000,o+32);b.writeUInt32LE(0x200,o+36);b.writeUInt16LE(6,o+40);b.writeUInt16LE(6,o+48);b.writeUInt32LE(0x3000,o+56);b.writeUInt32LE(0x200,o+60);b.writeUInt16LE(3,o+68);b.writeUInt16LE(0x100,o+70);b.writeBigUInt64LE(0x100000n,o+72);b.writeBigUInt64LE(0x1000n,o+80);b.writeBigUInt64LE(0x100000n,o+88);b.writeBigUInt64LE(0x1000n,o+96);b.writeUInt32LE(16,o+108);
  for(const [index,name,rva,raw,flags] of [[0,'.text',0x1000,0x200,0x60000020],[1,'.rdata',0x2000,0x400,0x40000040]]) {
    const h=o+0xf0+40*index;b.write(name,h);b.writeUInt32LE(0x100,h+8);b.writeUInt32LE(rva,h+12);b.writeUInt32LE(0x200,h+16);b.writeUInt32LE(raw,h+20);b.writeUInt32LE(flags,h+36);
  }
  Buffer.from([0xb8,7,0,0,0,0xc3]).copy(b,0x200);b.write('owned native literal',0x420);return b;
}
let success=false;
try {
  fs.mkdirSync(path.join(temp,'02_Il2CppDumperOutput')); fs.mkdirSync(path.join(temp,'scripts'));
  fs.writeFileSync(path.join(temp,'fixture.bin'),Buffer.alloc(256,0x90));
  fs.writeFileSync(path.join(temp,'native.bin'),'owned-native');fs.writeFileSync(path.join(temp,'metadata.bin'),'owned-metadata');
  fs.writeFileSync(path.join(temp,'02_Il2CppDumperOutput/script.json'),`{"ScriptMethod":[{"Address":0,"Name":"Method A"},{"Address":1,"Name":"UserConflict"},{"Address":2,"Name":"Same"},{"Address":3,"Name":"A B"},{"Address":4,"Name":"A?B"},{"Address":9007199254740993,"Name":"UnmappedExact"}],"ScriptString":[{"Address":16,"Value":"literal"}],"ScriptMetadata":[{"Address":32,"Name":"Meta"}],"ScriptMetadataMethod":[{"Address":48,"Name":"MetaMethod"}],"Addresses":[64]}`);
  fs.copyFileSync(path.join(root,'scripts/ghidra/RetkSymbols.java'),path.join(temp,'scripts/RetkSymbols.java'));
  fs.writeFileSync(path.join(temp,'scripts/RetkSymbolsFixture.java'),String.raw`
import ghidra.app.script.GhidraScript;
import ghidra.program.model.symbol.SourceType;
import ghidra.program.model.listing.CodeUnit;
import ghidra.program.model.address.AddressSet;
import com.google.gson.*;
import java.nio.file.*;
import java.security.*;
public class RetkSymbolsFixture extends GhidraScript {
 String hash(Path p)throws Exception { byte[] b=MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(p));StringBuilder s=new StringBuilder();for(byte v:b)s.append(String.format("%02x",v));return s.toString(); }
 void check(boolean x,String m){if(!x)throw new AssertionError(m);}
 void reject(Runnable task,String code){try{task.run();throw new AssertionError("expected "+code);}catch(IllegalArgumentException e){check(e.getMessage().startsWith(code+":"),e.toString());}}
 protected void run()throws Exception {
  Path w=Paths.get(getScriptArgs()[0]);JsonObject cfg=new JsonObject();cfg.addProperty("workspace",w.toString());
  for(String kind:new String[]{"native","metadata"}){JsonObject v=new JsonObject();Path p=w.resolve(kind+".bin");v.addProperty("path",p.toString());v.addProperty("sha256",hash(p));cfg.add(kind,v);}
  JsonObject profile=new JsonObject();profile.addProperty("id","fixture-unknown");profile.addProperty("dumpVerified",true);profile.addProperty("scriptSha256",hash(w.resolve("02_Il2CppDumperOutput/script.json")));profile.addProperty("nativeSha256",cfg.getAsJsonObject("native").get("sha256").getAsString());profile.addProperty("metadataSha256",cfg.getAsJsonObject("metadata").get("sha256").getAsString());cfg.add("profile",profile);
  JsonObject identity=new JsonObject();identity.addProperty("fixture","owned-x86-raw");
  currentProgram.setImageBase(toAddr(0x1000),true);RetkSymbols symbols=new RetkSymbols(currentProgram,cfg,identity,monitor);JsonObject p=new JsonObject();
  currentProgram.getMemory().getBlock(toAddr(0x1000)).setExecute(true);createLabel(toAddr(0x1001),"KeepUser",true,SourceType.USER_DEFINED);createLabel(toAddr(0x1002),"Same",true,SourceType.USER_DEFINED);setEOLComment(toAddr(0x1010),"User note");setEOLComment(toAddr(0x1020),"[REToolkit IL2CPP]\nincomplete user marker");
  reject(()->symbols.plan(p,0),"plan_invalid");p.addProperty("addressMode","rva");JsonObject result=symbols.plan(p,0);JsonObject apply=new JsonObject();apply.addProperty("plan",result.get("plan").getAsString());apply.addProperty("planHash",result.get("planHash").getAsString());
  JsonObject plan=JsonParser.parseString(Files.readString(Paths.get(result.get("plan").getAsString()))).getAsJsonObject();check(plan.getAsJsonArray("entries").toString().contains("0x20000000000001"),"exact >2^53 raw address");check(result.getAsJsonObject("coverage").get("status").getAsString().equals("partial"),"partial coverage");
  reject(()->symbols.validate(apply,1),"revision_conflict");JsonObject valid=symbols.validate(apply,0);int tx=currentProgram.startTransaction("fixture symbols");try{symbols.apply(valid);}finally{currentProgram.endTransaction(tx,true);}
  check(getSymbolAt(toAddr(0x1000)).getName().equals("Method_A"),"imagebase RVA");check(getSymbolAt(toAddr(0x1000)).getSource()==SourceType.IMPORTED,"IMPORTED provenance");check(getSymbolAt(toAddr(0x1001)).getName().equals("KeepUser"),"user label preserved");check(getSymbolAt(toAddr(0x1003)).getName().equals("A_B"),"sanitize");check(getSymbolAt(toAddr(0x1004)).getName().contains("1004"),"collision suffix");check(getEOLComment(toAddr(0x1010)).startsWith("User note"),"user comment preserved");check(getEOLComment(toAddr(0x1010)).contains("literal"),"managed comment");check(getFunctionAt(toAddr(0x1040))==null,"no automatic function");
  reject(()->symbols.validate(apply,0),"revision_conflict");
  byte[] original=Files.readAllBytes(Paths.get(result.get("plan").getAsString()));Files.writeString(Paths.get(result.get("plan").getAsString()),"{}");reject(()->symbols.validate(apply,0),"plan_invalid");Files.write(Paths.get(result.get("plan").getAsString()),original);
  check(getSymbolAt(toAddr(0x1020)).getName().equals("Meta"),"metadata group");check(getSymbolAt(toAddr(0x1030)).getName().equals("MetaMethod"),"metadata methods group");
  JsonObject repeated=symbols.plan(p,1);JsonObject repeatedPlan=JsonParser.parseString(Files.readString(Paths.get(repeated.get("plan").getAsString()))).getAsJsonObject();for(JsonElement v:repeatedPlan.getAsJsonArray("entries")){JsonObject e=v.getAsJsonObject();if(e.get("group").getAsString().equals("ScriptMetadata"))check(e.get("status").getAsString().equals("noop"),"unmatched user comment markers remain intact on repeated import");}
  p.addProperty("createFunctions",true);p.addProperty("replaceUserNames",true);p.addProperty("replaceUserComments",true);disassemble(toAddr(0x1040));JsonObject replacement=symbols.plan(p,1);JsonObject replaceArgs=new JsonObject();replaceArgs.addProperty("plan",replacement.get("plan").getAsString());replaceArgs.addProperty("planHash",replacement.get("planHash").getAsString());JsonObject replacementChanges=symbols.validate(replaceArgs,1);tx=currentProgram.startTransaction("explicit replacement");try{symbols.apply(replacementChanges);}finally{currentProgram.endTransaction(tx,true);}
  check(getSymbolAt(toAddr(0x1001)).getName().equals("UserConflict"),"explicit user replacement");check(!getEOLComment(toAddr(0x1010)).contains("User note"),"explicit comment replacement");check(getFunctionAt(toAddr(0x1040))!=null,"explicit function creation");check(getFunctionAt(toAddr(0x1040)).getBody().getNumAddresses()==1,"body is limited to verified instruction");
  currentProgram.getMemory().createInitializedBlock("exact64",toAddr(0x20000000000001L),1,(byte)0,monitor,false);
  Files.writeString(w.resolve("02_Il2CppDumperOutput/script.json"),"{\"ScriptMetadata\":[{\"Address\":9007199254740993,\"Name\":\"ExactMapped\"}],\"Addresses\":[4160,4162]}");profile.addProperty("scriptSha256",hash(w.resolve("02_Il2CppDumperOutput/script.json")));JsonObject va=new JsonObject();va.addProperty("addressMode","va");va.addProperty("createFunctions",true);
  currentProgram.getFunctionManager().createFunction("UserRange",toAddr(0x1041),new AddressSet(toAddr(0x1041),toAddr(0x1043)),SourceType.USER_DEFINED);
  JsonObject exact=symbols.plan(va,2);JsonObject exactArgs=new JsonObject();exactArgs.addProperty("plan",exact.get("plan").getAsString());exactArgs.addProperty("planHash",exact.get("planHash").getAsString());JsonObject exactChanges=symbols.validate(exactArgs,2);tx=currentProgram.startTransaction("exact mapped VA");try{symbols.apply(exactChanges);}finally{currentProgram.endTransaction(tx,true);}
  check(getSymbolAt(toAddr(0x20000000000001L)).getName().equals("ExactMapped"),"exact mapped integer VA >2^53");check(exact.getAsJsonObject("coverage").get("status").getAsString().equals("partial"),"function overlap skipped");check(getFunctionContaining(toAddr(0x1042)).getName().equals("UserRange"),"overlapping function preserved");
  Files.writeString(w.resolve("02_Il2CppDumperOutput/script.json"),"{\"ScriptMetadata\":[{\"Address\":9007199254740993,\"Name\":\"ExactMapped\"}]}");profile.addProperty("scriptSha256",hash(w.resolve("02_Il2CppDumperOutput/script.json")));JsonObject noOp=symbols.plan(va,3);JsonObject noOpArgs=new JsonObject();noOpArgs.addProperty("plan",noOp.get("plan").getAsString());noOpArgs.addProperty("planHash",noOp.get("planHash").getAsString());check(symbols.validate(noOpArgs,3).get("noop").getAsBoolean(),"same target is a no-op");check(!symbols.validate(noOpArgs,3).get("symbolsApplied").getAsBoolean(),"missing groups never establish complete coverage");
  Files.writeString(w.resolve("02_Il2CppDumperOutput/script.json"),"{\"ScriptMethod\":[],\"ScriptString\":[],\"ScriptMetadata\":[{\"Address\":9007199254740993,\"Name\":\"ExactMapped\"}],\"ScriptMetadataMethod\":[],\"Addresses\":[]}");profile.addProperty("scriptSha256",hash(w.resolve("02_Il2CppDumperOutput/script.json")));JsonObject complete=symbols.plan(va,3);JsonObject completeArgs=new JsonObject();completeArgs.add("plan",complete.get("plan"));completeArgs.add("planHash",complete.get("planHash"));check(symbols.validate(completeArgs,3).get("symbolsApplied").getAsBoolean(),"all groups complete coverage");
  Files.writeString(w.resolve("metadata.bin"),"changed");reject(()->symbols.plan(p,0),"input_changed");
  println("RETK_SYMBOLS_PASS");
 }
}
`);
  const toolkit=createToolkit(engine);fs.mkdirSync(path.join(temp,"appdata"));fs.mkdirSync(path.join(temp,"local"));Object.assign(toolkit.env,{APPDATA:path.join(temp,"appdata"),LOCALAPPDATA:path.join(temp,"local")});
  const result=await runProcess(toolkit.tools.headless,[temp,'OwnedSymbols','-import',path.join(temp,'fixture.bin'),'-loader','BinaryLoader','-loader-baseAddr','0x0','-processor','x86:LE:64:default','-noanalysis','-scriptPath',path.join(temp,'scripts'),'-postScript','RetkSymbolsFixture.java',temp],{env:toolkit.env,logFile:path.join(temp,'engine.log')});
  if(!result.stdout.includes('RETK_SYMBOLS_PASS'))throw new Error(`Real symbol fixture failed. ${result.stdout}\n${result.stderr}`);
  console.log('Real Ghidra symbol planning/apply fixture passed (self-owned x86 raw mapping).');
  fs.writeFileSync(path.join(temp,'scripts/RetkNativeSymbolsFixture.java'),String.raw`
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.symbol.SourceType;
import com.google.gson.*;
import java.nio.file.*;
import java.security.*;
public class RetkNativeSymbolsFixture extends GhidraScript {
 String hash(Path p)throws Exception {byte[] b=MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(p));StringBuilder s=new StringBuilder();for(byte v:b)s.append(String.format("%02x",v));return s.toString();}
 void check(boolean x,String m){if(!x)throw new AssertionError(m);}
 protected void run()throws Exception {
  String[] args=getScriptArgs();Path w=Paths.get(args[0]);check(currentProgram.getLanguageID().toString().startsWith(args[1]),"native language: "+currentProgram.getLanguageID());check(currentProgram.getImageBase().getOffsetAsBigInteger().toString(16).equals(args[2]),"native imagebase: "+currentProgram.getImageBase());check(currentProgram.getExecutableFormat().contains(args[3]),"native loader: "+currentProgram.getExecutableFormat());check(currentProgram.getExecutableSHA256().equals(hash(w.resolve("native.bin"))),"native fixture hash matches imported Program");
  JsonObject cfg=new JsonObject();cfg.addProperty("workspace",w.toString());for(String kind:new String[]{"native","metadata"}){JsonObject input=new JsonObject();Path p=w.resolve(kind+".bin");input.addProperty("path",p.toString());input.addProperty("sha256",hash(p));cfg.add(kind,input);}
  JsonObject profile=new JsonObject();profile.addProperty("id","synthetic-native-explicit-address-mode");profile.addProperty("dumpVerified",true);profile.addProperty("scriptSha256",hash(w.resolve("02_Il2CppDumperOutput/script.json")));profile.addProperty("nativeSha256",hash(w.resolve("native.bin")));profile.addProperty("metadataSha256",hash(w.resolve("metadata.bin")));cfg.add("profile",profile);JsonObject identity=new JsonObject();identity.addProperty("fixture",args[1]);identity.addProperty("nativeSha256",hash(w.resolve("native.bin")));identity.addProperty("language",currentProgram.getLanguageID().toString());identity.addProperty("imageBase",args[2]);
  Address code=currentProgram.getImageBase().add(0x1000),user=code.add(8),data=currentProgram.getImageBase().add(0x2000),literal=data.add(0x20);check(currentProgram.getMemory().getBlock(code).isExecute(),"native code executable");check(!currentProgram.getMemory().getBlock(data).isExecute(),"native data nonexecutable");createLabel(user,"NativeKeepUser",true,SourceType.USER_DEFINED);setEOLComment(literal,"Native user note");disassemble(code);check(getInstructionAt(code)!=null,"native first instruction");check(getInstructionAt(code).getMnemonicString().toLowerCase().startsWith("mov"),"native MOV instruction decoded");
  RetkSymbols symbols=new RetkSymbols(currentProgram,cfg,identity,monitor);JsonObject p=new JsonObject();p.addProperty("addressMode","rva");p.addProperty("createFunctions",true);JsonObject planned=symbols.plan(p,0);JsonObject apply=new JsonObject();apply.addProperty("plan",planned.get("plan").getAsString());apply.addProperty("planHash",planned.get("planHash").getAsString());JsonObject validated=symbols.validate(apply,0);check(!validated.get("symbolsApplied").getAsBoolean(),"protected user name means partial");int tx=currentProgram.startTransaction("native fixture symbols");try{symbols.apply(validated);}finally{currentProgram.endTransaction(tx,true);}
  check(getSymbolAt(code).getName().equals("Native_Method"),"native imagebase plus RVA label");check(getSymbolAt(code).getSource()==SourceType.IMPORTED,"native IMPORTED provenance");check(getSymbolAt(user).getName().equals("NativeKeepUser"),"native user label preserved");check(getSymbolAt(data).getName().equals("NativeMetadata"),"native data RVA label");check(getEOLComment(literal).startsWith("Native user note"),"native user comment retained");check(getEOLComment(literal).contains("native literal"),"native managed comment");check(getFunctionAt(code)!=null,"native instruction function entry");println("RETK_NATIVE_SYMBOLS_PASS "+args[1]+" "+args[2]+" "+currentProgram.getExecutableFormat());
 }
}
`);
  for(const fixture of [{name:'ElfArm64',bytes:elfArm64(),language:'AARCH64:LE:64:',base:'400000',format:'ELF'},{name:'PeAmd64',bytes:peAmd64(),language:'x86:LE:64:',base:'140000000',format:'Portable Executable'}]) {
    const workspace=path.join(temp,fixture.name);fs.mkdirSync(path.join(workspace,'02_Il2CppDumperOutput'),{recursive:true});fs.writeFileSync(path.join(workspace,'native.bin'),fixture.bytes);fs.writeFileSync(path.join(workspace,'metadata.bin'),'synthetic native fixture; no IL2CPP metadata');
    fs.writeFileSync(path.join(workspace,'02_Il2CppDumperOutput/script.json'),JSON.stringify({ScriptMethod:[{Address:0x1000,Name:'Native Method'},{Address:0x1008,Name:'NativeReplaceUser'}],ScriptString:[{Address:0x2020,Value:'native literal'}],ScriptMetadata:[{Address:0x2000,Name:'NativeMetadata'}],ScriptMetadataMethod:[{Address:0x2010,Name:'NativeMetadataMethod'}],Addresses:[0x1000]}));
    const native=await runProcess(toolkit.tools.headless,[workspace,fixture.name,'-import',path.join(workspace,'native.bin'),'-noanalysis','-scriptPath',path.join(temp,'scripts'),'-postScript','RetkNativeSymbolsFixture.java',workspace,fixture.language,fixture.base,fixture.format],{env:toolkit.env,logFile:path.join(workspace,'engine.log')});
    if(!native.stdout.includes('RETK_NATIVE_SYMBOLS_PASS'))throw new Error('Native symbol fixture failed: '+fixture.name+'\n'+native.stdout+'\n'+native.stderr);
    console.log('Real Ghidra symbol fixture passed: source-owned '+fixture.name+', explicit RVA, image base 0x'+fixture.base+'.');
  }
  success=true;
} finally {if(success)fs.rmSync(temp,{recursive:true,force:true});else console.error(`Diagnostics retained at ${temp}`);}
