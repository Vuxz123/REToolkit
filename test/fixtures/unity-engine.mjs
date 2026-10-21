import fs from 'node:fs';
const args=process.argv.slice(2),value=name=>args[args.indexOf(name)+1];
const request=JSON.parse(fs.readFileSync(value('-retkRequest'),'utf8'));
if(request.fixture?.ready)fs.writeFileSync(request.fixture.ready,JSON.stringify({pid:process.pid,args}));
if(request.fixture?.flood){process.stdout.write('x'.repeat(5*1024*1024));process.stderr.write('tail-error\n');}
if(request.fixture?.hang){setInterval(()=>{},1000);}
else setTimeout(()=>{
  fs.writeFileSync(value('-retkReport'),JSON.stringify({fixture:true}));
  console.log('Unity fixture closed');
  process.exit(request.fixture?.exitCode??0);
},request.fixture?.delay??20);
