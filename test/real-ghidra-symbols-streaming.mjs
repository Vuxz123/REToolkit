import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runProcess} from '../src/process.js';
import {createToolkit} from '../src/toolkit.js';

// Owned synthetic Program only. The 256 MiB JVM cannot hold a 217.5 MiB
// whole-file byte[] plus Gson tree; padding measures file streaming separately
// from the number of actual Program changes retained for the atomic mutation.
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const toolkit=createToolkit(path.resolve(process.argv[2]??root));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'retk-symbol-stream-'));
let success=false;
try {
  fs.mkdirSync(path.join(temp,'scripts'));fs.mkdirSync(path.join(temp,'02_Il2CppDumperOutput'));
  fs.writeFileSync(path.join(temp,'fixture.bin'),Buffer.alloc(256,0x90));
  for(const kind of ['native','metadata'])fs.writeFileSync(path.join(temp,kind+'.bin'),'owned-'+kind);
  fs.writeFileSync(path.join(temp,'02_Il2CppDumperOutput/script.json'),JSON.stringify({ScriptMethod:[{Address:0,Name:'StreamMethod'}],ScriptString:[{Address:16,Value:'literal'}],ScriptMetadata:[],ScriptMetadataMethod:[],Addresses:[]}));
  fs.copyFileSync(path.join(root,'scripts/ghidra/RetkSymbols.java'),path.join(temp,'scripts/RetkSymbols.java'));
  fs.writeFileSync(path.join(temp,'scripts/RetkSymbolsStreamingFixture.java'),String.raw`
import ghidra.app.script.GhidraScript;
import com.google.gson.*;
import java.io.*;
import java.nio.file.*;
import java.security.*;
import java.util.*;
public class RetkSymbolsStreamingFixture extends GhidraScript {
 String hash(Path p)throws Exception {MessageDigest d=MessageDigest.getInstance("SHA-256");try(InputStream in=Files.newInputStream(p)){byte[] b=new byte[65536];int n;while((n=in.read(b))!=-1)d.update(b,0,n);}return HexFormat.of().formatHex(d.digest());}
 void check(boolean x,String m){if(!x)throw new AssertionError(m);}
 void reject(Runnable task,String code){try{task.run();throw new AssertionError("expected "+code);}catch(IllegalArgumentException e){check(e.getMessage().startsWith(code+":"),e.toString());}}
 JsonObject args(Path p)throws Exception {JsonObject a=new JsonObject();a.addProperty("plan",p.toString());a.addProperty("planHash",hash(p));return a;}
 Path immutable(Path dir,byte[] bytes)throws Exception {Path t=Files.createTempFile(dir,"fixture-",".tmp");Files.write(t,bytes);Path p=dir.resolve(hash(t)+".json");Files.move(t,p);return p;}
 protected void run()throws Exception {
  Path w=Paths.get(getScriptArgs()[0]),source=w.resolve("02_Il2CppDumperOutput/script.json");JsonObject cfg=new JsonObject();cfg.addProperty("workspace",w.toString());
  for(String kind:new String[]{"native","metadata"}){JsonObject input=new JsonObject();input.addProperty("path",w.resolve(kind+".bin").toString());input.addProperty("sha256",hash(w.resolve(kind+".bin")));cfg.add(kind,input);}
  JsonObject profile=new JsonObject();profile.add("numericLexeme",JsonParser.parseString("1e0"));profile.addProperty("dumpVerified",true);profile.addProperty("scriptSha256",hash(source));for(String kind:new String[]{"native","metadata"})profile.addProperty(kind+"Sha256",hash(w.resolve(kind+".bin")));cfg.add("profile",profile);
  currentProgram.getMemory().getBlock(toAddr(0)).setExecute(true);JsonObject identity=new JsonObject();identity.addProperty("fixture","owned-streaming");RetkSymbols symbols=new RetkSymbols(currentProgram,cfg,identity,monitor);JsonObject policy=new JsonObject();policy.addProperty("addressMode","rva");JsonObject planned=symbols.plan(policy,7);Path small=Paths.get(planned.get("plan").getAsString()),dir=small.getParent();byte[] original=Files.readAllBytes(small);
  // Verify emitted v1 bytes retain the legacy Gson field ordering and newline.
  JsonObject tree=JsonParser.parseString(new String(original,java.nio.charset.StandardCharsets.UTF_8)).getAsJsonObject();check(Arrays.equals(original,(new GsonBuilder().serializeNulls().disableHtmlEscaping().create().toJson(tree)+"\n").getBytes(java.nio.charset.StandardCharsets.UTF_8)),"legacy v1 serialization");
  Path padded=dir.resolve("padded.tmp");try(OutputStream out=Files.newOutputStream(padded)){out.write(original);byte[] spaces=new byte[65536];Arrays.fill(spaces,(byte)' ');long remaining=228064551L-original.length;while(remaining>0){int n=(int)Math.min(remaining,spaces.length);out.write(spaces,0,n);remaining-=n;}}Path large=dir.resolve(hash(padded)+".json");Files.move(padded,large);JsonObject largeArgs=args(large);JsonObject validated=symbols.validate(largeArgs,7);check(Files.size(large)>228064550L,"owned fixture exceeds retained 217.5 MiB plan");check(validated.getAsJsonArray("changes").size()==2,"meaningful bound changes survive streaming");check(validated.get("symbolsApplied").getAsBoolean(),"complete coverage preserved");reject(()->symbols.validate(largeArgs,8),"revision_conflict");
  String text=new String(original,java.nio.charset.StandardCharsets.UTF_8);for(String malformed:new String[]{text.replaceFirst("\\{","{\"version\":1,"),text+" {}",text.replace("\"entries\":[{","\"entries\":[{\"index\":1,"),text.replace("\"version\":1","\"version\":01"),text.replace("\"version\":1","\"version\":'1'")}){Path bad=immutable(dir,malformed.getBytes(java.nio.charset.StandardCharsets.UTF_8));JsonObject badArgs=args(bad);reject(()->symbols.validate(badArgs,7),"plan_invalid");}
  Path oversized=dir.resolve("oversized.tmp");try(RandomAccessFile out=new RandomAccessFile(oversized.toFile(),"rw")){out.setLength(512L*1024*1024+1);}JsonObject oversizedArgs=new JsonObject();oversizedArgs.addProperty("plan",oversized.toString());oversizedArgs.addProperty("planHash","0".repeat(64));reject(()->symbols.validate(oversizedArgs,7),"plan_invalid");Files.delete(oversized);
  Path linked=w.resolve("linked.json");Files.createLink(linked,large);reject(()->symbols.validate(largeArgs,7),"plan_invalid");Files.delete(linked);
  byte[] invalid=Arrays.copyOf(original,original.length+1);invalid[invalid.length-1]=(byte)255;Path invalidUtf8=immutable(dir,invalid);JsonObject invalidArgs=args(invalidUtf8);reject(()->symbols.validate(invalidArgs,7),"plan_invalid");
  boolean[] changed={false};ghidra.util.task.TaskMonitor mutating=(ghidra.util.task.TaskMonitor)java.lang.reflect.Proxy.newProxyInstance(getClass().getClassLoader(),new Class<?>[]{ghidra.util.task.TaskMonitor.class},(proxy,method,values)->{if(method.getName().equals("checkCancelled")&&!changed[0]){changed[0]=true;Files.writeString(large," ",StandardOpenOption.APPEND);}return method.invoke(monitor,values);});RetkSymbols duringRead=new RetkSymbols(currentProgram,cfg,identity,mutating);reject(()->duringRead.validate(largeArgs,7),"plan_invalid");try(java.nio.channels.FileChannel restore=java.nio.channels.FileChannel.open(large,StandardOpenOption.WRITE)){restore.truncate(228064551L);}
  setEOLComment(toAddr(16),"changed before");reject(()->symbols.validate(largeArgs,7),"revision_conflict");setEOLComment(toAddr(16),null);
  Files.writeString(w.resolve("metadata.bin"),"changed");reject(()->symbols.validate(largeArgs,7),"input_changed");Files.writeString(w.resolve("metadata.bin"),"owned-metadata");
  Files.writeString(source,"{\"ScriptMethod\":[{\"Address\":1e0,\"Name\":\"Exponent\"},{\"Address\":-0,\"Name\":\"NegativeZero\"}],\"ScriptString\":[{\"Address\":16,\"Value\":1.00}]}");profile.addProperty("scriptSha256",hash(source));JsonObject numeric=symbols.plan(policy,8);JsonObject numericPlan=JsonParser.parseString(Files.readString(Paths.get(numeric.get("plan").getAsString()))).getAsJsonObject();check(numeric.getAsJsonObject("summary").get("skipped").getAsInt()==2,"non-integer source lexemes remain rejected");check(numericPlan.getAsJsonArray("entries").get(2).getAsJsonObject().getAsJsonObject("change").get("comment").getAsString().contains("1.00"),"numeric literal text preserved");
  // A high row count proves the writer spools entries rather than retaining
  // the whole plan. Invalid unmapped rows deliberately retain no mutation.
  try(BufferedWriter out=Files.newBufferedWriter(source)){out.write("{\"ScriptMetadata\":[");for(int i=0;i<1650000;i++){if(i>0)out.write(',');out.write("{\"Address\":\"0xfffffffffffffff0\",\"Name\":\"Unmapped\"}");}out.write("]}");}profile.addProperty("scriptSha256",hash(source));JsonObject emitted=symbols.plan(policy,9);Path emittedPath=Paths.get(emitted.get("plan").getAsString());check(Files.size(emittedPath)>228064550L,"streamed writer fixture exceeds retained plan");check(emitted.get("planHash").getAsString().equals(hash(emittedPath)),"actual written bytes hash");check(symbols.validate(args(emittedPath),9).get("noop").getAsBoolean(),"skipped entries streamed without retaining tree");check(emitted.getAsJsonObject("summary").get("skipped").getAsInt()==1650000,"all rows retained");
  println("RETK_SYMBOLS_STREAMING_PASS bytes="+Files.size(large)+" emitted="+Files.size(emittedPath)+" heap="+Runtime.getRuntime().maxMemory());
 }
}
`);
  fs.mkdirSync(path.join(temp,'appdata'));fs.mkdirSync(path.join(temp,'local'));
  const env={...toolkit.env,APPDATA:path.join(temp,'appdata'),LOCALAPPDATA:path.join(temp,'local'),GHIDRA_HEADLESS_MAXMEM:'256M'};
  const result=await runProcess(toolkit.tools.headless,[temp,'OwnedStreaming','-import',path.join(temp,'fixture.bin'),'-loader','BinaryLoader','-loader-baseAddr','0x0','-processor','x86:LE:64:default','-noanalysis','-scriptPath',path.join(temp,'scripts'),'-postScript','RetkSymbolsStreamingFixture.java',temp],{env,logFile:path.join(temp,'engine.log')});
  assert.match(result.stdout,/RETK_SYMBOLS_STREAMING_PASS/,'real Ghidra streaming fixture passed');
  console.log(result.stdout.match(/RETK_SYMBOLS_STREAMING_PASS[^\r\n]*/)?.[0]);success=true;
} finally {if(success)fs.rmSync(temp,{recursive:true,force:true});else console.error('Streaming fixture diagnostics retained at '+temp);}
