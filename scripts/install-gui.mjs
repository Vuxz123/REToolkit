// Install the pinned Electron runtime, then permit its sandbox to read that
// vendor-only directory on Windows. Never grant write access or alter data ACLs.
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..'),directory=path.join(root,'node_modules/electron');
if(Number(process.versions.node.split('.')[0])<24)throw Error('Node24+ required');
if(JSON.parse(fs.readFileSync(path.join(directory,'package.json'),'utf8')).version!=='44.9.1')throw Error('Unexpected Electron version');
const install=spawnSync(process.execPath,[path.join(directory,'install.js')],{stdio:'inherit',windowsHide:true});if(install.status!==0)process.exit(install.status??1);
const dist=path.join(directory,'dist');
if(fs.lstatSync(dist).isSymbolicLink()||fs.realpathSync(dist).toLowerCase()!==dist.toLowerCase())throw Error('Linked Electron distribution is unsupported');
if(process.platform==='win32'){
 const grant=spawnSync(path.join(process.env.SystemRoot??'C:/Windows','System32/icacls.exe'),[dist,'/grant','*S-1-15-2-1:(OI)(CI)(RX)','/T','/Q'],{encoding:'utf8',windowsHide:true});
 if(grant.status!==0)throw Error('Electron sandbox runtime ACL setup failed: '+grant.stderr);
}
console.log('Electron44.9.1 installed; renderer sandbox remains enabled.');
