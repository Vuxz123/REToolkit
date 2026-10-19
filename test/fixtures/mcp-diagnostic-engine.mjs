import readline from 'node:readline';
const mode=process.argv[2];
const write=value=>{const line=JSON.stringify(value)+'\n';process.stdout.write(line.slice(0,8));setTimeout(()=>process.stdout.write(line.slice(8)),1);};
process.stderr.write('SECRET token stderr\n');
readline.createInterface({input:process.stdin}).on('line',line=>{
  const request=JSON.parse(line);if(!request.id)return;
  if(mode==='exit')process.exit(3);
  if(mode==='hang')return;
  if(mode==='oversized'){process.stdout.write('x'.repeat(1024*1024+1));return;}
  if(mode==='malformed'){process.stdout.write('{broken}\n');return;}
  let result;
  if(request.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};
  else if(request.method==='tools/list')result={tools:[{name:mode==='unsupported'?'decompile':'list_instances',inputSchema:{type:'object',properties:{}}}]};
  else if(request.method==='tools/call'&&request.params.name==='list_instances'){
    const text=JSON.stringify({instances:mode==='empty'?[]:[{project:mode==='wrong-project'?'GameOther':'Game',current_program:mode==='wrong-program'?'other.so':'libil2cpp.so',token:'SECRET'}]});
    result={content:[{type:'text',text}],structuredContent:{result:text}};
  }
  else process.exit(8);
  write({jsonrpc:'2.0',id:request.id,result});
});
