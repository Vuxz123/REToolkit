import fs from 'node:fs';
import path from 'node:path';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import yazl from 'yazl';
import {runMultiAbiAcceptance} from './multiabi-acceptance.mjs';
import {runWorkspacePreviewAcceptance} from './workspace-preview-acceptance.mjs';

export async function runProjectAgentAcceptance(window,directory){
 const execute=code=>window.webContents.executeJavaScript(code),root=await execute('(async()=>(await window.retk.snapshot()).root)()');
 const input=path.join(root,'project-fixture.apk'),zip=new yazl.ZipFile();
 zip.addBuffer(Buffer.from('fixture-native'),'lib/arm64-v8a/libil2cpp.so');zip.addBuffer(Buffer.from('fixture-metadata'),'assets/bin/Data/Managed/Metadata/global-metadata.dat');zip.end();const output=fs.createWriteStream(input);zip.outputStream.pipe(output);await once(output,'close');
 const bridge=await execute('(async()=>{const harnesses=await window.retk.agents.list();let rejected=false;try{await window.retk.agents.launch("Fixture","shell")}catch{rejected=true}return {ids:harnesses.map(h=>h.id),rejected};})()');
 assert.deepEqual(bridge.ids,['codex','claude','gemini','opencode']);assert.equal(bridge.rejected,true);
 await execute(`(()=>{document.querySelector('#new-project').click();document.querySelector('#new-project-name').value='NewApkFixture';document.querySelector('#new-project-prepare').checked=false;document.querySelector('#new-project-input').value=${JSON.stringify(input)};return document.querySelector('#new-project-dialog').open;})()`);
 await saveScreenshot(window,path.join(directory,'new-project.png'));
 const project=await execute(`(async()=>{document.querySelector('#new-project-dialog form').requestSubmit();const until=Date.now()+12000;while(Date.now()<until){const s=await window.retk.snapshot(),job=s.jobs.find(j=>j.operation==='project.create'&&j.payload.name==='NewApkFixture');if(job&&['succeeded','failed','unverified'].includes(job.state)&&document.querySelector('#workspace').value==='NewApkFixture')return {state:job.state,result:job.result,panel:!document.querySelector('#project-agent').hidden,harnesses:[...document.querySelector('#agent-harness').options].map(o=>o.value),button:document.querySelector('#open-agent').textContent};await new Promise(r=>setTimeout(r,25));}throw Error('Project UI intake timed out');})()`);
 assert.equal(project.state,'succeeded');assert.equal(project.result.state,'created');assert.equal(project.panel,true);assert.equal(project.harnesses.length,4);assert.match(project.button,/AI Agent/);
 const stored=JSON.parse(fs.readFileSync(path.join(root,'workspaces/NewApkFixture/project.re.json'),'utf8'));assert.equal(stored.steps.scan.state,'succeeded');assert.notEqual(stored.steps.import.state,'succeeded');
 assert.equal(await execute('document.querySelector("#fields input[data-key=name]").value'), 'NewApkFixture');
 await execute('document.querySelector("[data-group=workspace]").click();window.scrollTo(0,0)');await saveScreenshot(window,path.join(directory,'project-agent.png'));
 // Submit the same name through the actual form and verify no replacement.
 const before=fs.readFileSync(path.join(root,'workspaces/NewApkFixture/project.re.json'));
 const duplicate=await execute(`(async()=>{document.querySelector('#new-project').click();document.querySelector('#new-project-dialog form').requestSubmit();const until=Date.now()+10000;while(Date.now()<until){const s=await window.retk.snapshot(),jobs=s.jobs.filter(j=>j.operation==='project.create');if(jobs.length>=2&&jobs.at(-1).state==='failed')return true;await new Promise(r=>setTimeout(r,25));}return false;})()`);assert.equal(duplicate,true);assert.deepEqual(fs.readFileSync(path.join(root,'workspaces/NewApkFixture/project.re.json')),before);
 // Large warning output must retain a selectable incomplete project through
 // the second creation path, the ordinary operations form.
 const incompleteInput=path.join(root,'incomplete-fixture.apk'),incompleteZip=new yazl.ZipFile();incompleteZip.addBuffer(Buffer.from('fixture'),'assets/bin/Data/boot.config');for(let index=0;index<150;index++)incompleteZip.addBuffer(Buffer.from('opaque'),`Android/obb/com.fixture.game/main.${index}.obb`);incompleteZip.end();const incompleteOut=fs.createWriteStream(incompleteInput);incompleteZip.outputStream.pipe(incompleteOut);await once(incompleteOut,'close');
 const incomplete=await execute(`(async()=>{globalThis.__selectDesktopOperation('workspace','project.create');const operation=document.querySelector('#operation');operation.value='project.create';operation.dispatchEvent(new Event('change'));document.querySelector('#fields input[data-key=name]').value='IncompleteFixture';document.querySelector('#fields input[data-key=input]').value=${JSON.stringify(incompleteInput)};document.querySelector('#execute').click();const until=Date.now()+15000;while(Date.now()<until){const s=await window.retk.snapshot(),job=s.jobs.find(j=>j.operation==='project.create'&&j.payload.name==='IncompleteFixture');if(job?.state==='succeeded'&&document.querySelector('#workspace').value==='IncompleteFixture')return {state:job.result.state,stored:!!job.storedResult,field:document.querySelector('#fields input[data-key=name]').value,agent:document.querySelector('#project-agent h2').textContent,tone:document.querySelector('#result-state').dataset.tone};await new Promise(r=>setTimeout(r,25));}throw Error('Incomplete project selection timed out');})()`);
 assert.equal(incomplete.state,'needs-input');assert.equal(incomplete.stored,true);assert.equal(incomplete.field,'IncompleteFixture');assert.match(incomplete.agent,/IncompleteFixture/);assert.equal(incomplete.tone,'warn');
 await saveScreenshot(window,path.join(directory,'project-incomplete.png'));
 const multiAbi=await runMultiAbiAcceptance(window,root,directory,saveScreenshot);
 const workspacePreview=await runWorkspacePreviewAcceptance(window,root,directory,saveScreenshot);
 return {newProject:true,projectSelection:true,harnessDropdown:true,harnessLaunchRejected:true,duplicatePreserved:true,incompleteSelection:true,largePreview:true,multiAbi,workspacePreview,agentExecution:false};
}
async function saveScreenshot(window,file){
 await window.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
 const image=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{window.webContents.removeListener('paint',paint);reject(Error('Project screenshot timeout'));},10000);function paint(_event,_dirty,image){if(image.toPNG().length<10000){window.webContents.invalidate();return;}clearTimeout(timer);window.webContents.removeListener('paint',paint);resolve(image);}window.webContents.on('paint',paint);window.webContents.invalidate();});fs.writeFileSync(file,image.toPNG());
}
