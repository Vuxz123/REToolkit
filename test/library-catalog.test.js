import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import yazl from 'yazl';
import {scanLibraries} from '../src/libraries/catalog.js';
import {libraryDescriptors} from '../src/libraries/descriptors.js';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'library-catalog-'));
  t.after(() => fs.rm(home, {recursive:true, force:true}));
  const root = path.join(home, 'sources');
  await fs.mkdir(root);
  const cacheDir = path.join(home, '.cache', 'libraries');
  return {home, root, cacheDir, scan: options => scanLibraries({roots:[root],cacheDir,...options})};
}
async function zip(root, name, files) {
  const archive = new yazl.ZipFile();
  for (const [name, bytes] of Object.entries(files)) {
    if(name.endsWith('/'))archive.addEmptyDirectory(name);
    else archive.addBuffer(Buffer.from(bytes), name);
  }
  const chunks = [];
  archive.outputStream.on('data', chunk => chunks.push(chunk));
  const done = new Promise((resolve,reject) => {archive.outputStream.on('end',resolve);archive.outputStream.on('error',reject);});
  archive.end(); await done;
  const file = path.join(root,name); await fs.writeFile(file,Buffer.concat(chunks)); return file;
}
const upm = (name='com.example.fixture',version='1.2.3',extra={}) => JSON.stringify({name,version,...extra});

test('empty roots remain unconfigured without creating cache', async t => {
  const f=await fixture(t); const catalog=await scanLibraries({cacheDir:f.cacheDir});
  assert.equal(catalog.state,'unconfigured');assert.deepEqual(catalog.packages,[]);
  assert.match(catalog.revision,/^[0-9a-f]{64}$/);await assert.rejects(fs.stat(f.cacheDir),{code:'ENOENT'});
});

test('exact UPM metadata inside arbitrary wrappers confirms content and inventories GUIDs',async t=>{
  const f=await fixture(t);const file=await zip(f.root,'Misleading-DOTween-99.zip',{
    'wrapper/deep/pkg/package.json':upm(undefined,undefined,{dependencies:{'com.example.other':'2.0.0'},unity:'2022.3'}),
    'wrapper/deep/pkg/Runtime/Fixture.asmdef':JSON.stringify({name:'Example.Fixture',includePlatforms:['Editor']}),
    'wrapper/deep/pkg/Runtime/Fixture.cs':'namespace Example.Fixture { public class Thing {} }',
    'wrapper/deep/pkg/Runtime/Fixture.cs.meta':'fileFormatVersion: 2\nguid: abcdef0123456789abcdef0123456789\n',
    'README.md':'This is inert data, never executed.'
  });
  const before=await fs.readFile(file);const c=await f.scan();const p=c.packages[0];
  assert.equal(c.state,'indexed');assert.equal(c.packages.length,1);assert.equal(p.libraryId,'com.example.fixture');
  assert.equal(p.format,'upm');assert.equal(p.recognition,'confirmed');assert.equal(p.version,'1.2.3');
  assert.equal(p.root,'wrapper/deep/pkg');assert.equal(p.identity.packageId,p.libraryId);
  assert.deepEqual(p.dependencies,{'com.example.other':'2.0.0'});assert.equal(p.compatibility.unity,'2022.3');
  assert.deepEqual(p.identity.assemblies,['Example.Fixture']);assert.deepEqual(p.identity.namespaces,['Example.Fixture']);
  assert.deepEqual(p.identity.types,['Example.Fixture.Thing']);assert.equal(p.guidInventory[0].guid,'abcdef0123456789abcdef0123456789');
  assert.equal(p.payloadFiles.length,4);assert(p.payloadFiles.every(x=>x.path.startsWith(p.root+'/')));
  assert.equal(c.archives[0].sha256,digest(before));assert.deepEqual(await fs.readFile(file),before);
  const second=await f.scan();assert.equal(second.revision,c.revision);assert.equal(second.packages[0].id,p.id);
  assert.deepEqual((await fs.readdir(f.root)).sort(),['Misleading-DOTween-99.zip']);
});

test('loose namespaces and filename versions only provide candidate hints',async t=>{
  const f=await fixture(t);await zip(f.root,'UniTask-v9.9.9.zip',{'Assets/Plugins/Task.cs':'namespace Cysharp.Threading.Tasks { public class UniTask {} }'});
  const p=(await f.scan()).packages[0];assert.equal(p.format,'assets');assert.equal(p.version,null);
  assert.equal(p.recognition,'candidate');assert.equal(p.libraryId,'unitask');assert(p.limitations.length>0);
  assert(libraryDescriptors.some(d=>d.id==='dotween'));
});

test('range or missing UPM versions cannot be confirmed',async t=>{
  const f=await fixture(t);await zip(f.root,'v42.zip',{'first/package.json':upm('com.example.first','^1.0.0'),'second/package.json':JSON.stringify({name:'com.example.second'})});
  const c=await f.scan();assert.equal(c.packages.length,2);assert(c.packages.every(p=>p.recognition==='candidate'&&p.version===null));
});

test('exact archive descriptor pin can supply missing version but a mismatched hash cannot',async t=>{
  const f=await fixture(t);const archive=await zip(f.root,'fixture.zip',{'Assets/Foo/Foo.asmdef':'{"name":"Foo"}','Assets/Foo/Foo.cs':'namespace Foo { public class Bar {} }'});
  const sha256=digest(await fs.readFile(archive));
  const descriptors=[{id:'foo',namespaces:['Foo'],pins:[{archiveSha256:sha256,root:'Assets',version:'2.3.4'}]}];
  const p=(await f.scan({descriptors})).packages[0];assert.equal(p.recognition,'confirmed');assert.equal(p.version,'2.3.4');assert.equal(p.libraryId,'foo');
  const wrong=(await f.scan({descriptors:[{...descriptors[0],pins:[{archiveSha256:'0'.repeat(64),root:'Assets',version:'2.3.4'}]}]})).packages[0];
  assert.equal(wrong.recognition,'candidate');assert.equal(wrong.version,null);
});

test('unknown DLL and nested unitypackage are classified without execution',async t=>{
  const f=await fixture(t);await zip(f.root,'Newtonsoft-13.zip',{'Unknown.dll':'MZ arbitrary bytes'});
  await zip(f.root,'nested.zip',{'folder/vendor.unitypackage':'not a tar','folder/inner.zip':'not a zip'});
  const c=await f.scan();const dll=c.packages.find(p=>p.archivePath.endsWith('Newtonsoft-13.zip'));
  assert.equal(dll.format,'unsupported');assert.equal(dll.recognition,'unknown');assert.equal(dll.version,null);
  const unity=c.packages.find(p=>p.archivePath.endsWith('nested.zip'));assert.equal(unity.format,'unitypackage');assert.notEqual(unity.recognition,'confirmed');
  assert.match(unity.limitations.join(' '),/unsupported|not inspected/i);
});

test('nested UPM package roots conflict while independent roots remain separate',async t=>{
  const f=await fixture(t);await zip(f.root,'multi.zip',{'a/package.json':upm('com.example.a'),'b/package.json':upm('com.example.b'),'b/nested/package.json':upm('com.example.nested')});
  const c=await f.scan();assert.equal(c.packages.length,3);assert.equal(c.packages.find(p=>p.root==='a').recognition,'confirmed');
  assert(c.packages.filter(p=>p.root.startsWith('b')).every(p=>p.recognition==='conflict'));
});

test('checked extraction rejects CRC tampering and case-colliding ZIP paths',async t=>{
  const f=await fixture(t);await zip(f.root,'bad.zip',{'A/file.cs':'a','a/other.cs':'b'});
  await assert.rejects(f.scan(),/case|collision/i);
  await fs.rm(path.join(f.root,'bad.zip'));
  const archive=await zip(f.root,'crc.zip',{'file.cs':'this content must fail CRC'});
  const bytes=await fs.readFile(archive);const local=bytes.indexOf(Buffer.from([0x50,0x4b,0x03,0x04]));
  bytes.writeUInt32LE((bytes.readUInt32LE(local+14)^0x12345678)>>>0,local+14);
  const central=bytes.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));bytes.writeUInt32LE((bytes.readUInt32LE(central+16)^0x12345678)>>>0,central+16);
  await fs.writeFile(archive,bytes);await assert.rejects(f.scan(),/CRC/i);
});

test('cache paths cannot alias sources and configured roots require real directories',async t=>{
  const f=await fixture(t);await assert.rejects(scanLibraries({roots:[f.root],cacheDir:path.join(f.root,'.cache','libraries')}),/cache|overlap/i);
  await assert.rejects(scanLibraries({roots:[f.root],cacheDir:path.join(f.home,'arbitrary')}),/cache/i);
  const file=path.join(f.home,'file');await fs.writeFile(file,'x');await assert.rejects(scanLibraries({roots:[file],cacheDir:f.cacheDir}),/directory/i);
});

test('Assets metadata requires exact schema, exact version and an actual assembly definition',async t=>{
  const f=await fixture(t);await zip(f.root,'good.zip',{
    'wrapped/assets/.RETK-LIBRARY.JSON':JSON.stringify({kind:'retoolkit-library-metadata',schemaVersion:1,id:'com.example.assets',version:'3.2.1',dependencies:{'com.example.base':'1.0.0'}}),
    'wrapped/assets/Runtime/Good.asmdef':'{"name":"Example.Assets"}',
    'wrapped/assets/Runtime/Good.cs':'namespace Example.Assets { public class Good {} }',
    'wrapped/README.md':'excluded'
  });
  const p=(await f.scan()).packages[0];assert.equal(p.format,'assets');assert.equal(p.recognition,'confirmed');
  assert.equal(p.version,'3.2.1');assert.equal(p.libraryId,'com.example.assets');assert.equal(p.identity.packageId,null);
  assert.deepEqual(p.dependencies,{'com.example.base':'1.0.0'});assert(p.payloadFiles.every(x=>x.path.startsWith('wrapped/assets/')));
  await zip(f.root,'unproved.zip',{'Assets/.retk-library.json':JSON.stringify({kind:'retoolkit-library-metadata',schemaVersion:1,id:'com.example.unproved',version:'1.0.0'}),'Assets/A.cs':'public class A {}'});
  const unknown=(await f.scan()).packages.find(x=>x.archivePath.endsWith('unproved.zip'));assert.notEqual(unknown.recognition,'confirmed');
});

test('unsupported C# declarations never fabricate full type identities',async t=>{
  const f=await fixture(t);await zip(f.root,'nested.zip',{'package.json':upm(),'Thing.cs':'namespace Outer { public class Top { public class Nested {} } }'});
  const p=(await f.scan()).packages[0];assert.deepEqual(p.identity.types,[]);
  assert(p.evidence.some(x=>x.kind==='unsupported-source-declarations'));assert.match(p.limitations.join(' '),/nested|declaration/i);
});

test('noncanonical UPM manifest case and invalid semver cannot become confirmed',async t=>{
  const f=await fixture(t);await zip(f.root,'case.zip',{'Package.JSON':upm()});
  await zip(f.root,'invalid.zip',{'package.json':upm('com.example.invalid','1.0.0-..')});
  const c=await f.scan();assert(c.packages.every(x=>x.recognition!=='confirmed'));
});

test('duplicate GUIDs and conflicting content pins stay conflicts',async t=>{
  const f=await fixture(t);const archive=await zip(f.root,'dupe.zip',{'package.json':upm(),'A.cs.meta':'guid: 0123456789abcdef0123456789abcdef\n','B.cs.meta':'guid: 0123456789abcdef0123456789abcdef\n'});
  const sha256=digest(await fs.readFile(archive));
  const p=(await f.scan({descriptors:[{id:'one',pins:[{archiveSha256:sha256,root:'',version:'2.0.0'}]}]})).packages[0];
  assert.equal(p.recognition,'conflict');assert.match(p.limitations.join(' '),/GUID|conflicts/);
});

test('metadata is inert and invalid descriptor adapters are rejected',async t=>{
  const f=await fixture(t);const sentinel=path.join(f.home,'executed');
  await zip(f.root,'inert.zip',{'package.json':upm(undefined,undefined,{scripts:{postinstall:`create ${sentinel}`}}),'postinstall.js':`throw Error('never execute')`});
  assert.equal((await f.scan()).packages[0].recognition,'confirmed');await assert.rejects(fs.stat(sentinel),{code:'ENOENT'});
  await assert.rejects(f.scan({descriptors:[{id:'adapter',run:'node evil.js'}]}),/descriptor/i);
  await assert.rejects(f.scan({descriptors:[{id:'adapter',pins:[{archiveSha256:'0'.repeat(64),root:'../escape',version:'1.0.0'}]}]}),/root|descriptor/i);
});

test('directory and cache junctions are refused before reading or writing their target',async t=>{
  const f=await fixture(t);const target=path.join(f.home,'target');await fs.mkdir(target);
  await fs.symlink(target,path.join(f.root,'linked'),'junction');await assert.rejects(f.scan(),/link|junction/i);
  await fs.rm(path.join(f.root,'linked'));await fs.mkdir(path.dirname(f.cacheDir),{recursive:true});
  await fs.symlink(target,f.cacheDir,'junction');await assert.rejects(f.scan(),/link|junction/i);
  assert.deepEqual(await fs.readdir(target),[]);
});

test('archive count limit fails before unbounded processing',async t=>{
  const f=await fixture(t);await zip(f.root,'000.zip',{'a':'one'});
  for(let i=1;i<257;i++)await fs.copyFile(path.join(f.root,'000.zip'),path.join(f.root,`${String(i).padStart(3,'0')}.zip`));
  await assert.rejects(f.scan(),/256|count/i);assert.equal((await fs.readdir(f.root)).length,257);
});

test('traversal ZIP names cannot escape the private extraction root',async t=>{
  const f=await fixture(t);const archive=await zip(f.root,'traversal.zip',{'safe/file':'data'});
  const original=await fs.readFile(archive);const bytes=Buffer.from(original);
  for(let at=0;(at=bytes.indexOf(Buffer.from('safe/file'),at))>=0;at+=9)bytes.write('../escape',at,'utf8');
  await fs.writeFile(archive,bytes);await assert.rejects(f.scan(),/invalid relative|unsafe|traversal/i);
  assert.deepEqual(await fs.readFile(archive),bytes);assert.deepEqual(await fs.readdir(f.cacheDir),[]);
  await assert.rejects(fs.stat(path.join(f.home,'.cache','escape')),{code:'ENOENT'});
});

test('oversized metadata is opaque and cannot establish a release identity',async t=>{
  const f=await fixture(t);await zip(f.root,'large.zip',{'package.json':JSON.stringify({name:'com.example.huge',version:'1.0.0',padding:'x'.repeat(4*1024**2)})});
  const p=(await f.scan()).packages[0];assert.equal(p.recognition,'unknown');assert.equal(p.version,null);assert.match(p.limitations.join(' '),/4 MiB/);
});

test('descriptor metadata is bounded before deep copying records',async t=>{
  const f=await fixture(t);const descriptors=Array.from({length:32},(_,i)=>({id:`record${i}`,namespaces:Array(256).fill('N'.repeat(512))}));
  await assert.rejects(f.scan({descriptors}),/descriptor.*budget|descriptor.*limit/i);
});

test('invalid Assets schema, missing assembly names and impostor path segments stay unconfirmed',async t=>{
  const f=await fixture(t);await zip(f.root,'wrong.zip',{'MyAssets/A.cs':'namespace DG.Tweening { public class A {} }'});
  await zip(f.root,'bad-metadata.zip',{'Assets/.retk-library.json':JSON.stringify({kind:'retoolkit-library-metadata',schemaVersion:1,id:'foo',version:'1.0.0',execute:'evil'}),'Assets/Foo.asmdef':'{"name":"Foo"}'});
  await zip(f.root,'bad-assembly.zip',{'Assets/.retk-library.json':JSON.stringify({kind:'retoolkit-library-metadata',schemaVersion:1,id:'foo',version:'1.0.0'}),'Assets/Foo.asmdef':'{"name":""}'});
  const c=await f.scan();assert(c.packages.every(p=>p.recognition!=='confirmed'));
  assert.equal(c.packages.find(p=>p.archivePath.endsWith('wrong.zip')).format,'unsupported');
});

test('DLLs, WinMD and malformed assembly metadata expose missing static identity evidence',async t=>{
  const f=await fixture(t);await zip(f.root,'mixed.zip',{'package.json':upm(),'Runtime/Foo.dll':'MZ inert fixture','Runtime/Foo.WINMD':'MZ inert fixture','Runtime/Foo.asmdef':'{"name":null}'});
  const p=(await f.scan()).packages[0];assert.equal(p.recognition,'confirmed');
  assert(p.evidence.some(x=>x.kind==='unsupported-managed-metadata'&&x.path==='Runtime/Foo.dll'));
  assert(p.evidence.some(x=>x.kind==='unsupported-managed-metadata'&&x.path==='Runtime/Foo.WINMD'));
  assert(p.evidence.some(x=>x.kind==='unsupported-assembly-definition'&&x.path==='Runtime/Foo.asmdef'));
  assert.deepEqual(p.identity.assemblies,[]);assert.match(p.limitations.join(' '),/DLL|assembly/i);
});

test('Runtime and Editor assembly filters remain per-assembly evidence',async t=>{
  const f=await fixture(t);await zip(f.root,'runtime-editor.zip',{
    'package.json':upm(),
    'Runtime/Fixture.asmdef':JSON.stringify({name:'Fixture.Runtime',references:['Unity.TextMeshPro'],excludePlatforms:['WebGL'],defineConstraints:['HAS_FIXTURE'],versionDefines:[{name:'com.unity.textmeshpro',expression:'[3.0.0,4.0.0)',define:'TMP_3'}]}),
    'Editor/Fixture.Editor.asmdef':JSON.stringify({name:'Fixture.Editor',references:['Fixture.Runtime'],includePlatforms:['Editor']}),
    'Runtime/Fixture.cs':'namespace Fixture { public class Runtime {} }'
  });
  const p=(await f.scan()).packages[0];assert.equal(p.recognition,'confirmed');assert.deepEqual(p.compatibility.platforms,[]);
  const editor=p.evidence.find(x=>x.kind==='assembly-settings'&&x.path==='Editor/Fixture.Editor.asmdef');
  assert.deepEqual(editor.value.includePlatforms,['Editor']);
  const runtime=p.evidence.find(x=>x.kind==='assembly-settings'&&x.path==='Runtime/Fixture.asmdef');
  assert.deepEqual(runtime.value.excludePlatforms,['WebGL']);assert.deepEqual(runtime.value.references,['Unity.TextMeshPro']);
  assert.deepEqual(runtime.value.defineConstraints,['HAS_FIXTURE']);assert.equal(runtime.value.versionDefines[0].define,'TMP_3');
  assert.match(p.limitations.join(' '),/assembly.*settings.*unverified/i);
});

test('native payloads and PluginImporter settings expose unverified native evidence',async t=>{
  const f=await fixture(t);await zip(f.root,'native.zip',{
    'package.json':upm(),
    'Plugins/libfoo.SO':'native bytes','Plugins/libfoo.dylib':'native bytes','Plugins/libfoo.a':'native bytes','Plugins/android.aar':'archive bytes',
    'Plugins/mac.bundle/Contents/MacOS/opaque':'native bytes','Plugins/unknown.bin':'opaque bytes',
    'Plugins/empty.bundle/':'',
    'Plugins/android.jar':'archive bytes','Plugins/win.lib':'native bytes','Plugins/apple.framework/opaque':'native bytes','Plugins/apple.xcframework/opaque':'native bytes',
    'Plugins/unknown.bin.meta':'fileFormatVersion: 2\nguid: abcdef0123456789abcdef0123456789\nPluginImporter:\n  platformData: []\n'
  });
  const p=(await f.scan()).packages[0];const evidence=p.evidence.filter(x=>x.kind==='unsupported-native-plugin');
  assert.deepEqual(evidence.map(x=>x.path).sort(),['Plugins/android.aar','Plugins/android.jar','Plugins/win.lib','Plugins/apple.framework','Plugins/apple.xcframework','Plugins/libfoo.SO','Plugins/libfoo.a','Plugins/libfoo.dylib','Plugins/mac.bundle','Plugins/empty.bundle','Plugins/unknown.bin.meta'].sort());
  assert.match(p.limitations.join(' '),/native.*unverified|native.*unproven/i);assert.deepEqual(p.compatibility.platforms,[]);
});

test('unbounded asmdef metadata arrays stay unsupported rather than being retained',async t=>{
  const f=await fixture(t);await zip(f.root,'asmdef-limit.zip',{'package.json':upm(),'Foo.asmdef':JSON.stringify({name:'Foo',references:Array(257).fill('Bar')})});
  const p=(await f.scan()).packages[0];assert(p.evidence.some(x=>x.kind==='unsupported-assembly-definition'));
  assert(!p.evidence.some(x=>x.kind==='assembly-settings'&&x.value.references?.length>256));
});

test('ordinary wrappers ending in file-only plugin suffixes do not become native plugins',async t=>{
  const f=await fixture(t);const files={'com.example.lib/':'','com.example.lib/package.json':upm('com.example.lib')};
  for(const suffix of ['a','lib','so.1','dylib','aar','jar']){
    files[`com.example.lib/ordinary.${suffix}/`]='';files[`com.example.lib/ordinary.${suffix}/README.txt`]='ordinary folder';
  }
  await zip(f.root,'wrapper.zip',files);const catalog=await f.scan(),p=catalog.packages[0];
  assert.equal(p.root,'com.example.lib');assert.equal(p.recognition,'confirmed');assert(!p.evidence.some(x=>x.kind==='unsupported-native-plugin'));
  const {createLibraryPlan}=await import('../src/libraries/resolver.js');
  const graph={kind:'retoolkit-asset-graph',schemaVersion:1,revision:digest('graph'),binding:{build:'fixture'},unityVersion:'2022.3.62f1',files:[],assets:[],nodes:[],edges:[],limitations:[]};
  const plan=createLibraryPlan({graph,catalog,requirements:[{id:'com.example.lib',version:'1.2.3'}]});
  assert.equal(plan.state,'ready',JSON.stringify(plan.issues));
});

test('opaque source cannot hide declarations beside an otherwise supported source file',async t=>{
  const f=await fixture(t);await zip(f.root,'opaque-source.zip',{'package.json':upm(),'Small.cs':'namespace Fixture { public class Small {} }','Large.cs':'/*'+'x'.repeat(4*1024**2)+'*/ namespace Hidden { public class Duplicate {} }'});
  const p=(await f.scan()).packages[0];assert.deepEqual(p.identity.types,['Fixture.Small']);
  assert(p.evidence.some(x=>x.kind==='unsupported-source-declarations'&&x.path==='Large.cs'));assert.match(p.limitations.join(' '),/opaque.*source|source.*opaque/i);
});

test('every provided meta requires one valid GUID and parseable metadata',async t=>{
  const f=await fixture(t);await zip(f.root,'opaque-meta.zip',{
    'package.json':upm(),'Small.cs':'public class Small {}',
    'Large.cs.meta':'#'+'x'.repeat(4*1024**2),
    'Malformed.cs.meta':'guid: not-a-guid\n',
    'Missing.cs.meta':'fileFormatVersion: 2\n',
    'Yaml.cs.meta':'guid: abcdef0123456789abcdef0123456789\nPluginImporter: [unterminated\n',
    'Folder.meta':'fileFormatVersion: 2\nguid: 01234567890123456789012345678901\nfolderAsset: yes\n',
    'Quoted.meta':'fileFormatVersion: 2\nguid: "abcdef0123456789abcdef0123456789"\n'
  });
  const p=(await f.scan()).packages[0];const unsupported=p.evidence.filter(x=>x.kind==='unsupported-guid-inventory').map(x=>x.path).sort();
  assert.deepEqual(unsupported,['Large.cs.meta','Malformed.cs.meta','Missing.cs.meta','Yaml.cs.meta']);
  assert(p.guidInventory.some(x=>x.path==='Folder'&&x.guid==='01234567890123456789012345678901'));
  assert(p.guidInventory.some(x=>x.path==='Quoted'&&x.guid==='abcdef0123456789abcdef0123456789'));
});

test('namespace hints and exact pins cannot erase malformed GUID conflicts',async t=>{
  const f=await fixture(t);const archive=await zip(f.root,'conflict.zip',{'Assets/Foo.cs':'namespace DG.Tweening { public class Foo {} }','Assets/Foo.cs.meta':'guid: malformed\n'});
  const archiveSha256=digest(await fs.readFile(archive));
  const p=(await f.scan({descriptors:[{id:'dotween',pins:[{archiveSha256,root:'Assets',version:'1.0.0'}]}]})).packages[0];
  assert.equal(p.recognition,'conflict');assert(p.evidence.some(x=>x.kind==='unsupported-guid-inventory'));
});
