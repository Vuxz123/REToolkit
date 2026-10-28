import test from 'node:test';
import assert from 'node:assert/strict';
import {createPhaseMetrics,phaseMetricsPreview} from '../src/workflow/metrics.js';
test('phase metrics accumulate controlled counts, duration and bytes even on failure',async()=>{
 let clock=0;const m=createPhaseMetrics(()=>clock);
 await m.measure('input.verify',async()=>{clock+=5;});m.count('snapshot.copy',100,2);
 await assert.rejects(m.measure('domain.operation',async()=>{clock+=7;throw Error('fixture');}));
 assert.equal(m.snapshot().find(p=>p.phase==='input.verify').elapsedMs,5);assert.equal(m.snapshot().find(p=>p.phase==='snapshot.copy').bytes,100);assert.equal(m.snapshot().find(p=>p.phase==='domain.operation').elapsedMs,7);
 const preview=phaseMetricsPreview([{phase:'input.verify',calls:1,elapsedMs:1,secret:'omit'},{phase:'C:/private',elapsedMs:99}]);assert.equal(preview.length,1);assert(!JSON.stringify(preview).includes('secret'));
});
