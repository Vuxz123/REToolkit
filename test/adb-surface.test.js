import test from 'node:test';import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';import {serveAssetsMcp} from '../src/assets/mcp.js';
import {createAdbClient} from '../src/adb/client.js';import {parseAdbArgs} from '../src/adb/options.js';import {buildDesktopCommand,desktopOperations} from '../src/desktop/operations.js';import {validateAssetParams,invokeAssetApi} from '../src/assets/api.js';

test('ADB surfaces expose package discovery and opt-in userdata without interactive launch',async()=>{
 const calls=[],client=createAdbClient({file:'fixture.exe',run:async(_file,args)=>{calls.push(args);return {exitCode:0,stdout:'package:com.example.game\npackage:com.example.other\n',stderr:''};}});
 assert.deepEqual(await client.packages('emulator-5554'),[{packageName:'com.example.game'},{packageName:'com.example.other'}]);assert.deepEqual(calls[0],['-s','emulator-5554','shell','pm','list','packages','-3']);
 assert.equal(parseAdbArgs(['adb','packages','--serial','emulator-5554']).command,'packages');
 assert.equal(parseAdbArgs(['pull-ldplayer','Game','com.example.game','--include-data','--skip-launch']).options.includeData,true);
 assert.deepEqual(buildDesktopCommand('adb.capture',{name:'Game',packageName:'com.example.game',serial:'emulator-5554'}),['pull-ldplayer','Game','com.example.game','--serial','emulator-5554','--skip-launch','--include-data']);
 assert.ok(desktopOperations.some(item=>item.id==='adb.devices'));assert.ok(desktopOperations.some(item=>item.id==='adb.packages'));
});
test('agent capture uses fixed workspace and always opts into data without executable or launch overrides',async()=>{
 const calls=[],toolkit={pullLdPlayer:async(...args)=>{calls.push(args);return {state:'partial'};}};
 validateAssetParams('adb.capture',{serial:'emulator-5554',packageName:'com.example.game'});
 const result=await invokeAssetApi(toolkit,'Game','adb.capture',{serial:'emulator-5554',packageName:'com.example.game'});assert.equal(result.state,'partial');assert.deepEqual(calls,[['Game','com.example.game',{serial:'emulator-5554',skipLaunch:true,includeData:true}]]);
 for(const params of [{serial:'bad;id',packageName:'com.example.game'},{serial:'emulator-5554',packageName:'com.x;id'},{serial:'emulator-5554',packageName:'com.example.game',adb:'C:/other.exe'},{serial:'emulator-5554',packageName:'com.example.game',skipLaunch:false}])assert.throws(()=>validateAssetParams('adb.capture',params));
 assert.throws(()=>buildDesktopCommand('adb.capture',{name:'Game',packageName:'com.x;bad',serial:'emulator-5554'}));
});
test('MCP wire dispatch keeps full capture workspace bound and rejects flag injection before device use',async()=>{
 const input=new PassThrough(),output=new PassThrough(),calls=[];let text='';output.on('data',chunk=>text+=chunk);const run=serveAssetsMcp({pullLdPlayer:async(...args)=>{calls.push(args);return {kind:'retoolkit-adb-result',schemaVersion:1,state:'partial',capture:{files:[],applicationData:{coverage:'partial'}}};}},'OwnedFixture',{input,output});
 for(const message of [{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'fixture',version:'1'}}},{jsonrpc:'2.0',method:'notifications/initialized'},{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'adb_capture',arguments:{serial:'emulator-5554',packageName:'com.example.game'}}},{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'adb_capture',arguments:{serial:'emulator-5554',packageName:'com.example.game',adb:'C:/foreign.exe'}}}])input.write(JSON.stringify(message)+'\n');input.end();await run;
 const responses=text.trim().split('\n').map(JSON.parse),result=JSON.parse(responses.find(item=>item.id===2).result.content[0].text);assert.equal(result.schemaVersion,1);assert.equal(result.state,'partial');assert.equal(calls.length,1);assert.equal(calls[0][0],'OwnedFixture');assert.equal(responses.find(item=>item.id===3).error.code,-32602);
});
