import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {assertAssetPath} from '../assets/context.js';

/** Compiler syntax only: the Editor observation separately proves assembly
 * membership. Generated staging GUIDs never establish original asset identity. */
export async function classifyMetaFreeSources({assets,targets,files,projectDir,editorPath,observations=[]}){
 const verified=new Set();
 if(!targets.length)return {verified};
 try{
  const inventory=new Map(files.map(file=>[file.path,file]));let total=0;
  const documents=assets.map(asset=>{
   const file=assertAssetPath(path.join(projectDir,asset.path),projectDir),expected=inventory.get(asset.path),stat=fs.lstatSync(file);
   if(!stat.isFile()||stat.size>1024**2||(total+=stat.size)>64*1024**2)throw Object.assign(Error('Unsupported source inventory'),{code:'source_contract_invalid'});
   const source=fs.readFileSync(file);
   if(source.length!==expected?.size||createHash('sha256').update(source).digest('hex')!==expected.sha256)throw Object.assign(Error('Source snapshot changed'),{code:'stale_graph'});
   return {path:asset.path,source};
  });
  const {analyzeSourceContracts}=await import('../reconstruction/source-contract.js');
  const analysis=await analyzeSourceContracts({projectDir,editorPath,documents}),byPath=new Map(analysis.documents.map(doc=>[doc.path,doc]));
  const rows=new Map(observations.map(row=>[row.assetId,row]));
  let reason;
  for(const asset of targets){
   const document=byPath.get(asset.path);
   if(!document?.supported||!document.identitiesComplete){reason??=document?.reason??'Incomplete compiler declaration inventory';continue;}
   const types=document.types,byName=new Map(types.map(type=>[type.fullName,type]));
   const row=rows.get(asset.id),reflected=row?.classification==='non-attachable'&&row.resolved===true&&types.some(type=>type.fullName===row.fullName);
   if(observations.length&&(!row||row.path!==asset.path||row.assembly!==asset.script?.assembly||!(reflected||row.classification==='compiled-source'&&!row.resolved&&row.fullName===null))){reason??='Observed compiler assembly/type identity does not match source';continue;}
   // A nested type inside an open generic also contains generic parameters.
   // Other inherited classes require their own exact reflected identity.
   // An outer type's classification never certifies its nested descendants.
   const open=type=>type.arity>0||Boolean(type.declaringType&&byName.has(type.declaringType)&&open(byName.get(type.declaringType)));
   const nonAttachableTypes=new Set(Array.isArray(row?.nonAttachableTypes)?row.nonAttachableTypes:[]);
   if(!types.every(type=>type.kind!=='class'||type.baseTypes.length===0||open(type)||reflected&&(type.fullName===row.fullName||nonAttachableTypes.has(type.fullName)))){reason??='Inherited concrete source class requires exact reflected non-attachable identity';continue;}
   const names=new Set(types.map(type=>type.name)),fullNames=new Set(types.map(type=>type.fullName));
   const ambiguous=assets.some(other=>{
    if(other.path===asset.path||other.script?.assembly&&other.script.assembly!==asset.script.assembly)return false;
    const observed=byPath.get(other.path);
    return !observed||observed.types.some(type=>fullNames.has(type.fullName))||observed.identitiesComplete===false&&(observed.identityUncertain||!Array.isArray(observed.identityNames)||observed.identityNames.some(name=>names.has(name)));
   });
   if(ambiguous){reason??='Ambiguous compiler assembly/type identity';continue;}
   verified.add(asset.id);
  }
  return {verified,reason};
 }catch(error){return {verified:new Set(),reason:`Compiler source classification unavailable (${String(error.code??'source_contract_invalid').slice(0,100)})`};}
}
