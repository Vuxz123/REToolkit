// Source-owned HTTP fixture. It does not establish real AssetRipper export support.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),mode=process.argv[3]??'normal';
if(mode==='early-exit')process.exit(7);
const stateFile=path.join(config.workspace,'04_Notes/asset-engine-fixture.json'),state={enginePid:process.pid,runId:config.runId,loads:0,reads:0,exportPaths:[]};
const save=()=>fs.writeFileSync(stateFile,JSON.stringify(state));save();
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname==='/openapi.json'){const paths={};for(const p of ['/Assets/Json','/Assets/Yaml','/Assets/Text','/Assets/Binary','/Assets/Image'])paths[p]={get:{}};for(const p of ['/LoadFolder','/Export/UnityProject'])paths[p]={post:{}};if(mode==='capability-missing')delete paths['/LoadFolder'];res.setHeader('content-type','application/json');res.end(JSON.stringify({openapi:'3.0.1',paths}));return;}
 if(url.pathname.startsWith('/Assets/')){state.reads++;save();if(mode==='redirect'){res.writeHead(302,{location:'http://example.test/'});res.end();return;}if(mode==='huge'){res.end('x'.repeat(3*1024*1024));return;}if(mode==='slow-read')await delay(300);res.setHeader('content-type','application/json');res.end('{"source":'+url.searchParams.get('Path')+'}');return;}
 const chunks=[];for await(const c of req)chunks.push(c);const form=new URLSearchParams(Buffer.concat(chunks).toString());
 if(url.pathname==='/LoadFolder'){state.loads++;save();if(mode==='slow-load')await delay(500);if(mode==='load-fail'){res.writeHead(500);res.end('load failed');return;}}
 else if(url.pathname==='/Export/UnityProject'){
  const destination=form.get('Path');if(fs.readdirSync(destination).length)throw Error('Fixture export destination is not empty');state.exportPaths.push(destination);save();
  if(mode!=='silent-export'){const root=path.join(destination,'ExportedProject');fs.mkdirSync(path.join(root,'Assets'),{recursive:true});fs.mkdirSync(path.join(root,'ProjectSettings'),{recursive:true});fs.writeFileSync(path.join(root,'Assets/Player.cs'),'using UnityEngine; public class Player : MonoBehaviour { public int health; }');fs.writeFileSync(path.join(root,'Assets/Player.cs.meta'),'fileFormatVersion: 2\nguid: 0123456789abcdef0123456789abcdef\n');fs.writeFileSync(path.join(root,'ProjectSettings/ProjectVersion.txt'),'m_EditorVersion: 2022.3.0f1\n');}
 }else{res.writeHead(404);res.end();return;}
 res.writeHead(302,{location:'/'});res.end();
});
server.listen(0,'127.0.0.1',()=>console.log('Now listening on: http://127.0.0.1:'+server.address().port));
process.on('SIGTERM',()=>{server.close();server.closeAllConnections();});
