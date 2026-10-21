import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {PNG} from 'pngjs';
import {fixture} from './visual-fixture.js';
const api=()=>import('../src/visual/service.js');
test('PNG comparison records exact hashes, deterministic RGBA diff and independent outcome',async t=>{
 const f=await fixture(t),{createVisualReport,readVisualReport}=await api();
 const first=await createVisualReport(f.toolkit,'Game',f.request);assert.equal(first.visualFidelity,'pass');assert.equal(first.interaction,'unverified');assert.equal(first.temporalBehavior,'unverified');
 const report=await readVisualReport(f.toolkit,'Game',{operationId:first.operationId,section:'report'});
 assert.equal(report.frames[0].baseline.sha256.length,64);assert.equal(report.coverage.observed,1);assert.equal(report.frames[0].regions[0].metrics.changedPixels,0);
 const diff=fs.readFileSync(path.join(f.toolkit.workspace('Game'),report.frames[0].diff.path));assert.equal(PNG.sync.read(diff).width,2);
 const second=await createVisualReport(f.toolkit,'Game',f.request),again=await readVisualReport(f.toolkit,'Game',{operationId:second.operationId,section:'report'});assert.equal(again.frames[0].diff.sha256,report.frames[0].diff.sha256);
 f.image('candidate.png',true);const mismatch=await createVisualReport(f.toolkit,'Game',f.request);assert.equal(mismatch.visualFidelity,'fail');
 const bad=await readVisualReport(f.toolkit,'Game',{operationId:mismatch.operationId,section:'report'});assert.equal(bad.frames[0].regions[0].metrics.changedRatio,1);assert.equal(bad.frames[0].regions[0].metrics.meanAbsoluteError,63.75);
});
test('all required frames and regions count; missing baseline and profile mismatch never pass',async t=>{
 const f=await fixture(t),{createVisualReport}=await api();f.request.frames.push({...structuredClone(f.request.frames[0]),id:'missing',baseline:null});
 const missing=await createVisualReport(f.toolkit,'Game',f.request);assert.equal(missing.visualFidelity,'unverified');assert.deepEqual(missing.coverage,{requested:2,observed:1,unknown:1,excluded:0});
 f.request.frames.pop();f.request.frames[0].baseline.profile.locale='vi';const profile=await createVisualReport(f.toolkit,'Game',f.request);assert.equal(profile.visualFidelity,'unverified');
 f.request.frames[0].baseline.profile={...f.request.profile};f.request.frames[0].baseline.provenance.kind='fixture';const fixtureResult=await createVisualReport(f.toolkit,'Game',f.request);assert.equal(fixtureResult.visualFidelity,'unverified');assert.equal(fixtureResult.regression,'pass');
});
test('strict contracts reject arbitrary outputs, masks, filters, empty scope and duplicate identifiers',async t=>{
 const f=await fixture(t),{createVisualReport}=await api();
 for(const mutate of [r=>r.output='outside',r=>r.mask=[],r=>r.filters='scale=1:1',r=>r.frames=[],r=>r.requiredRegions=[],r=>r.requiredRegions[0].width=3,r=>r.requiredRegions[0].pixelDelta=-1,r=>r.frames.push(structuredClone(r.frames[0])),r=>r.profile.extra=true]){const r=structuredClone(f.request);mutate(r);await assert.rejects(createVisualReport(f.toolkit,'Game',r),/visual|profile|region|frame|request/i);}
});
test('stale hashes, changed saved inputs, bad geometry, and tampered diff cannot claim pass',async t=>{
 const f=await fixture(t),{createVisualReport,readVisualReport}=await api();const wrong=structuredClone(f.request);wrong.frames[0].candidate.sha256='0'.repeat(64);await assert.rejects(createVisualReport(f.toolkit,'Game',wrong),/stale|hash|sha256/i);
 const run=await createVisualReport(f.toolkit,'Game',f.request);f.image('candidate.png',true);const stale=await readVisualReport(f.toolkit,'Game',{operationId:run.operationId});assert.equal(stale.stale,true);assert.equal(stale.visualFidelity,'unverified');
 const large=new PNG({width:3,height:2});large.data.fill(255);fs.writeFileSync(f.candidate,PNG.sync.write(large));assert.equal((await createVisualReport(f.toolkit,'Game',f.request)).visualFidelity,'unverified');
});


test('a failed required original region remains failed when another baseline is missing',async t=>{
 const f=await fixture(t),{createVisualReport}=await api();f.image('candidate.png',true);f.request.frames.push({...structuredClone(f.request.frames[0]),id:'missing',baseline:null});assert.equal((await createVisualReport(f.toolkit,'Game',f.request)).visualFidelity,'fail');
});
test('diff includes alpha-only changes; stored artifacts and report payload are guarded',async t=>{
 const f=await fixture(t),{createVisualReport,readVisualReport}=await api();const png=PNG.sync.read(fs.readFileSync(f.candidate));png.data[3]=0;fs.writeFileSync(f.candidate,PNG.sync.write(png));
 const result=await createVisualReport(f.toolkit,'Game',f.request);assert.equal(result.visualFidelity,'fail');const report=await readVisualReport(f.toolkit,'Game',{operationId:result.operationId,section:'report'}),diffPath=path.join(f.toolkit.workspace('Game'),report.frames[0].diff.path);const diff=PNG.sync.read(fs.readFileSync(diffPath));assert.equal(diff.data[0],255);
 fs.appendFileSync(diffPath,'tampered');assert.equal((await readVisualReport(f.toolkit,'Game',{operationId:result.operationId})).stale,true);
 const reportPath=path.join(f.toolkit.workspace('Game'),result.reportPath),tampered=JSON.parse(fs.readFileSync(reportPath));tampered.visualFidelity='pass';fs.writeFileSync(reportPath,JSON.stringify(tampered));await assert.rejects(readVisualReport(f.toolkit,'Game',{operationId:result.operationId}),/integrity/i);
});
test('file requests, paged findings and revision-bound cursors remain compact',async t=>{
 const f=await fixture(t),{runVisualComparison,readVisualReport}=await api();f.request.requiredRegions.push({...f.request.requiredRegions[0],id:'second'});const requestFile=path.join(f.root,'request.json');fs.writeFileSync(requestFile,JSON.stringify(f.request));
 const result=await runVisualComparison(f.toolkit,'Game',{requestFile});const page=await readVisualReport(f.toolkit,'Game',{operationId:result.operationId,section:'findings',limit:1});assert.equal(page.items.length,1);assert.ok(page.nextCursor);
 assert.equal((await readVisualReport(f.toolkit,'Game',{operationId:result.operationId,section:'findings',limit:1,cursor:page.nextCursor})).items[0].id,'second');
 await assert.rejects(readVisualReport(f.toolkit,'Game',{operationId:result.operationId,section:'frames',cursor:page.nextCursor}),/cursor/i);await assert.rejects(runVisualComparison(f.toolkit,'Game',{requestFile,request:f.request}),/exactly one/i);
 fs.appendFileSync(requestFile,' ');assert.equal((await readVisualReport(f.toolkit,'Game',{operationId:result.operationId})).stale,true);
});
test('unsupported high-depth or interlaced PNG is unverified before decoding',async t=>{
 const f=await fixture(t),{createVisualReport}=await api();for(const [offset,value] of [[24,16],[28,1]]){const bytes=fs.readFileSync(f.baseline);bytes[offset]=value;const {decodePng}=await import('../src/visual/png.js');assert.throws(()=>decodePng(bytes),/8-bit noninterlaced/);fs.writeFileSync(f.candidate,bytes);assert.equal((await createVisualReport(f.toolkit,'Game',f.request)).state,'unverified');}
});

test('missing file baselines with a pinned hash remain unverified with coverage',async t=>{
 const f=await fixture(t),{createVisualReport}=await api();f.request.frames[0].baseline.path=path.join(f.root,'absent.png');f.request.frames[0].baseline.sha256='a'.repeat(64);const result=await createVisualReport(f.toolkit,'Game',f.request);assert.equal(result.visualFidelity,'unverified');assert.equal(result.coverage.unknown,1);
});
test('every required region is evaluated independently and thresholds are inclusive',async t=>{
 const f=await fixture(t),{createVisualReport,readVisualReport}=await api();f.image('candidate.png',true);f.request.requiredRegions=[{...f.request.requiredRegions[0],id:'unchanged',x:1},{...f.request.requiredRegions[0],id:'changed'}];
 const failed=await createVisualReport(f.toolkit,'Game',f.request),report=await readVisualReport(f.toolkit,'Game',{operationId:failed.operationId,section:'report'});assert.deepEqual(report.frames[0].regions.map(r=>r.outcome),['pass','fail']);assert.equal(failed.visualFidelity,'fail');
 f.request.requiredRegions[1].maxChangedRatio=1;f.request.requiredRegions[1].maxMeanAbsoluteError=63.75;assert.equal((await createVisualReport(f.toolkit,'Game',f.request)).visualFidelity,'pass');
});
test('request resource work and report query types are bounded',async t=>{
 const f=await fixture(t),{createVisualReport,readVisualReport}=await api();const huge=structuredClone(f.request);huge.profile.width=4096;huge.profile.height=4096;huge.frames=Array.from({length:32},(_,i)=>({...structuredClone(f.request.frames[0]),id:String(i)}));await assert.rejects(createVisualReport(f.toolkit,'Game',huge),/work limit/i);
 const result=await createVisualReport(f.toolkit,'Game',f.request);for(const p of [{limit:0},{cursor:2},{cursor:'x'.repeat(4096)}])await assert.rejects(readVisualReport(f.toolkit,'Game',{operationId:result.operationId,...p}),/limit|cursor/i);
});
