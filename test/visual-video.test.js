import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fixture} from './visual-fixture.js';
test('video extracts each explicit timestamp with fixed bounded arguments and compares all frames',async t=>{
 const f=await fixture(t),{createVisualReport,readVisualReport}=await import('../src/visual/service.js');
 const executable=path.join(f.root,'owned-ffmpeg.exe');fs.writeFileSync(executable,'owned fixture executable identity');
 const request={...f.request,mode:'video',ffmpegPath:executable,frames:[{...f.request.frames[0],baselineTimeMs:0,candidateTimeMs:25},{...f.request.frames[0],id:'end',baselineTimeMs:1000,candidateTimeMs:1025}]};
 const calls=[];const run=async(exe,args,options)=>{calls.push({exe,args,options});assert.equal(options.shell,false);assert.equal(options.timeoutMs,30000);assert.ok(args.includes('-nostdin'));assert.ok(args.includes('-noautorotate'));assert.ok(args.includes('-max_pixels'));assert.ok(!args.includes('-vf'));assert.ok(!args.includes('scale'));fs.copyFileSync(f.baseline,args.at(-1));};
 const result=await createVisualReport(f.toolkit,'Game',request,{runFrame:run});assert.equal(result.state,'pass');assert.equal(result.temporalBehavior,'unverified');assert.equal(result.coverage.observed,2);assert.equal(calls.length,4);assert.deepEqual(calls.map(c=>c.args[c.args.indexOf('-ss')+1]),['0.000','0.025','1.000','1.025']);
 const report=await readVisualReport(f.toolkit,'Game',{operationId:result.operationId,section:'report'});assert.equal(report.frames[1].candidateTimeMs,1025);assert.equal(report.frames[1].frameArtifacts.candidate.sha256.length,64);
 fs.appendFileSync(executable,'change');assert.equal((await readVisualReport(f.toolkit,'Game',{operationId:result.operationId})).stale,true);
});
test('video missing extraction and timeout are unverified, never empty-frame pass',async t=>{
 const f=await fixture(t),{createVisualReport}=await import('../src/visual/service.js'),{visualError}=await import('../src/visual/contract.js');const executable=path.join(f.root,'owned-ffmpeg.exe');fs.writeFileSync(executable,'fixture');
 const request={...f.request,mode:'video',ffmpegPath:executable,frames:[{...f.request.frames[0],baselineTimeMs:0,candidateTimeMs:0}]};
 assert.equal((await createVisualReport(f.toolkit,'Game',request,{runFrame:async()=>{}})).state,'unverified');
 assert.equal((await createVisualReport(f.toolkit,'Game',request,{runFrame:async()=>{throw visualError('visual_frame_timeout','Owned process timed out');}})).visualFidelity,'unverified');
 for(const mutate of [r=>r.ffmpegPath='ffmpeg',r=>delete r.frames[0].candidateTimeMs,r=>r.frames[0].candidateTimeMs=-1,r=>r.frames[0].candidateTimeMs=3600001,r=>r.frames[0].candidateTimeMs='1; rm',r=>r.extraArgs=['-vf','scale=1:1']]){const wrong=structuredClone(request);mutate(wrong);await assert.rejects(createVisualReport(f.toolkit,'Game',wrong),/visual|frame|ffmpeg/i);}
});

test('video reads verified private source copies and rejects source snapshot edits',async t=>{
 const f=await fixture(t),{createVisualReport}=await import('../src/visual/service.js');const executable=path.join(f.root,'owned-ffmpeg.exe');fs.writeFileSync(executable,'fixture');
 const request={...f.request,mode:'video',ffmpegPath:executable,frames:[{...f.request.frames[0],baselineTimeMs:0,candidateTimeMs:0}]};
 await assert.rejects(createVisualReport(f.toolkit,'Game',request,{runFrame:async(exe,args)=>{const source=args[args.indexOf('-i')+1];assert.notEqual(source,f.baseline);assert.notEqual(source,f.candidate);assert.ok(source.includes('private-inputs'));fs.copyFileSync(source,args.at(-1));const project=f.toolkit.read('Game');project.platform='changed';await f.toolkit.save('Game',project);}}),/snapshot|changed|stale/i);
});
test('owned direct process awaits close and bounds errors without exposing stderr',async()=>{
 const {runOwnedFfmpeg}=await import('../src/visual/video.js');assert.deepEqual(await runOwnedFfmpeg(process.execPath,['-e','process.exit(0)'],{}),{exitCode:0});
 await assert.rejects(runOwnedFfmpeg(process.execPath,['-e','process.stderr.write("secret fixture");process.exit(2)'],{}),e=>e.code==='visual_frame_failed'&&!e.message.includes('secret'));
 await assert.rejects(runOwnedFfmpeg(process.execPath,['-e','process.stderr.write("x".repeat(70000));setTimeout(()=>{},30000)'],{}),e=>e.code==='visual_frame_output_limit');
});
test('video extraction restricts container demuxing and does not inherit report-output environment',async t=>{
 const f=await fixture(t),{extractFrame}=await import('../src/visual/video.js');const executable=path.join(f.root,'owned-ffmpeg.exe');fs.writeFileSync(executable,'fixture');const previous=process.env.FFREPORT;process.env.FFREPORT='file=outside.log';t.after(()=>{if(previous===undefined)delete process.env.FFREPORT;else process.env.FFREPORT=previous;});
 await extractFrame({executable,input:f.baseline,timeMs:0,output:path.join(f.root,'frame.png'),profile:f.request.profile,run:async(exe,args,options)=>{assert.equal(args[args.indexOf('-format_whitelist')+1],'mov,matroska,webm,avi,mpegts');assert.equal(options.env.FFREPORT,undefined);}});
});
