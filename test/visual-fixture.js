import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PNG} from 'pngjs';
import {createToolkit} from '../src/toolkit.js';
export async function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-visual-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const toolkit=createToolkit(root,{log:()=>{}});await toolkit.init('Game');
 const profile={width:2,height:2,locale:'en',platform:'fixture'};
 const image=(name,change=false)=>{const png=new PNG({width:2,height:2});png.data.fill(255);if(change)png.data[0]=0;const file=path.join(root,name);fs.writeFileSync(file,PNG.sync.write(png,{filterType:4}));return file;};
 const baseline=image('base.png'),candidate=image('candidate.png');
 const request={kind:'retoolkit-visual-request',schemaVersion:1,mode:'image',screen:'menu',state:'idle',profile,
 requiredRegions:[{id:'button',x:0,y:0,width:1,height:1,pixelDelta:0,maxChangedRatio:0,maxMeanAbsoluteError:0}],
 frames:[{id:'first',baseline:{path:baseline,profile:{...profile},provenance:{kind:'original',build:'1',source:'fixture test',approvedBy:'tester'}},candidate:{path:candidate,profile:{...profile}}}]};
 return {root,toolkit,request,baseline,candidate,image};
}
