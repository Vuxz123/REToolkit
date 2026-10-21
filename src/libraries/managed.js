import fs from 'node:fs';
import path from 'node:path';
import {safeRelative,exactKeys} from '../toolchain/manifest.js';
import {assertAssetPath,assetError} from '../assets/context.js';

const digest=/^[a-f0-9]{64}$/,version=/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/;
const check=(ok,message)=>{if(!ok)throw assetError('unity_package_unsupported',message);};
// This lock attests local staging bytes, not publisher authenticity. The source
// graph is verified by the caller before this function inspects package facts.
export function managedLibraries(projectDir,files){
 const file=files.find(f=>f.path.toLowerCase()==='packages/retk-libraries.lock.json');
 if(!file)return new Map();
 const absolute=assertAssetPath(path.join(projectDir,file.path),projectDir);
 check(file.size<=128*1024**2,'Managed library lock exceeds metadata budget');
 const lock=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(fs.readFileSync(absolute)));
 check(exactKeys(lock,['kind','schemaVersion','operationId','catalogRevision','packages'])&&lock.kind==='retoolkit-managed-libraries'&&lock.schemaVersion===1&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(lock.operationId)&&digest.test(lock.catalogRevision)&&Array.isArray(lock.packages)&&lock.packages.length<=256,'Invalid managed library lock');
 const result=new Map();
 for(const pkg of lock.packages){
  check(exactKeys(pkg,['id','version','libraryId','catalogPackageId','archiveSha256','root','files'])&&typeof pkg.id==='string'&&/^[a-z0-9]+(?:[._-][a-z0-9]+)+$/.test(pkg.id)&&pkg.id.length<=214&&version.test(pkg.version)&&typeof pkg.libraryId==='string'&&pkg.libraryId.length<=256&&digest.test(pkg.catalogPackageId)&&digest.test(pkg.archiveSha256)&&pkg.root===`Packages/${pkg.id}`&&!result.has(pkg.id)&&Array.isArray(pkg.files)&&pkg.files.length>0&&pkg.files.length<=100000,'Invalid managed package identity');
  const actual=files.filter(f=>f.path.startsWith(pkg.root+'/')),seen=new Set();
  check(actual.length===pkg.files.length,'Managed package file inventory differs');
  const inventory=new Map(actual.map(f=>[f.path.slice(pkg.root.length+1),f]));
  for(const item of pkg.files){
   check(exactKeys(item,['path','size','sha256'])&&safeRelative(item.path)&&!seen.has(item.path.toLowerCase())&&Number.isSafeInteger(item.size)&&item.size>=0&&digest.test(item.sha256),'Invalid managed package file');seen.add(item.path.toLowerCase());
   const observed=inventory.get(item.path);check(observed&&observed.size===item.size&&observed.sha256===item.sha256,'Managed package bytes differ');
  }
  check(inventory.has('package.json'),'Managed package manifest is missing');
  const manifestFile=assertAssetPath(path.join(projectDir,pkg.root,'package.json'),projectDir);check(inventory.get('package.json').size<=1024**2,'Managed package manifest exceeds budget');
  const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));check(manifest.name===pkg.id&&manifest.version===pkg.version,'Managed package manifest identity differs');
  result.set(pkg.id,pkg);
 }
 return result;
}
