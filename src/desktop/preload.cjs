const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('retk',Object.freeze({
 snapshot:()=>ipcRenderer.invoke('desktop:snapshot'),
 run:(operation,payload)=>ipcRenderer.invoke('desktop:run',operation,payload),
 choose:kind=>ipcRenderer.invoke('desktop:choose',kind),
 settings:Object.freeze({get:()=>ipcRenderer.invoke('desktop:settings:get'),save:payload=>ipcRenderer.invoke('desktop:settings:save',payload),test:()=>ipcRenderer.invoke('desktop:settings:test')}),
 onUpdate:callback=>{if(typeof callback!=='function')throw Error('Expected update callback');const listener=(_event,job)=>callback(job);ipcRenderer.on('desktop:update',listener);return()=>ipcRenderer.removeListener('desktop:update',listener);}
}));
