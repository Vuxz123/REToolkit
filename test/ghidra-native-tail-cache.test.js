import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const directory=path.dirname(fileURLToPath(import.meta.url));
const source=fs.readFileSync(process.env.RETK_TAIL_SOURCE??path.resolve(directory,'../scripts/ghidra/RetkAnalysis.java'),'utf8');
function method(signature){const start=source.indexOf(signature);if(start<0)return '';let cursor=source.indexOf('{',start),depth=1;while(depth&&++cursor<source.length){if(source[cursor]==='{')depth++;if(source[cursor]==='}')depth--;}assert.equal(depth,0);return source.slice(start,cursor+1);}
const start=source.indexOf('if(cache.has(key))'),end=source.indexOf('return out;',start);
assert.ok(start>=0&&end>start);
const build=process.env.RETK_TAIL_CACHE_BUILD??fs.mkdtempSync(path.join(os.tmpdir(),'retk-native-tail-cache-'));fs.mkdirSync(build,{recursive:true});
const base=fs.readFileSync(path.join(directory,'fixtures/NativeTailFlowFixture.java.in'),'utf8');
const types=base.slice(base.indexOf(' record Address('),base.indexOf(' /* SOURCE_HELPER */'));
const fixture=fs.readFileSync(path.join(directory,'fixtures/NativeTailCacheFixture.java.in'),'utf8')
 .replace('/* TYPES */',types).replace('/* SOURCE_HELPER */',method('boolean knownArm64TailBranch('))
 .replace('/* SOURCE_VALIDATOR */',method('void validateFunctionFlow(')).replace('/* SOURCE_CACHE */',source.slice(start,end));
fs.writeFileSync(path.join(build,'NativeTailCacheFixture.java'),fixture);
const compiled=spawnSync('javac',['-d',build,path.join(build,'NativeTailCacheFixture.java')],{encoding:'utf8'});
assert.equal(compiled.status,0,compiled.stdout+compiled.stderr);
for(const scenario of ['cached-qualified','cached-missing','cached-replaced-entry','cached-interior','cached-overlap'])test(scenario,()=>{const result=spawnSync('java',['-cp',build,'NativeTailCacheFixture',scenario],{encoding:'utf8'});assert.equal(result.status,0,result.stdout+result.stderr);});
