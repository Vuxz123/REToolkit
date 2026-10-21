import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {LIMITS,visualError} from './contract.js';
import {assertAssetPath} from '../assets/context.js';
/** A direct owned ffmpeg child; termination is awaited before leases can release. */
export async function runOwnedFfmpeg(executable,args,{cwd,env,timeoutMs=LIMITS.timeoutMs,shell=false}={}){
 if(shell!==false||timeoutMs!==LIMITS.timeoutMs)throw visualError('visual_frame_invalid','Unsafe video process options');
 return new Promise((resolve,reject)=>{
 let failure,timedOut=false,stderrBytes=0;
 const child=spawn(executable,args,{cwd,env,shell:false,windowsHide:true,stdio:['ignore','ignore','pipe']});
 const stop=()=>{timedOut=true;child.kill('SIGKILL');};
 const timer=setTimeout(stop,timeoutMs);
 const cancel=()=>{failure=visualError('visual_frame_cancelled','Owned frame extraction cancelled');child.kill('SIGKILL');};
 process.on('SIGINT',cancel);process.on('SIGTERM',cancel);
 child.stderr.on('data',bytes=>{stderrBytes+=bytes.length;if(stderrBytes>65536){failure??=visualError('visual_frame_output_limit','ffmpeg output exceeded limit');child.kill('SIGKILL');}});
 child.once('error',()=>{failure??=visualError('visual_frame_spawn_failed','Owned ffmpeg executable could not start');});
 child.once('close',(code,signal)=>{clearTimeout(timer);process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);
 if(timedOut)reject(visualError('visual_frame_timeout','Owned ffmpeg extraction timed out'));
 else if(failure)reject(failure);
 else if(code!==0||signal)reject(visualError('visual_frame_failed','Owned ffmpeg extraction failed'));
 else resolve({exitCode:0});});
 });
}
export async function extractFrame({executable,input,timeMs,output,profile,run=runOwnedFfmpeg}){
 for(const file of [executable,input,output]){if(typeof file!=='string'||!path.isAbsolute(file))throw visualError('visual_frame_invalid','Video paths must be absolute');assertAssetPath(file);}
 if(!Number.isSafeInteger(timeMs)||timeMs<0||timeMs>LIMITS.timeMs||!Number.isSafeInteger(profile.width)||!Number.isSafeInteger(profile.height)||profile.width*profile.height>LIMITS.pixels)throw visualError('visual_frame_invalid','Invalid video extraction geometry or timestamp');
 if(fs.existsSync(output))throw visualError('visual_frame_invalid','Frame output already exists');
 const cwd=path.dirname(output),temporary=assertAssetPath(path.join(cwd,'private-runtime'));fs.mkdirSync(temporary,{recursive:true,mode:0o700});
 const args=['-hide_banner','-loglevel','error','-nostdin','-n','-max_alloc',String(LIMITS.pngBytes),'-threads','1','-filter_threads','1','-filter_complex_threads','1','-protocol_whitelist','file','-format_whitelist','mov,matroska,webm,avi,mpegts','-probesize','5000000','-analyzeduration','5000000','-hwaccel','none','-noautorotate','-max_pixels',String(LIMITS.pixels),'-ss',(timeMs/1000).toFixed(3),'-i',input,'-map','0:v:0','-frames:v','1','-an','-sn','-dn','-threads','1','-fps_mode','passthrough','-c:v','png','-pix_fmt','rgba','-fs',String(LIMITS.pngBytes),'-f','image2',output];
 const inherited={...process.env};for(const key of Object.keys(inherited))if(key.toUpperCase()==='FFREPORT')delete inherited[key];
 await run(executable,args,{cwd,env:{...inherited,TMP:temporary,TEMP:temporary,TMPDIR:temporary,APPDATA:temporary,LOCALAPPDATA:temporary,AV_LOG_FORCE_NOCOLOR:'1'},shell:false,timeoutMs:LIMITS.timeoutMs});
}
