// A bounded public observation; target logs and arbitrary fields are never forwarded.
export function validationProgressPreview(event){
 if(!event||! /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(event.operationId)||!['requestedAssets','completedAssets','pendingAssets'].every(key=>Number.isSafeInteger(event[key])&&event[key]>=0&&event[key]<=10000)||event.completedAssets+event.pendingAssets!==event.requestedAssets)return null;
 const result={operationId:event.operationId,requestedAssets:event.requestedAssets,completedAssets:event.completedAssets,pendingAssets:event.pendingAssets};
 if(typeof event.currentAsset==='string'&&event.currentAsset.length<=2048&&event.currentAsset.startsWith('Assets/')&&!/[\\\x00-\x1f]/.test(event.currentAsset)&&event.currentAsset.split('/').every(part=>part&&part!=='.'&&part!=='..'))result.currentAsset=event.currentAsset;
 return result;
}
