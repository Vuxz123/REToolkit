import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {createDesktopBroker} from '../src/desktop/jobs.js';

test('desktop keeps bounded live coverage and meaningful oversized validation summary',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-validation-desktop-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let child;
 const broker=createDesktopBroker(root,{spawnImpl:()=>{child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();return child;}});
 const operationId='11111111-1111-4111-8111-111111111111',progress={kind:'unity-validation-progress',operationId,requestedAssets:408,completedAssets:4,pendingAssets:404,currentAsset:'Assets/One.prefab'};
 broker.submit('reconstruct.validate',{name:'Game'});const wire=JSON.stringify(progress)+'\n';child.stderr.emit('data',Buffer.from(wire.slice(0,23)));child.stderr.emit('data',Buffer.from(wire.slice(23)));
 assert.equal(broker.snapshot().jobs[0].validationProgress?.completedAssets,4);
 child.stderr.emit('data',Buffer.from(JSON.stringify({...progress,completedAssets:999999,pendingAssets:-1})+'\n'));
 assert.equal(broker.snapshot().jobs[0].validationProgress.completedAssets,4);
 child.stderr.emit('data',Buffer.from('x'.repeat(512*1024)+'\n'));
 child.stderr.emit('data',Buffer.from(JSON.stringify({...progress,completedAssets:10,pendingAssets:398})+'\n'));
 assert.equal(broker.snapshot().jobs[0].validationProgress.completedAssets,10,'live coverage continues after stored diagnostic cap');
 const result={kind:'retoolkit-unity-validation',schemaVersion:1,operationId,state:'partial',compilation:{state:'succeeded'},compileReady:true,bindingsVerified:false,scopeBindingsVerified:false,scope:{kind:'project',assetIds:Array.from({length:408},(_,i)=>'asset:'+String(i).padStart(32,'0'))},coverage:{state:'partial',requestedAssets:408,completedAssets:4,pendingAssets:404},resume:{operationId,pendingAssets:404},diagnostics:Array.from({length:200},()=>({severity:'warning',message:'bounded diagnostic'.repeat(20),path:'Assets/One.prefab'}))};
 child.stdout.emit('data',Buffer.from(JSON.stringify(result)));child.emit('close',0);
 const final=broker.snapshot().jobs[0];assert.equal(final.result.kind,'retoolkit-unity-validation');assert.equal(final.result.compilation.state,'succeeded');assert.equal(final.result.coverage.pendingAssets,404);assert.equal(final.result.resume.operationId,operationId);assert.equal(final.result.scope.kind,'project');assert(final.result.diagnostics.length<=5);assert(final.storedResult);assert(Buffer.byteLength(JSON.stringify(final))<=16384);
 assert.equal(JSON.parse(fs.readFileSync(final.storedResult)).result.diagnostics.length,200);
});
