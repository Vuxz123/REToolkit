import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fixture} from './visual-fixture.js';
const api=()=>import('../src/visual/cli.js');
const id='11111111-1111-4111-8111-111111111111';
test('visual parser supports strict compare/report options and global options before group',async()=>{
 const {parseVisualArgs,isVisualCommand}=await api();assert.equal(isVisualCommand(['--root','C:/toolkit','--json','visual','compare','Game']),true);assert.equal(isVisualCommand(['assets','list','Game']),false);
 assert.deepEqual(parseVisualArgs(['--root=C:/toolkit','visual','compare','Game','--request=input.json','--json']),{method:'visual.compare',name:'Game',params:{},options:{root:'C:/toolkit',request:'input.json',json:true}});
 assert.deepEqual(parseVisualArgs(['visual','report','Game','--operation',id,'--section','findings','--limit','2','--cursor','abc']).params,{operationId:id,section:'findings',limit:2,cursor:'abc'});
 assert.equal(parseVisualArgs(['visual','--help']).help,true);
 for(const argv of [ ['visual','compare','Game'],['visual','report','Game'],['visual','compare','Game','--request','x','--out','y'],['visual','compare','Game','--request','x','--request=x'],['visual','report','Game','--operation',id,'--limit','129'],['visual','report','Game','--operation',id,'--limit','1e1'],['visual','report','Game','--operation',id,'--section','raw'],['visual','compare','Game','--request','x','--operation',id],['visual','report','Game','--operation',id,'--request','x'],['visual','report','Game','--operation','bad'],['visual','compare','..','--request','x'],['visual','compare','Game','extra','--request','x'],['visual','--help','--unknown'],['visual','--json=true','--help'],['visual','--json','--json','--help'] ])assert.throws(()=>parseVisualArgs(argv),/visual|argument|option|limit|section|operation|workspace|request/i);
});
test('visual CLI uses real bounded services and preserves stale outcomes',async t=>{
 const f=await fixture(t),{runVisualCli}=await api(),requestFile=path.join(f.root,'request.json');fs.writeFileSync(requestFile,JSON.stringify(f.request));const lines=[];
 const result=await runVisualCli(['visual','compare','Game','--request',requestFile,'--root',f.root,'--json'],f.root,{write:s=>lines.push(s)});assert.equal(result.visualFidelity,'pass');assert.equal(JSON.parse(lines.pop()).operationId,result.operationId);
 f.image('candidate.png',true);const stale=await runVisualCli(['visual','report','Game','--operation',result.operationId,'--json'],f.root,{write:s=>lines.push(s)});assert.equal(stale.visualFidelity,'unverified');assert.equal(stale.stale,true);assert.ok(Buffer.byteLength(lines.pop())<1024**2);
 await runVisualCli(['visual','--help'],f.root,{write:s=>lines.push(s)});assert.match(lines.pop(),/visual compare/);
});
test('visual MCP schema exports typed DTOs without exposing process options',async()=>{
 const {visualDefinitions,visualRequestSchema}=await import('../src/visual/definitions.js');assert.deepEqual(Object.keys(visualDefinitions),['visual.compare','visual.report']);assert.deepEqual(visualDefinitions['visual.compare'].required,['request']);assert.equal(visualRequestSchema.type,'object');assert.equal(visualRequestSchema.additionalProperties,false);assert.equal(visualRequestSchema.properties.requiredRegions.maxItems,128);assert.equal(visualDefinitions['visual.report'].properties.limit.maximum,128);assert.equal(Object.hasOwn(visualRequestSchema.properties,'runFrame'),false);
});
