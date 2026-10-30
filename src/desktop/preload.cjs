const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('retk',Object.freeze({
 snapshot:()=>ipcRenderer.invoke('desktop:snapshot'),
 run:(operation,payload)=>ipcRenderer.invoke('desktop:run',operation,payload),
 choose:kind=>ipcRenderer.invoke('desktop:choose',kind),
 copyText:text=>ipcRenderer.invoke('desktop:copy',text),
 inputs:name=>ipcRenderer.invoke('desktop:inputs',name),
 ghidraActivity:name=>ipcRenderer.invoke('desktop:ghidra-activity',name),
 activity:Object.freeze({inspect:name=>ipcRenderer.invoke('desktop:activity:inspect',name),detail:(name,request)=>ipcRenderer.invoke('desktop:activity:detail',name,request)}),
 preparation:Object.freeze({inspect:(name,runId,verifyFreshness=false)=>ipcRenderer.invoke('desktop:preparation:inspect',name,runId,verifyFreshness),devices:()=>ipcRenderer.invoke('desktop:preparation:devices'),packages:serial=>ipcRenderer.invoke('desktop:preparation:packages',serial)}),
 agents:Object.freeze({list:()=>ipcRenderer.invoke('desktop:agents:list'),sessions:(name,harness)=>ipcRenderer.invoke('desktop:agents:sessions',name,harness),launch:(name,harness,options)=>ipcRenderer.invoke('desktop:agents:launch',name,harness,options)}),
 settings:Object.freeze({get:()=>ipcRenderer.invoke('desktop:settings:get'),save:payload=>ipcRenderer.invoke('desktop:settings:save',payload),test:()=>ipcRenderer.invoke('desktop:settings:test')}),
 onUpdate:callback=>{if(typeof callback!=='function')throw Error('Expected update callback');const listener=(_event,job)=>callback(job);ipcRenderer.on('desktop:update',listener);return()=>ipcRenderer.removeListener('desktop:update',listener);}
}));
