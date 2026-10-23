import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const editorPath='C:/Program Files/Unity/Hub/Editor/2022.3.62f2/Editor/Unity.exe';
const realCompiler=process.platform==='win32'&&fs.existsSync(editorPath);
async function fixture(t){
 const projectDir=fs.mkdtempSync(path.join(os.tmpdir(),'retk-source-contract-test-'));
 fs.mkdirSync(path.join(projectDir,'ProjectSettings'));
 fs.writeFileSync(path.join(projectDir,'ProjectSettings/ProjectVersion.txt'),'m_EditorVersion: 2022.3.62f2\n');
 t.after(()=>fs.rmSync(projectDir,{recursive:true,force:true}));
 const api=await import('../src/reconstruction/source-contract.js').catch(()=>({}));
 assert.equal(typeof api.assertBodyReplacement,'function','compiler-backed replacement API must exist');
 return {...api,projectDir,editorPath};
}

test('Roslyn contract allows only existing bodies and reports generic nested metadata identities',{skip:!realCompiler},async t=>{
 const {assertBodyReplacement,projectDir,editorPath}=await fixture(t);
 const before='using System; namespace Game { public class Table<T,U> where T:class { private readonly int seed = 3; public int Slot => 1; public int Layer { get { return 1; } private set { } } public class Box<V> { public V Read() { return default(V); } } } }';
 const after=before.replace('Slot => 1','Slot => 2').replace('return 1;','return 9;').replace('return default(V);','throw new Exception("{fake class Evil{}}");');
 const result=await assertBodyReplacement({projectDir,editorPath,before,after});
 assert.equal(result.kind,'retoolkit-csharp-body-contract');
 assert.deepEqual(result.types.map(x=>[x.fullName,x.arity,x.topLevel]),[['Game.Table`2',2,true],['Game.Table`2+Box`1',1,false]]);
 assert.match(result.parser.helperSha256,/^[a-f0-9]{64}$/);
 for(const [needle,replacement] of [['seed = 3','seed = 4'],['where T:class','where T:struct'],['private set','set'],['using System;','using System.Text;'],['Table<T,U>','Table<U,T>'],['Slot => 1;','Slot { get; }']]){
  await assert.rejects(assertBodyReplacement({projectDir,editorPath,before,after:before.replace(needle,replacement)}),{code:'source_contract_mismatch'});
 }
});

test('Roslyn preserves complete initializer and attribute tokens and rejects lexical ambiguity',{skip:!realCompiler},async t=>{
 const {assertBodyReplacement,createSourceContract,projectDir,editorPath}=await fixture(t);
 const before='class C { [field: SerializeReference] public object Value { get; private set; } = Factory(() => "class Hidden {}"); string text = @"{ }"; int M() { return 0; } }';
 for(const after of [before.replace('SerializeReference','SerializeField'),before.replace('class Hidden {}','class Evil {}'),before.replace('@"{ }"','@"{}"'),before.replace('private set','set')])
  await assert.rejects(assertBodyReplacement({projectDir,editorPath,before,after}),{code:'source_contract_mismatch'});
 for(const source of ['#if HIDDEN\nclass Hidden {}\n#endif\nclass C {}','partial class C {}','class C { int M( { }','class C { int M() { return 1; } /*'])
  await assert.rejects(createSourceContract({projectDir,editorPath,source}),{code:'source_contract_invalid'});
});

test('batch analysis reports incomplete identity inventories and partial identities without claiming support',{skip:!realCompiler},async t=>{
 const {analyzeSourceContracts,projectDir,editorPath}=await fixture(t);
 const result=await analyzeSourceContracts({projectDir,editorPath,documents:[{path:'A.cs',source:'namespace N { partial class C<T> {} }'},{path:'B.cs',source:'#if OFF\nclass C {}\n#endif'},{path:'C.cs',source:'namespace N { class C<T> {} }'}]});
 assert.equal(result.documents[0].supported,false);
 assert.equal(result.documents[0].identitiesComplete,true);
 assert.equal(result.documents[0].types[0].fullName,'N.C`1');
 assert.equal(result.documents[1].identitiesComplete,false);
 assert.equal(result.documents[2].supported,true);
});

test('source input is bounded, strict UTF-8 and cancellation is checked before invoking tools',async t=>{
 const api=await import('../src/reconstruction/source-contract.js').catch(()=>({}));
 assert.equal(typeof api.createSourceContract,'function','compiler-backed replacement API must exist');
 for(const source of ['a'.repeat(1024*1024+1),'class C { string x="\ud800"; }',Buffer.from([0xff])])
  await assert.rejects(api.createSourceContract({projectDir:'.',source}),{code:'source_contract_invalid'});
 const controller=new AbortController();controller.abort();
 await assert.rejects(api.createSourceContract({projectDir:'.',source:'class C {}',signal:controller.signal}),{name:'AbortError'});
});

test('all executable member forms are opaque while bases, initializer lambdas and constructor initializers remain exact',{skip:!realCompiler},async t=>{
 const {analyzeSourceContracts,projectDir,editorPath}=await fixture(t);
 const source=`namespace Game {
 class SoTable<TTable,TRow> : Base<TTable,TRow>, ITable<TTable,TRow> where TTable : SoTable<TTable,TRow> {
   private System.Func<int> cached = () => { return 3; };
   public SoTable() : base(42) { var text = $"{{fake}} {1}"; }
   ~SoTable() { Cleanup(); }
   public static SoTable<TTable,TRow> operator +(SoTable<TTable,TRow> x, int y) { return x; }
   public static explicit operator int(SoTable<TTable,TRow> x) => 1;
   int IThing.Value => 2;
   public int this[int i] => i + 1;
   public event System.Action Change { add { Use(value); } remove { Forget(value); } }
   public class Shelve { public int Value() => 10; }
 }
}`;
 const cases=[source,source.replace('var text = $"{{fake}} {1}";','throw new System.Exception(@"} class Forged {} {");').replace('Cleanup();','Other();').replace('return x;','throw null;').replace('x) => 1','x) => 8').replace('Value => 2','Value => 9').replace('=> i + 1','=> i + 3').replace('Use(value);','Other(value);').replace('Forget(value);','Use(value);').replace('Value() => 10','Value() => 20'),source.replace('Base<TTable,TRow>','Base<TRow,TTable>'),source.replace('base(42)','base(43)'),source.replace('return 3;','return 4;'),source.replace('int IThing.Value','int IOther.Value')];
 const result=await analyzeSourceContracts({projectDir,editorPath,documents:cases.map((value,index)=>({path:`${index}.cs`,source:value}))});
 assert.ok(result.documents.every(x=>x.supported));
 const [before,changed,...declarations]=result.documents;
 assert.equal(before.skeletonSha256,changed.skeletonSha256);
 assert.ok(declarations.every(x=>x.skeletonSha256!==before.skeletonSha256));
 assert.deepEqual(before.types[0].baseTypes,['Base<TTable,TRow>','ITable<TTable,TRow>']);
});

test('unsupported inventory sees inactive identifiers and exposes Unicode uncertainty',{skip:!realCompiler},async t=>{
 const {analyzeSourceContracts,projectDir,editorPath}=await fixture(t);
 const result=await analyzeSourceContracts({projectDir,editorPath,documents:[{path:'off.cs',source:'#if OFF\nclass Singleton<T> {}\n#endif'},{path:'escaped.cs',source:'#if OFF\nclass S\\u0069ngleton<T> {}\n#endif'}]});
 assert.ok(result.documents[0].identityNames.includes('Singleton'));
 assert.equal(result.documents[1].identityUncertain,true);
});

test('declaration limits apply to field variables and raw literals fail closed on unsupported Roslyn versions',{skip:!realCompiler},async t=>{
 const {analyzeSourceContracts,createSourceContract,projectDir,editorPath}=await fixture(t);
 await assert.rejects(createSourceContract({projectDir,editorPath,source:`class C { int ${Array.from({length:10001},(_,i)=>`field${i}`).join(',')}; }`}),{code:'source_contract_invalid'});
 const raw='class C { string M() { return """class Fake { }"""; } }';
 const result=await analyzeSourceContracts({projectDir,editorPath,documents:[{path:'raw.cs',source:raw},{path:'raw2.cs',source:raw.replace('class Fake { }','class Evil { }')}]});
 if(result.documents[0].supported)assert.equal(result.documents[0].skeletonSha256,result.documents[1].skeletonSha256);
 else assert.equal(result.documents[0].identitiesComplete,false);
});

test('parser attests every hostfxr version and rejects host inventory growth during analysis',{skip:!realCompiler},async t=>{
 const {createSourceContract,projectDir}=await fixture(t);
 const install=path.dirname(editorPath),owned=path.join(projectDir,'OwnedEditor'),ownedEditor=path.join(owned,'Unity.exe');
 const linkTree=(source,destination)=>{
  const stat=fs.lstatSync(source);
  assert.equal(stat.isSymbolicLink(),false);
  if(stat.isDirectory()){
   fs.mkdirSync(destination,{recursive:true});
   for(const name of fs.readdirSync(source))linkTree(path.join(source,name),path.join(destination,name));
  }else fs.copyFileSync(source,destination,fs.constants.COPYFILE_FICLONE);
 };
 fs.mkdirSync(owned);fs.copyFileSync(editorPath,ownedEditor,fs.constants.COPYFILE_FICLONE);
 linkTree(path.join(install,'Data/DotNetSdkRoslyn'),path.join(owned,'Data/DotNetSdkRoslyn'));
 linkTree(path.join(install,'Data/NetCoreRuntime'),path.join(owned,'Data/NetCoreRuntime'));
 const input={projectDir,editorPath:ownedEditor,source:'class C { int M() { return 1; } }'};
 const baseline=await createSourceContract(input),fxr=path.join(owned,'Data/NetCoreRuntime/host/fxr');
 const runtimeConfig=path.join(owned,'Data/DotNetSdkRoslyn/csc.runtimeconfig.json'),configuration=JSON.parse(fs.readFileSync(runtimeConfig,'utf8'));
 fs.writeFileSync(runtimeConfig,JSON.stringify({...configuration,retkFixture:'configuration identity changed'}));
 const reconfigured=await createSourceContract(input);
 assert.notDeepEqual(baseline.parser,reconfigured.parser,'compiler configuration bytes must bind the returned parser identity');
 assert.deepEqual(reconfigured.parser.compilerConfiguration.map(row=>path.basename(row.path)),['csc.runtimeconfig.json','csc.deps.json']);
 const originalVersion=fs.readdirSync(fxr).find(version=>fs.existsSync(path.join(fxr,version,'hostfxr.dll')));
 const extra=path.join(fxr,'99.0.0');fs.mkdirSync(extra);
 fs.copyFileSync(path.join(fxr,originalVersion,'hostfxr.dll'),path.join(extra,'hostfxr.dll'),fs.constants.COPYFILE_FICLONE);
 const added=await createSourceContract(input);
 assert.notEqual(baseline.parser.runtime.sha256,added.parser.runtime.sha256,'a hostfxr version selected independently of framework version must affect the parser identity');
 // The timer runs after synchronous input attestation, while compiler execution
 // is awaited. Add only owned files; installed runtime bytes are never changed.
 const timer=setTimeout(()=>fs.mkdirSync(path.join(extra,'new-input-directory')),0);
 try{await assert.rejects(createSourceContract(input),{code:'source_contract_parser_unavailable'});}finally{clearTimeout(timer);}
});
