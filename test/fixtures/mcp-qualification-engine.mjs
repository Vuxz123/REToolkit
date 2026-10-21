import readline from 'node:readline';
const mode=process.argv[2],methods=[];
let page=0;
const write=(stream,value)=>new Promise((resolve,reject)=>stream.write(value,error=>error?reject(error):resolve()));
readline.createInterface({input:process.stdin}).on('line',async line=>{
 const q=JSON.parse(line);methods.push(q.method);if(q.id===undefined)return;
 if(mode==='hang')return;if(mode==='exit')process.exit(4);
 if(mode==='malformed'){process.stdout.write('{bad}\n');return;}
 if(mode==='oversized'){process.stdout.write('x'.repeat(1024**2+1));return;}
 if(q.method==='initialize'&&['stderr-limit','combined-output-limit'].includes(mode)){
  await write(process.stderr,Buffer.alloc((mode==='stderr-limit'?4:3)*1024**2+1,120));
  if(mode==='combined-output-limit'){
   for(let i=0;i<4;i++)await write(process.stdout,JSON.stringify({jsonrpc:'2.0',method:'notifications/progress',params:{data:'x'.repeat(512*1024)}})+'\n');
  }
  await new Promise(resolve=>setTimeout(resolve,30));
 }
 process.stderr.write('SECRET credential never retained\n');
 let result;
 if(q.method==='initialize')result={protocolVersion:'2025-03-26',serverInfo:{name:'fixture',version:'1.0'}};
 if(q.method==='tools/list'){
  page++;
  if(mode==='eight-pages'||mode==='nine-pages')result={tools:[{name:`tool-${page}`}],...(page<(mode==='eight-pages'?8:9)?{nextCursor:`page-${page+1}`}:{})};
  else if(mode==='4096-tools'||mode==='4097-tools')result={tools:Array.from({length:mode==='4096-tools'?4096:4097},(_,index)=>({name:`tool-${(page-1)*4096+index}`})),...(mode==='4096-tools'&&page===1?{nextCursor:'page2'}:{})};
  else if(mode==='duplicate-tools')result={tools:[{name:'duplicate'},{name:'duplicate'}]};
  else if(mode==='duplicate-tools-across-pages')result={tools:[{name:'duplicate'}],...(page===1?{nextCursor:'page2'}:{})};
  else if(mode==='repeated-cursor')result={tools:[{name:`tool-${page}`}],nextCursor:'page2'};
  else if(mode==='cyclic-cursors')result={tools:[{name:`tool-${page}`}],nextCursor:page%2?'page2':'page3'};
  else result={tools:[{name:q.params.cursor?'second':'first'}],...(q.params.cursor?{}:{nextCursor:'page2'})};
 }
 if(!result)process.exit(7);process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,result})+'\n');
});
