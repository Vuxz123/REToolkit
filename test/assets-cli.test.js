import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parseAssetArgs} from '../src/assets/cli.js';
const entry=fileURLToPath(new URL('../re.js',import.meta.url));
test('assets CLI accepts only typed bounded commands and selectors',()=>{
  assert.deepEqual(parseAssetArgs(['assets','refs','Game','--id','object:a:9007199254740993','--limit','10']).params,{id:'object:a:9007199254740993',limit:10});
  assert.equal(parseAssetArgs(['reconstruct','apply','Game','--operation','11111111-1111-4111-8111-111111111111']).method,'reconstruct.apply');
  assert.equal(parseAssetArgs(['reconstruct','validate','Game','--timeout-seconds','90']).params.timeoutSeconds,90);
  assert.equal(parseAssetArgs(['assets','index','Game','--max-graph-mib','512']).params.graphMaxMiB,512);assert.throws(()=>parseAssetArgs(['assets','index','Game','--max-graph-mib','257']));assert.throws(()=>parseAssetArgs(['assets','list','Game','--max-graph-mib','512']));
  assert.equal(parseAssetArgs(['reconstruct','validation','Game','--operation','11111111-1111-4111-8111-111111111111']).method,'reconstruct.validation');
  assert.deepEqual(parseAssetArgs(['assets','raw','Game','--format','json','--bundle','[]','--collection','0','--path-id','-9007199254740993']).params.bundle,[]);
  for(const args of [['assets','export','Game','--out','C:/other'],['assets','list','Game','--limit','1e3'],['assets','list','Game','--limit','0'],['assets','get','Game'],['assets','list','Game','extra'],['assets','session','start','Game','--url','http://x'],['reconstruct','plan','Game']])assert.throws(()=>parseAssetArgs(args));
});
test('re.js routes assets and reconstruct before the legacy parser',()=>{
  for(const group of ['assets','reconstruct']){const result=spawnSync(process.execPath,[entry,group,'--help'],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/assets session|reconstruct plan/);}
});
