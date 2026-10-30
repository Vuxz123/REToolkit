import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {fingerprint,fileIdentity} from '../state.js';
import {assetPaths,assertAssetPath,assetError} from '../assets/context.js';

export const atomicReferencePolicy='persistent-object-reference-v1';
const policyFile=fileURLToPath(import.meta.url);
const normalizerFile=fileURLToPath(new URL('./contracts.js',import.meta.url));
// Resident entry points reuse the unchanged scriptable-data-v2 observer.
const helperPolicies=new Map([
 ['c4c719a1a6a2174ac74bdb540a8e4af7c2e54631eff9c0b8b9d3b8396a23837d','scriptable-data-v2'],
 ['1c7f47100785c317a3c63a10049fc322631fb5c315efb8b4e179f0dc2a4c201e','scriptable-data-v1'],
 ['2c60cb50e12ec42d48dece6e67386e49f3afef083e3729073a5efac8fce93d92','scriptable-data-v1'],
 ['99907d89481e3463cf00c6a3f5650c4076531e190fe0b6926a0afa0f79a25cc9','scriptable-data-v2'],
]);
const check=(ok,message)=>{if(!ok)throw assetError('data_reference_policy_invalid',message);};
export const normalizedHelperHash=file=>createHash('sha256').update(fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n')).digest('hex');
export function compatibleDataHelpers(currentFile,originalFile){const current=normalizedHelperHash(currentFile),original=normalizedHelperHash(originalFile);return helperPolicies.has(current)&&helperPolicies.has(original);}
export function referenceComparisonPolicy(toolkit,name,baseline,captured){
 const paths=assetPaths(toolkit,name),identify=(operationId,sha256,rows)=>{
  const file=assertAssetPath(path.join(paths.base,'unity-validation',operationId,'project/Assets/REToolkitValidation/Editor/REToolkitValidation.cs'),paths.workspace);
  check(fileIdentity(file).sha256===sha256,'Retained data helper bytes changed');const normalizedSha256=normalizedHelperHash(file),snapshotPolicy=helperPolicies.get(normalizedSha256);
  check(snapshotPolicy&&rows.every(r=>r.data.policy===snapshotPolicy),'Unknown helper or incompatible data encoding');return {helperSha256:sha256,normalizedSha256,snapshotPolicy};
 };
 const evaluator=assertAssetPath(path.join(toolkit.root,'templates/Unity/REToolkitValidation.cs'));check(helperPolicies.has(normalizedHelperHash(evaluator)),'Unknown current helper policy');
 return {name:atomicReferencePolicy,policySha256:fileIdentity(policyFile).sha256,normalizerSha256:fileIdentity(normalizerFile).sha256,evaluationHelperSha256:fileIdentity(evaluator).sha256,baseline:identify(baseline.receipt.validationOperationId,baseline.receipt.helperSha256,baseline.rows),current:identify(captured.receipt.operationId,captured.receipt.helperSha256,captured.rows)};
}
export function assertReferenceComparisonPolicy(given,toolkit,name,baseline,captured){check(fingerprint(given)===fingerprint(referenceComparisonPolicy(toolkit,name,baseline,captured)),'Reference comparison policy or helper provenance changed');}
