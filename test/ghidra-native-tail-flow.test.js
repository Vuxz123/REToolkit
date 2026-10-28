import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const directory=path.dirname(fileURLToPath(import.meta.url));
const source=fs.readFileSync(process.env.RETK_TAIL_SOURCE??path.resolve(directory,'../scripts/ghidra/RetkAnalysis.java'),'utf8');
const start=source.indexOf('var code=program.getListing().getInstructions(body,true);');
const validatorEnd=source.indexOf('\n    }',start);
const end=source.includes('void validateFunctionFlow(')?validatorEnd:source.indexOf('Function f=program.getFunctionManager().getFunctionAt(a);',start);
assert.ok(start>=0&&end>start,'Find the actual production flow validation loop');
// Execute source-owned Java, never a JavaScript port of its decision logic.
const helperStart=source.indexOf('boolean knownArm64TailBranch(');
let helper='';
if(helperStart>=0){
 let cursor=source.indexOf('{',helperStart),depth=1;
 while(depth&&++cursor<source.length){if(source[cursor]==='{')depth++;if(source[cursor]==='}')depth--;}
 assert.equal(depth,0,'Complete source-owned helper');helper=source.slice(helperStart,cursor+1);
}
const build=process.env.RETK_TAIL_BUILD??fs.mkdtempSync(path.join(os.tmpdir(),'retk-native-tail-'));fs.mkdirSync(build,{recursive:true});
const fixture=fs.readFileSync(path.join(directory,'fixtures/NativeTailFlowFixture.java.in'),'utf8')
 .replace('/* SOURCE_HELPER */',helper).replace('/* SOURCE_VALIDATION */',source.slice(start,end));
fs.writeFileSync(path.join(build,'NativeTailFlowFixture.java'),fixture);
const compiled=spawnSync('javac',['-d',build,path.join(build,'NativeTailFlowFixture.java')],{encoding:'utf8'});
assert.equal(compiled.status,0,compiled.stdout+compiled.stderr);
for(const scenario of ['known-tail','lowercase-tail','unknown-external','interior-target','overlapping-callee','wrong-language','wrong-mnemonic','conditional','computed','non-jump','multiple-targets','fallthrough','local-fallthrough','local-branch','ordinary-call','indirect-local']){
 test(scenario,()=>{const result=spawnSync('java',['-cp',build,'NativeTailFlowFixture',scenario],{encoding:'utf8'});assert.equal(result.status,0,result.stdout+result.stderr);});
}
