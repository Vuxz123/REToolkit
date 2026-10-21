import {spawn} from 'node:child_process';

// Internal execution seam permits lifecycle tests without a Unity installation.
// The supervisor must already own both persistent gates before calling this.
export function executeUnityChild({file,args,cwd,env,timeoutSeconds,token},{spawnImpl=spawn,control=process}={}){
  return new Promise((resolve,reject)=>{
    let child,tail=Buffer.alloc(0),timedOut=false,closeTimer,timer,spawnError,settled=false;
    const append=data=>{const limit=4*1024*1024-4;tail=data.length>=limit?Buffer.from(data.subarray(data.length-limit)):Buffer.concat([tail.subarray(Math.max(0,tail.length+data.length-limit)),data]);};
    const finish=(error,value)=>{
      if(settled)return;settled=true;clearTimeout(timer);clearTimeout(closeTimer);control.removeListener('message',cancel);
      error?reject(error):resolve(value);
    };
    const stop=()=>{
      if(settled||closeTimer)return;
      try{child.kill('SIGKILL');}catch{}
      closeTimer=setTimeout(()=>{
        // kill() alone never establishes closure. Abandon local handles while
        // the supervisor retains its reader and workspace marker for recovery.
        child.stdout.destroy();child.stderr.destroy();child.unref();
        finish(Object.assign(Error('Unity child close was not observed.'),{code:'unity_recovery_required',closed:false}));
      },2000);
    };
    const cancel=message=>{if(message?.type==='unity-cancel'&&message.token===token)stop();};
    try{child=spawnImpl(file,args,{cwd,env,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});}
    catch{finish(Object.assign(Error('Unity Editor could not start.'),{code:'unity_start_failed',closed:true}));return;}
    child.stdout.on('data',append);child.stderr.on('data',append);
    child.stdout.on('error',()=>{});child.stderr.on('error',()=>{});
    child.on('error',error=>{spawnError=error;});
    timer=setTimeout(()=>{timedOut=true;stop();},timeoutSeconds*1000);control.on('message',cancel);
    child.once('close',exitCode=>{
      if(spawnError)finish(Object.assign(Error('Unity Editor could not start.'),{code:'unity_start_failed',closed:true}));
      else {
        // Replacement characters from malformed native output can occupy more
        // UTF-8 bytes than the original stream. Bound the transmitted text too.
        const text=Buffer.from(tail.toString('utf8'));
        finish(null,{exitCode,closed:true,timedOut,logTail:text.subarray(Math.max(0,text.length-(4*1024*1024-4))).toString('utf8')});
      }
    });
  });
}
