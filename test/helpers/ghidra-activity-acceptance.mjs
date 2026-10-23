import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

export async function runGhidraActivityAcceptance(window,root,directory,capture){
 const workspace=path.join(root,'workspaces/GhidraMonitorFixture'),notes=path.join(workspace,'04_Notes'),lock=path.join(workspace,'.retk-lock'),runId='33333333-3333-4333-8333-333333333333';
 fs.mkdirSync(notes,{recursive:true});fs.mkdirSync(lock);
 const owner=path.join(lock,`owner-${process.pid}-abc.json`);fs.writeFileSync(owner,JSON.stringify({pid:process.pid}));
 const stateFile=path.join(workspace,'project.re.json'),project={name:'GhidraMonitorFixture',steps:{analyze:{state:'running',runId,startedAt:new Date(Date.now()-600000).toISOString(),owner:{pid:process.pid}}}};
 fs.writeFileSync(stateFile,JSON.stringify(project));
 const log=path.join(notes,`analyze-${runId}.log`);fs.writeFileSync(log,'ERROR Failed to disassemble (GccExceptionAnalyzer)\n<img src=x onerror="globalThis.unsafeGhidraLog=true">\n');fs.utimesSync(log,new Date(Date.now()-400000),new Date(Date.now()-400000));
 const execute=code=>window.webContents.executeJavaScript(code);
 await execute(`(async()=>{document.querySelector('[data-group=workspace]').click();document.querySelector('#refresh').click();const until=Date.now()+8000;while(Date.now()<until){const picker=document.querySelector('#workspace');if([...picker.options].some(item=>item.value==='GhidraMonitorFixture')){picker.value='GhidraMonitorFixture';picker.dispatchEvent(new Event('change'));document.querySelector('[data-route=resources]').click();document.querySelector('#ghidra-details').open=true;break;}await new Promise(r=>setTimeout(r,25));}while(Date.now()<until){const panel=document.querySelector('#ghidra-activity');if(!panel.hidden&&panel.textContent.includes('GccExceptionAnalyzer'))return;await new Promise(r=>setTimeout(r,25));}throw Error('External Ghidra task was not displayed');})()`);
 const initial=await execute(`(()=>{const panel=document.querySelector('#ghidra-activity');panel.scrollIntoView({block:'start'});return {text:panel.textContent,progress:!!panel.querySelector('progress'),unsafe:!!globalThis.unsafeGhidraLog,images:panel.querySelectorAll('img').length};})()`);
 assert(initial.progress);assert.equal(initial.unsafe,false);assert.equal(initial.images,0);assert.match(initial.text,/GccExceptionAnalyzer/);assert.match(initial.text,/5 phút/);assert.match(initial.text,/PID/);await capture(window,path.join(directory,'ghidra-activity.png'));
 fs.appendFileSync(log,'INFO New analyzer output from owned fixture\n');
 await execute(`(async()=>{const until=Date.now()+8000;while(Date.now()<until){if(document.querySelector('#ghidra-activity-tasks').textContent.includes('New analyzer output'))return;await new Promise(r=>setTimeout(r,50));}throw Error('Ghidra log did not poll');})()`);
 project.steps.analyze.state='succeeded';project.steps.analyze.completedAt=new Date().toISOString();fs.writeFileSync(stateFile,JSON.stringify(project));fs.unlinkSync(owner);fs.rmdirSync(lock);
 await execute(`(async()=>{const until=Date.now()+8000;while(Date.now()<until){const panel=document.querySelector('#ghidra-activity');if(panel.textContent.includes('Hoàn tất')&&!panel.querySelector('progress')&&panel.textContent.includes('không có khóa'))return;await new Promise(r=>setTimeout(r,50));}throw Error('Ghidra final state did not refresh');})()`);
 return {externalAnalysis:true,ownerPid:true,quietWarning:true,boundedLog:true,safeText:true,automaticLogRefresh:true,finalState:true,engineExecution:false};
}
