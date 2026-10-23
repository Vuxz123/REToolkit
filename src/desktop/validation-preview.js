const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
const clip=(value,limit=512)=>typeof value==='string'?value.slice(0,limit):undefined;
export function validationResultPreview(job){
 const value=job.result;if(!['reconstruct.validate','reconstruct.validation'].includes(job.operation)||value?.kind!=='retoolkit-unity-validation')return null;
 const result={kind:value.kind,schemaVersion:1};
 for(const key of ['operationId','state','behavior','storedReceipt','nextAction','resumedFrom'])if(typeof value[key]==='string')result[key]=clip(value[key],key==='storedReceipt'?512:64);
 for(const key of ['compileReady','bindingsVerified','scopeBindingsVerified'])if(typeof value[key]==='boolean')result[key]=value[key];
 if(record(value.compilation))result.compilation={state:clip(value.compilation.state,32)};
 if(record(value.scope))result.scope={kind:clip(value.scope.kind,32),assetCount:Array.isArray(value.scope.assetIds)?value.scope.assetIds.length:0};
 if(record(value.coverage)){result.coverage={};for(const key of ['state','source'])if(typeof value.coverage[key]==='string')result.coverage[key]=clip(value.coverage[key],64);for(const key of ['requestedAssets','completedAssets','pendingAssets','reusedAssets'])if(Number.isSafeInteger(value.coverage[key])&&value.coverage[key]>=0)result.coverage[key]=value.coverage[key];}
 if(record(value.resume))result.resume={operationId:clip(value.resume.operationId,64),...(Number.isSafeInteger(value.resume.pendingAssets)&&value.resume.pendingAssets>=0?{pendingAssets:value.resume.pendingAssets}:{})};
 const diagnostics=Array.isArray(value.diagnostics)?value.diagnostics:[];result.diagnosticCount=Number.isSafeInteger(value.diagnosticCount)?value.diagnosticCount:diagnostics.length;
 result.diagnostics=diagnostics.slice(0,5).filter(record).map(row=>({severity:clip(row.severity,16),message:clip(row.message),path:clip(row.path)}));
 while(Buffer.byteLength(JSON.stringify(result))>8000&&result.diagnostics.length)result.diagnostics.pop();
 result.omittedDiagnostics=Math.max(0,result.diagnosticCount-result.diagnostics.length);
 return result;
}
