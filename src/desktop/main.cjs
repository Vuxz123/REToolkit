const {app,BrowserWindow,ipcMain,protocol,session,dialog,clipboard}=require('electron');
const fs=require('node:fs'),path=require('node:path');
if(process.env.RETK_DESKTOP_SMOKE||process.env.RETK_DESKTOP_VISIBLE_SMOKE||process.env.RETK_DESKTOP_RESULT_SMOKE||process.env.RETK_DESKTOP_PREPARATION_SMOKE||process.env.RETK_DESKTOP_FLOW_SMOKE)app.disableHardwareAcceleration();
protocol.registerSchemesAsPrivileged([{scheme:'retk',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
function argument(key){const index=process.argv.indexOf(key);if(index<0||process.argv.indexOf(key,index+1)!==-1||!process.argv[index+1]||process.argv[index+1].startsWith('--'))throw Error('Invalid desktop launch argument');return process.argv[index+1];}
(async()=>{
 const root=path.resolve(argument('--toolkit-root')),node=path.resolve(argument('--node-path'));
 if(!fs.statSync(node).isFile())throw Error('Original Node executable is unavailable');
 app.setPath('userData',path.join(root,'.cache/electron-user'));
 if(!app.requestSingleInstanceLock()){app.quit();return;}
 const {createDesktopBroker}=await import('./jobs.js'),{validateDesktopSender,validateDesktopCopyText,buildDesktopCommand}=await import('./operations.js');let window;
 const broker=createDesktopBroker(root,{node,jevEnvironment:()=>settings.jevEnvironment(),onChange:job=>{if(window&&!window.isDestroyed())window.webContents.send('desktop:update',job);}});
 const {createAgentLauncher}=await import('../agents/launcher.js');const agents=createAgentLauncher(root,{node});
 const {createToolkit}=await import('../toolkit.js');const toolkit=createToolkit(root,{log:()=>{}});
 const {createGhidraActivityReader}=await import('./ghidra-activity.js');const ghidraActivity=createGhidraActivityReader(root);
 const {createDesktopActivityReader}=await import('./activity.js');const activity=createDesktopActivityReader(root,{toolkit,ghidraActivity});
 let activityCache;
 function inspectActivity(name){if(activityCache?.name===name&&Date.now()-activityCache.at<500)return activityCache.promise;const promise=activity.inspect(name);activityCache={name,at:Date.now(),promise};promise.catch(()=>{if(activityCache?.promise===promise)activityCache=undefined;});return promise;}
 const {createSettingsController}=await import('./settings.js');const settings=createSettingsController(root,{canModify:()=>broker.canQuit()});
 await app.whenReady();
 session.defaultSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
 session.defaultSession.setPermissionCheckHandler(()=>false);
 session.defaultSession.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!details.url.startsWith('retk://app/')}));
 const files={'/index.html':['index.html','text/html; charset=utf-8'],'/renderer.js':['renderer.js','text/javascript; charset=utf-8'],'/project-view.js':['project-view.js','text/javascript; charset=utf-8'],'/input-selection-view.js':['input-selection-view.js','text/javascript; charset=utf-8'],'/result-model.js':['result-model.js','text/javascript; charset=utf-8'],'/result-view.js':['result-view.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8']};
 files['/ghidra-activity-view.js']=['ghidra-activity-view.js','text/javascript; charset=utf-8'];
 files['/preparation-view.js']=['preparation-view.js','text/javascript; charset=utf-8'];
 for(const file of ['project-model.js','workflow-view.js','operation-form.js','settings-view.js','refresh-gate.js'])files['/'+file]=[file,'text/javascript; charset=utf-8'];
 files['/workflow.css']=['workflow.css','text/css; charset=utf-8'];
 protocol.handle('retk',request=>{
  const url=new URL(request.url),entry=files[url.pathname];if(url.host!=='app'||!entry||request.method!=='GET'||url.search)return new Response('Not found',{status:404});
  return new Response(fs.readFileSync(path.join(__dirname,entry[0])),{headers:{'Content-Type':entry[1],'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'"}});
 });
 window=new BrowserWindow({title:'REToolkit',width:1400,height:920,minWidth:1000,minHeight:700,backgroundColor:'#0b1019',show:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,webviewTag:false,...((process.env.RETK_DESKTOP_SMOKE||process.env.RETK_DESKTOP_RESULT_SMOKE||process.env.RETK_DESKTOP_PREPARATION_SMOKE||process.env.RETK_DESKTOP_FLOW_SMOKE)?{offscreen:true,backgroundThrottling:false}:{})}});
 app.on('second-instance',()=>{if(window.isMinimized())window.restore();window.focus();});
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());window.webContents.on('will-attach-webview',event=>event.preventDefault());
 function trusted(event){if(!validateDesktopSender(event,window.webContents))throw Error('Untrusted desktop sender');}
 ipcMain.handle('desktop:snapshot',event=>{trusted(event);return broker.snapshot();});
 ipcMain.handle('desktop:inputs',(event,name)=>{trusted(event);buildDesktopCommand('workspace.status',{name});return toolkit.inspectInputs(name);});
 ipcMain.handle('desktop:ghidra-activity',(event,name)=>{trusted(event);return ghidraActivity(name);});
 ipcMain.handle('desktop:activity:inspect',(event,name)=>{trusted(event);buildDesktopCommand('workspace.status',{name});return inspectActivity(name);});
 ipcMain.handle('desktop:activity:detail',(event,name,request)=>{trusted(event);buildDesktopCommand('workspace.status',{name});return activity.detail(name,request);});
 ipcMain.handle('desktop:preparation:inspect',async(event,name,runId,verifyFreshness=false)=>{trusted(event);if(typeof verifyFreshness!=='boolean')throw Error('Freshness verification must be a boolean');buildDesktopCommand('workspace.preparation',{name,...(runId===undefined?{}:{runId})});const {inspectPreparation}=await import('../preparation/service.js');const [report,{jobs}]=await Promise.all([inspectPreparation(toolkit,name,{...(runId===undefined?{}:{runId}),verifyFreshness}),inspectActivity(name)]);const job=jobs.find(job=>job.operation==='workspace.prepare'&&(!runId||job.preparationProgress?.runId===runId));return {...report,...(job?{job}:{})};});
 ipcMain.handle('desktop:preparation:devices',async event=>{trusted(event);const {runAdbOperation}=await import('../adb/api.js');return runAdbOperation(toolkit,undefined,'adb.devices',{});});
 ipcMain.handle('desktop:preparation:packages',async(event,serial)=>{trusted(event);buildDesktopCommand('adb.packages',{serial});const {runAdbOperation}=await import('../adb/api.js');return runAdbOperation(toolkit,undefined,'adb.packages',{serial});});
 ipcMain.handle('desktop:agents:list',event=>{trusted(event);return agents.list();});
 ipcMain.handle('desktop:agents:sessions',(event,name,harness)=>{trusted(event);return agents.sessions(name,harness);});
 ipcMain.handle('desktop:agents:launch',(event,name,harness,options)=>{trusted(event);if(settings.busy()||!broker.canQuit())throw Error('Wait for the current desktop task before opening an Agent');return agents.launch(name,harness,options);});
 ipcMain.handle('desktop:copy',(event,text)=>{trusted(event);clipboard.writeText(validateDesktopCopyText(text));return {copied:true};});
 ipcMain.handle('desktop:run',(event,operation,payload)=>{trusted(event);if(settings.busy())throw Error('Wait for Jev settings to finish before starting a task');return broker.submit(operation,payload);});
 ipcMain.handle('desktop:settings:get',event=>{trusted(event);return settings.get();});
 ipcMain.handle('desktop:settings:save',(event,payload)=>{trusted(event);return settings.save(payload);});
 ipcMain.handle('desktop:settings:test',event=>{trusted(event);return settings.test();});
 ipcMain.handle('desktop:choose',async(event,kind)=>{
  trusted(event);if(!['input','folder','request','out','apk'].includes(kind))throw Error('Unknown picker');
  if(kind==='out'){const selected=await dialog.showSaveDialog(window,{title:'Chọn file đầu ra mới'});return selected.canceled?null:selected.filePath;}
  const selected=await dialog.showOpenDialog(window,{title:kind==='folder'?'Chọn thư mục':'Chọn file',properties:kind==='folder'?['openDirectory']:['openFile'],...(kind==='request'?{filters:[{name:'JSON',extensions:['json']}]}:kind==='apk'?{filters:[{name:'Android build',extensions:['apk','xapk','apks','aab','zip']}]}:{})});return selected.canceled?null:selected.filePaths[0];
 });
 window.on('close',event=>{if(!broker.canQuit()||settings.busy()){event.preventDefault();dialog.showMessageBoxSync(window,{type:'info',title:'Tác vụ đang chạy',message:'Chờ tác vụ hiện tại hoàn tất trước khi đóng REToolkit.',detail:'Trạng thái và log được hiển thị trong bảng tác vụ.'});}});
 app.on('window-all-closed',()=>{if(broker.canQuit())app.quit();});
 await window.loadURL('retk://app/index.html');
 if(process.env.RETK_DESKTOP_FLOW_SMOKE){const {runDesktopFlowAcceptance}=await import('../../test/helpers/desktop-flow-acceptance.mjs');await runDesktopFlowAcceptance(window,path.resolve(process.env.RETK_DESKTOP_FLOW_SMOKE));window.close();return;}
 if(process.env.RETK_DESKTOP_PREPARATION_SMOKE){const {runPreparationAcceptance}=await import('../../test/helpers/preparation-acceptance.mjs');await runPreparationAcceptance(window,path.resolve(process.env.RETK_DESKTOP_PREPARATION_SMOKE));window.close();return;}
 if(process.env.RETK_DESKTOP_RESULT_SMOKE){const {runDesktopResultsAcceptance}=await import('../../test/helpers/desktop-results-acceptance.mjs');await runDesktopResultsAcceptance(window,path.resolve(process.env.RETK_DESKTOP_RESULT_SMOKE));window.close();return;}
 if(process.env.RETK_DESKTOP_VISIBLE_SMOKE){
  const directory=path.resolve(process.env.RETK_DESKTOP_VISIBLE_SMOKE);fs.mkdirSync(directory,{recursive:true});
  await window.webContents.executeJavaScript('new Promise((resolve,reject)=>{const until=Date.now()+10000;const check=()=>{if(document.body.dataset.ready==="true")resolve(true);else if(document.body.dataset.ready==="failed"||Date.now()>until)reject(Error("Desktop startup failed"));else setTimeout(check,25)};check()})');
  const observation={ready:'true',visible:window.isVisible(),minimized:window.isMinimized(),nodeIntegration:window.webContents.getLastWebPreferences().nodeIntegration,electron:process.versions.electron};
  fs.writeFileSync(path.join(directory,'observation.json'),JSON.stringify(observation));window.close();return;
 }
 if(process.env.RETK_DESKTOP_SMOKE){
  const directory=path.resolve(process.env.RETK_DESKTOP_SMOKE);fs.mkdirSync(directory,{recursive:true});
  await window.webContents.executeJavaScript('new Promise((resolve,reject)=>{const until=Date.now()+10000;const check=()=>{if(document.body.dataset.ready==="true")resolve(true);else if(document.body.dataset.ready==="failed"||Date.now()>until)reject(Error("Desktop startup failed"));else setTimeout(check,25)};check()})');
  const observation=await window.webContents.executeJavaScript('({title:document.title,ready:document.body.dataset.ready,hasNode:typeof require,hasBridge:typeof window.retk.snapshot,panels:document.querySelectorAll("[data-route]").length})');
  const ipc=await window.webContents.executeJavaScript('(async()=>{let rejected=false;try{await window.retk.run("shell",{command:"cmd.exe"})}catch{rejected=true}const job=await window.retk.run("workspace.init",{name:"DesktopFixture"});const until=Date.now()+10000;while(Date.now()<until){const s=await window.retk.snapshot(),j=s.jobs.find(j=>j.id===job.id);if(j&&["succeeded","failed","unverified"].includes(j.state))return {rejected,job:j,workspace:s.workspaces.find(w=>w.name==="DesktopFixture")};await new Promise(r=>setTimeout(r,25))}throw Error("Desktop IPC fixture timed out")})()');
  const settingsObservation=await window.webContents.executeJavaScript('(async()=>{const current=await window.retk.settings.get();const saved=await window.retk.settings.save({settings:{...current.settings,apiKeyEnv:"JEV_DESKTOP_FIXTURE_KEY"}});const test=await window.retk.settings.test();document.querySelector("[data-group=settings]").click();document.querySelector("[data-settings-tab=jev]").click();return {configured:saved.configured,keyPresent:saved.authentication.present,test}})()');
  await window.webContents.executeJavaScript('new Promise((resolve,reject)=>{const until=Date.now()+5000;const check=()=>{if(!document.querySelector("#settings-panel").hidden&&document.querySelector("#jev-model").value)requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true)));else if(Date.now()>until)reject(Error("Settings rendering timed out"));else setTimeout(check,25)};check()})');
  const screenshot=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{window.webContents.removeListener('paint',paint);reject(Error('Offscreen content paint timeout'));},10000);function paint(_event,_dirty,image){if(image.toPNG().length<10000){window.webContents.invalidate();return;}clearTimeout(timer);window.webContents.removeListener('paint',paint);resolve(image);}window.webContents.on('paint',paint);window.webContents.invalidate();});fs.writeFileSync(path.join(directory,'desktop.png'),screenshot.toPNG());fs.writeFileSync(path.join(directory,'observation.json'),JSON.stringify({...observation,electron:process.versions.electron,root},null,2));
  window.close();
  fs.writeFileSync(path.join(directory,'observation.json'),JSON.stringify({...observation,ipc,settings:settingsObservation,electron:process.versions.electron,root},null,2));
 }
})().catch(error=>{process.stderr.write('REToolkit desktop: '+error.message+'\n');app.exit(1);});
