import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parseLibraryArgs} from '../src/libraries/cli.js';
test('library CLI exposes fixed operations with bounded typed options',()=>{
 assert.equal(parseLibraryArgs(['libraries','roots','add','C:/library-zips']).method,'libraries.roots.add');
 assert.equal(parseLibraryArgs(['libraries','plan','Game','--requirements','req.json']).name,'Game');
 assert.equal(parseLibraryArgs(['libraries','list','--limit','20']).params.limit,20);
 assert.equal(parseLibraryArgs(['libraries','identify','Game','--section','installed']).params.section,'installed');
 for(const args of [['libraries','import','Game'],['libraries','scan','--url','http://x'],['libraries','list','--limit','0'],['libraries','plan','Game','extra'],['libraries','roots','add']])assert.throws(()=>parseLibraryArgs(args));
 const run=spawnSync(process.execPath,['re.js','libraries','--help'],{cwd:pathRoot(),encoding:'utf8'});assert.equal(run.status,0,run.stderr);assert.match(run.stdout,/libraries scan/);
});
function pathRoot(){return fileURLToPath(new URL('..',import.meta.url));}
