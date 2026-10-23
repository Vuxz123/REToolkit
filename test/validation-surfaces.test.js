import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAssetArgs} from '../src/assets/cli.js';
import {validateAssetParams} from '../src/assets/api.js';
import {buildDesktopCommand} from '../src/desktop/operations.js';
import {buildResultModel} from '../src/desktop/result-model.js';

const resume='11111111-1111-4111-8111-111111111111',assetIds=['asset:abc','asset:def'];
test('CLI, direct API and jobs share exact resumable validation scope',()=>{
 const params={resumeOperationId:resume,assetIds};
 assert.deepEqual(parseAssetArgs(['reconstruct','validate','Game','--resume-operation',resume,'--asset-ids',JSON.stringify(assetIds)]).params,params);
 assert.doesNotThrow(()=>validateAssetParams('reconstruct.validate',params));
 assert.doesNotThrow(()=>validateAssetParams('jobs.start',{operation:'reconstruct.validate',params}));
 for(const invalid of [{resumeOperationId:'wrong'},{assetIds:[]},{assetIds:['same','same']},{assetIds:[1]},{assetIds:['']},{assetIds:Array(1001).fill('a')},{command:'calc'}])assert.throws(()=>validateAssetParams('reconstruct.validate',invalid));
 assert.throws(()=>parseAssetArgs(['reconstruct','validate','Game','--asset-ids','not-json']));
});

test('desktop routes scoped resume through typed Node flags',()=>{
 assert.deepEqual(buildDesktopCommand('reconstruct.validate',{name:'Game',resumeOperationId:resume,assetIds:JSON.stringify(assetIds)}),['reconstruct','validate','Game','--resume-operation',resume,'--asset-ids',JSON.stringify(assetIds)]);
 for(const payload of [{resumeOperationId:'bad'},{assetIds:'[]'},{assetIds:'[1]'},{assetIds:'["a","a"]'},{shell:'calc'}])assert.throws(()=>buildDesktopCommand('reconstruct.validate',{name:'Game',...payload}));
});

test('partial Unity validation presents successful compilation and explicit remaining coverage',()=>{
 const result={kind:'retoolkit-unity-validation',state:'partial',compilation:{state:'succeeded'},compileReady:true,bindingsVerified:false,behavior:'unverified',scope:{kind:'project'},coverage:{state:'partial',requestedAssets:408,completedAssets:4,pendingAssets:404},resume:{operationId:resume}};
 const model=buildResultModel({operation:'reconstruct.validate',state:'succeeded',result});
 assert.equal(model.status.tone,'warn');assert.match(model.status.label,/kiểm chứng/i);assert.doesNotMatch(model.status.description,/capture|thu thập/i);
 assert.equal(model.metrics.find(row=>row.label==='Biên dịch').tone,'good');
 const coverage=model.metrics.find(row=>row.label==='Độ phủ binding');assert(coverage);assert.equal(coverage.value,'4/408');assert.equal(coverage.tone,'warn');
 assert(model.sections.some(section=>section.title==='Tiếp tục kiểm chứng'));
});

test('feature scope cannot present project-wide binding success',()=>{
 const model=buildResultModel({operation:'reconstruct.validate',state:'succeeded',result:{kind:'retoolkit-unity-validation',state:'validated',compilation:{state:'succeeded'},compileReady:true,bindingsVerified:false,scopeBindingsVerified:true,scope:{kind:'assets'},coverage:{state:'observed',requestedAssets:2,completedAssets:2,pendingAssets:0}}});
 assert.equal(model.status.tone,'warn');assert.match(model.status.description,/phạm vi/i);
 assert.notEqual(model.metrics.find(row=>row.label==='Liên kết').tone,'good');
});

test('running validation shows observed asset coverage and current asset before final result',()=>{
 const model=buildResultModel({operation:'reconstruct.validate',state:'running',validationProgress:{operationId:resume,requestedAssets:408,completedAssets:4,pendingAssets:404,currentAsset:'Assets/Five.prefab'}});
 assert.equal(model.status.tone,'info');assert.equal(model.metrics.find(row=>row.label==='Độ phủ binding')?.value,'4/408');assert(model.sections.some(section=>section.title==='Tiến độ Unity'));
});
