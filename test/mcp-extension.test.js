import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pipeline} from 'node:stream/promises';
import {createWriteStream} from 'node:fs';
import yazl from 'yazl';
import {inspectExtensionZip} from './helpers/mcp-extension.mjs';
test('extension qualification checks static version/layout and hashes exact archive bytes',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'retk-extension-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const ghidra=path.join(root,'ghidra');await fs.mkdir(path.join(ghidra,'Ghidra'),{recursive:true});await fs.writeFile(path.join(ghidra,'Ghidra/application.properties'),'application.version=12.1.2\n');
 async function archive(version='12.1.2',name='GhidraMCP',duplicate=false){const z=new yazl.ZipFile(),file=path.join(root,`fixture-${version}-${name}-${duplicate}.zip`);z.addBuffer(Buffer.from(`name=${name}\nversion=${version}\ndescription=Plugin version 6.0.0.\n`),'GhidraMCP/extension.properties');z.addBuffer(Buffer.from('MODULE FILE LICENSE: BSD\n'),'GhidraMCP/Module.manifest');z.addBuffer(Buffer.from('fixture inert JAR bytes'),'GhidraMCP/lib/GhidraMCP.jar');if(duplicate)z.addBuffer(Buffer.from('name=GhidraMCP\nversion=12.1.2\n'),'duplicate/extension.properties');z.end();await pipeline(z.outputStream,createWriteStream(file));return file;}
 const file=await archive(),result=await inspectExtensionZip(file,ghidra,'6.0.0',path.join(root,'inspect-good'));assert.equal(result.state,'static-metadata-matching');assert.equal(result.sha256.length,64);assert.equal(result.guiActivation,'not-qualified');assert.equal(result.ghidraVersion,'12.1.2');
 for(const [zip,version,sub] of [[file,'5.0.0','bridge'],[await archive('12.0'),'6.0.0','ghidra'],[await archive('12.1.2','Other'),'6.0.0','name'],[await archive('12.1.2','GhidraMCP',true),'6.0.0','duplicate']])await assert.rejects(inspectExtensionZip(zip,ghidra,version,path.join(root,'inspect-'+sub)),{code:'MCP_EXTENSION_INVALID'});
});
test('upstream empty Module.manifest is a valid module marker',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'retk-extension-empty-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.mkdir(path.join(root,'ghidra/Ghidra'),{recursive:true});await fs.writeFile(path.join(root,'ghidra/Ghidra/application.properties'),'application.version=12.1.2\n');const z=new yazl.ZipFile();for(const [name,text]of [['extension.properties','name=GhidraMCP\nversion=12.1.2\ndescription=Plugin version 6.0.0.\n'],['Module.manifest',''],['lib/plugin.jar','inert fixture']])z.addBuffer(Buffer.from(text),'GhidraMCP/'+name);z.end();const file=path.join(root,'extension.zip');await pipeline(z.outputStream,createWriteStream(file));assert.equal((await inspectExtensionZip(file,path.join(root,'ghidra'),'6.0.0',path.join(root,'inspection'))).state,'static-metadata-matching');
});
test('extension extraction refuses unsafe link entries before inspecting installed Ghidra',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'retk-extension-link-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const z=new yazl.ZipFile();z.addBuffer(Buffer.from('outside'),'GhidraMCP/lib/plugin.jar',{mode:0o120777});z.end();const file=path.join(root,'unsafe.zip');await pipeline(z.outputStream,createWriteStream(file));await assert.rejects(inspectExtensionZip(file,path.join(root,'absent-ghidra'),'6.0.0',path.join(root,'inspection')),{code:'TOOLCHAIN_ARCHIVE_INVALID'});
});
