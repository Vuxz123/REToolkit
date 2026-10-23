import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import yazl from 'yazl';

export async function runDesktopFlowAcceptance(window,directory){
 const mark=value=>fs.appendFileSync(path.join(directory,'trace.log'),new Date().toISOString()+' '+value+'\n');
 mark('started');
 const execute=code=>window.webContents.executeJavaScript(code);
 const wait=condition=>execute(`new Promise((resolve,reject)=>{const until=Date.now()+10000;const check=()=>{if(${condition})resolve(true);else if(document.body.dataset.ready==='failed'||Date.now()>until)reject(Error('Flow condition failed: '+${JSON.stringify(condition)}+'; actual viewport '+innerWidth+'x'+innerHeight+'; DPR '+devicePixelRatio));else setTimeout(check,30)};check()})`);
 await wait("document.body.dataset.ready==='true'");
 await execute("document.querySelector('#workspace').value='FlowA';document.querySelector('#workspace').dispatchEvent(new Event('change'));");
 await wait("document.querySelector('.workflow-hero')?.textContent.includes('Xem tiến trình')");
 mark('project-ready');
 const sizes=[];for(const [width,height]of [[1280,720],[1366,768],[1600,1000]]){mark('viewport-request '+width+'x'+height);window.webContents.enableDeviceEmulation({screenPosition:'desktop',screenSize:{width,height},viewSize:{width,height},deviceScaleFactor:1,scale:1});await wait(`innerWidth===${width}&&innerHeight===${height}`);const row=await execute("(()=>{const r=document.querySelector('.workflow-hero button').getBoundingClientRect();return {width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,primaryAboveFold:r.bottom<innerHeight,headerAgent:!document.querySelector('#project-agent').hidden};})()");assert.equal(row.overflow,false);assert.equal(row.primaryAboveFold,true);assert.equal(row.headerAgent,true);sizes.push(row);mark('viewport-ready '+JSON.stringify(row));}
 window.webContents.enableDeviceEmulation({screenPosition:'desktop',screenSize:{width:1366,height:768},viewSize:{width:1366,height:768},deviceScaleFactor:1,scale:1});await wait('innerWidth===1366&&innerHeight===768');mark('capture-overview');await capture(window,path.join(directory,'overview.png'));mark('overview-captured');
 await execute("document.querySelector('.workflow-hero button').click()");await wait("document.querySelector('#job-detail').open&&document.querySelector('#result').textContent.includes('17/50')");
 const durableJob=await execute("document.querySelector('#result').textContent.includes('Assets/Fixture.prefab')&&!document.querySelector('#result img')");assert.equal(durableJob,true);await capture(window,path.join(directory,'job-detail.png'));
 await execute("document.querySelector('#job-detail').close();document.querySelector('#workspace').value='FlowB';document.querySelector('#workspace').dispatchEvent(new Event('change'));");
 await wait("document.querySelector('#active-project-title').textContent==='FlowB'");
 const projectIsolation=await execute("!document.querySelector('#job-detail').open&&document.querySelector('#result-card').hidden&&!document.querySelector('#result').textContent.includes('Fixture.prefab')&&!document.querySelector('#workflow-content').textContent.includes('17/50')");assert.equal(projectIsolation,true);
 await execute("document.querySelector('[data-route=reconstruction]').click();[...document.querySelectorAll('#workflow-content button')].find(b=>b.textContent==='Chọn kế hoạch').click()");
 const bound=await execute("document.querySelector('#fields [data-key=name]').value==='FlowB'&&document.querySelector('#fields [data-key=name]').readOnly");assert.equal(bound,true);
 await execute("document.querySelector('[data-route=verification]').click();[...document.querySelectorAll('#workflow-content button')].find(b=>b.textContent==='Kiểm chứng bằng Unity').click()");
 const typedScope=await execute("document.querySelector('#fields [data-key=assetIds]').tagName==='TEXTAREA'&&document.querySelector('#fields [data-key=resumeOperationId]').tagName==='INPUT'");assert.equal(typedScope,true);
 await execute("document.querySelector('[data-route=settings]').click();document.querySelector('[data-settings-tab=jev]').click()");await wait("!document.querySelector('#settings-panel').hidden&&document.querySelector('#jev-model').value");
 const oldModel=await execute("document.querySelector('#jev-model').value");await execute("document.querySelector('#jev-model').value='unsaved-fixture-model'");await execute("new Promise(r=>setTimeout(r,3200))");assert.equal(await execute("document.querySelector('#jev-model').value"),'unsaved-fixture-model');
 await execute("document.querySelector('[data-settings-tab=tools]').click();[...document.querySelectorAll('#tool-settings button')].find(b=>b.textContent==='Xem kế hoạch cài nhanh').click();document.querySelector('#execute').click()");await wait("document.querySelector('#result').textContent.includes('CLI dependencies')");
 const quickstartPlan=await execute("(async()=>{const s=await window.retk.snapshot();return s.jobs.some(j=>j.operation==='quickstart.plan'&&j.state==='succeeded'&&j.result?.state==='planned')})()");assert.equal(quickstartPlan,true);
 // Real intake only, automatic preparation disabled: no Unity/Ghidra/device/Agent.
 const root=await execute("(async()=>(await window.retk.snapshot()).root)()"),file=path.join(root,'flow-fixture.apk'),zip=new yazl.ZipFile();zip.addBuffer(Buffer.from('fixture-native'),'lib/arm64-v8a/libil2cpp.so');zip.addBuffer(Buffer.from('fixture-metadata'),'assets/bin/Data/Managed/Metadata/global-metadata.dat');zip.end();const stream=fs.createWriteStream(file);zip.outputStream.pipe(stream);await once(stream,'close');
 await execute(`document.querySelector('#new-project').click();document.querySelector('#new-project-name').value='FlowCreated';document.querySelector('#new-project-input').value=${JSON.stringify(file)};document.querySelector('#new-project-next').click();document.querySelector('#new-project-prepare').checked=false;document.querySelector('#new-project-next').click();`);
 assert.equal(await execute("!document.querySelector('#new-project-step-review').hidden"),true);await capture(window,path.join(directory,'intake-review.png'));await execute("document.querySelector('#new-project-dialog form').requestSubmit()");await wait("document.querySelector('#workspace').value==='FlowCreated'");
 const intake=fs.existsSync(path.join(root,'workspaces/FlowCreated/01_Extracted/lib/arm64-v8a/libil2cpp.so'));assert.equal(intake,true);
 const observed=await execute("window.retk.activity.inspect('FlowA')");assert.equal(observed.sessions.length,1);assert.equal(observed.sessions[0].state,'failed');assert.equal(observed.sessions[0].mcpState,'unverified');assert.ok(!JSON.stringify(observed).includes('do-not-forward'));
 const report={ready:true,quickstartPlan,viewportEmulation:true,sandbox:window.webContents.getLastWebPreferences().sandbox,nodeIntegration:window.webContents.getLastWebPreferences().nodeIntegration,sizes,projectIsolation,durableJob,typedScope,intake,sessionFailureObserved:true,settingsDraftPreserved:true,fixtureOnly:true};assert.equal(report.sandbox,true);assert.equal(report.nodeIntegration,false);fs.writeFileSync(path.join(directory,'observation.json'),JSON.stringify(report,null,2));
}
async function capture(window,file){await window.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');fs.writeFileSync(file,(await window.webContents.capturePage()).toPNG());}
