import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {assertAssetPath,assetError} from './context.js';
import {fingerprint} from '../state.js';

export const SQLITE_GRAPH_LIMITS=Object.freeze({maxAssets:250000,maxNodes:8000000,maxEdges:32000000,maxDatabaseBytes:32*1024**3,maxRowBytes:20*1024**2});
const MiB=1024**2,MAX_RESPONSE=MiB,MAX_VISITED=50000,BATCH=256;
const fail=(code,message=code)=>{throw assetError(code,message);};
const check=(ok,code,message)=>{if(!ok)fail(code,message);};
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const text=value=>typeof value==='string'&&value.length>0&&value.length<=4096&&!value.includes('\0');
const hashPattern=/^[a-f0-9]{64}$/;
function manifestHash(graph){const {storage,...manifest}=graph;return fingerprint(manifest);}
const sameStat=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
const require=createRequire(import.meta.url);
function sqlite(){let DatabaseSync;try{({DatabaseSync}=require('node:sqlite'));}catch{}check(typeof DatabaseSync?.prototype.enableDefensive==='function','sqlite_runtime_unsupported','Node24.15+ required for SQLite graphs');return DatabaseSync;}
function fileStat(file){assertAssetPath(file);const stat=fs.lstatSync(file);check(stat.isFile(),'sqlite_graph_invalid','Graph database must be a regular file');return stat;}
function fileHash(fd){const hash=createHash('sha256'),buffer=Buffer.allocUnsafe(MiB);let position=0,count;while((count=fs.readSync(fd,buffer,0,buffer.length,position))>0){hash.update(buffer.subarray(0,count));position+=count;}return hash.digest('hex');}
function configure(db,readOnly){db.enableDefensive(true);db.exec('PRAGMA trusted_schema=OFF; PRAGMA temp_store=FILE; PRAGMA cache_size=-8192; PRAGMA mmap_size=0;');if(readOnly)db.exec('PRAGMA query_only=ON;');else db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA page_size=4096;');}
function strictLimits(requested={}){check(object(requested),'sqlite_graph_limit','Invalid SQLite graph limits');const limits={...SQLITE_GRAPH_LIMITS};for(const [key,value]of Object.entries(requested)){check(Object.hasOwn(limits,key)&&Number.isSafeInteger(value)&&value>0&&value<=limits[key],'sqlite_graph_limit',`Invalid SQLite graph limit: ${key}`);limits[key]=value;}return limits;}
function encoded(value,max){check(object(value),'sqlite_graph_invalid','Graph row must be an object');const json=JSON.stringify(value);check(Buffer.byteLength(json)<=max,'sqlite_graph_row_limit','Graph row exceeds row byte limit');return json;}
const schema=`
CREATE TABLE metadata (id INTEGER PRIMARY KEY CHECK(id=1),json TEXT NOT NULL);
CREATE TABLE assets (ordinal INTEGER PRIMARY KEY,id TEXT NOT NULL UNIQUE,guid TEXT UNIQUE,path TEXT NOT NULL,kind TEXT,json TEXT NOT NULL);
CREATE TABLE nodes (ordinal INTEGER PRIMARY KEY,id TEXT NOT NULL UNIQUE,asset_id TEXT NOT NULL,guid TEXT,script_guid TEXT,type TEXT,json TEXT NOT NULL);
CREATE INDEX nodes_asset ON nodes(asset_id,ordinal);
CREATE INDEX nodes_script ON nodes(script_guid,ordinal);
CREATE TABLE edges (ordinal INTEGER PRIMARY KEY,from_id TEXT NOT NULL,to_id TEXT,kind TEXT,field TEXT,guid TEXT,status TEXT,json TEXT NOT NULL);
CREATE INDEX edges_from ON edges(from_id,ordinal);
CREATE INDEX edges_to ON edges(to_id,ordinal);
CREATE INDEX edges_guid ON edges(guid,ordinal);
CREATE TABLE owners (node_id TEXT PRIMARY KEY,owner_id TEXT,ordinal INTEGER NOT NULL);
CREATE INDEX owners_owner ON owners(owner_id);
CREATE TABLE children (parent_id TEXT NOT NULL,child_id TEXT NOT NULL,ordinal INTEGER NOT NULL,suborder INTEGER NOT NULL,PRIMARY KEY(parent_id,child_id));
CREATE INDEX children_order ON children(parent_id,ordinal,suborder);
CREATE TABLE child_objects (node_id TEXT PRIMARY KEY);
PRAGMA user_version=1;
`;

/** Append-only, bounded-memory writer. The caller owns cleanup of an unsuccessful fresh file. */
export function createSqliteStore({file,limits:requested}={}){
 check(typeof file==='string'&&path.isAbsolute(file),'sqlite_graph_invalid','Database file must be absolute');file=assertAssetPath(file);const limits=strictLimits(requested??{});
 const DatabaseSync=sqlite(),reservation=fs.openSync(file,'wx',0o600),created=fs.fstatSync(reservation),createdIdentity=Object.freeze({dev:created.dev,ino:created.ino});fs.closeSync(reservation);
 let db,closed=false,poisoned=false,phase='records',transaction=false,pending=0,pendingBytes=0;
 const counts={assets:0,nodes:0,edges:0};
 // maxDatabaseBytes covers main + DELETE journal. Reserve a second page copy,
 // journal record/header overhead, and fixed header headroom before SQLite can
 // allocate pages. Usable main-file capacity is therefore less than half the cap.
 const journalReserve=Math.min(MiB,Math.floor(limits.maxDatabaseBytes/16)),pageCeiling=Math.max(1,Math.floor((limits.maxDatabaseBytes-journalReserve)/(2*4096+8+64)));
 try{let current=fileStat(file);check(current.dev===created.dev&&current.ino===created.ino,'sqlite_graph_changed','Writer database identity changed before open');db=new DatabaseSync(file,{defensive:true,allowExtension:false});current=fileStat(file);check(current.dev===created.dev&&current.ino===created.ino,'sqlite_graph_changed','Writer database identity changed while opening');configure(db,false);db.exec(`PRAGMA max_page_count=${pageCeiling};`);db.exec(schema);}catch(error){db?.close();error.sqliteCreatedFileIdentity=createdIdentity;throw error;}
 const statements={asset:db.prepare('INSERT INTO assets VALUES(?,?,?,?,?,?)'),node:db.prepare('INSERT INTO nodes VALUES(?,?,?,?,?,?,?)'),edge:db.prepare('INSERT INTO edges VALUES(?,?,?,?,?,?,?,?)'),assetId:db.prepare('SELECT json FROM assets WHERE id=?'),assetGuid:db.prepare('SELECT json FROM assets WHERE guid=?'),hasNode:db.prepare('SELECT 1 FROM nodes WHERE id=?'),nodes:db.prepare('SELECT json FROM nodes ORDER BY ordinal'),owner:db.prepare('INSERT INTO owners VALUES(?,?,?) ON CONFLICT(node_id) DO UPDATE SET owner_id=excluded.owner_id')};
 function usable(){check(!closed,'sqlite_graph_closed','Graph store is closed or sealed');check(!poisoned,'sqlite_graph_failed','Graph store failed; discard its partial database');}
 function pin(){const current=fs.lstatSync(file);check(current.isFile()&&!current.isSymbolicLink()&&current.dev===created.dev&&current.ino===created.ino,'sqlite_graph_changed','Writer database identity changed');return current;}
 function budget(){assertAssetPath(file);let bytes=pin().size;try{const journal=fs.lstatSync(file+'-journal');check(journal.isFile()&&!journal.isSymbolicLink(),'sqlite_graph_invalid','Unexpected linked database journal');bytes+=journal.size;}catch(error){if(error.code!=='ENOENT')throw error;}check(bytes<=limits.maxDatabaseBytes,'sqlite_graph_disk_limit','SQLite database and journal exceed disk budget');}
 function commit(){budget();if(transaction){db.exec('COMMIT');transaction=false;pending=0;pendingBytes=0;}budget();}
 function mutate(callback){usable();try{pin();if(!transaction){budget();db.exec('BEGIN IMMEDIATE');transaction=true;}pendingBytes+=callback()??0;pending++;if(pending>=BATCH||pendingBytes>=MiB)commit();}catch(error){poisoned=true;if(transaction){try{db.exec('ROLLBACK');}catch{}transaction=false;}throw error;}}
 function record(kind,value){const json=encoded(value,limits.maxRowBytes);check(text(value.id),'sqlite_graph_invalid','Graph row needs an exact id');check(counts[kind]<limits[{assets:'maxAssets',nodes:'maxNodes'}[kind]],'sqlite_graph_count_limit',`${kind} count limit reached`);return json;}
 function get(statement,id){usable();const row=statement.get(id);return row?JSON.parse(row.json):null;}
 const store={
  createdIdentity,
  addAsset(asset){mutate(()=>{check(phase==='records','sqlite_graph_phase','Assets cannot be added after the edge phase');const json=record('assets',asset);check(text(asset.path),'sqlite_graph_invalid','Asset path is required');statements.asset.run(counts.assets,asset.id,typeof asset.guid==='string'?asset.guid.toLowerCase():null,asset.path,asset.kind??null,json);counts.assets++;return Buffer.byteLength(json);});},
  addNode(node){mutate(()=>{check(phase==='records','sqlite_graph_phase','Nodes cannot be added after the edge phase');const json=record('nodes',node);check(text(node.assetId)&&statements.assetId.get(node.assetId),'sqlite_graph_invalid','Node asset must already be stored');statements.node.run(counts.nodes,node.id,node.assetId,typeof node.guid==='string'?node.guid.toLowerCase():null,typeof node.scriptRef?.guid==='string'?node.scriptRef.guid.toLowerCase():null,node.type??null,json);counts.nodes++;return Buffer.byteLength(json);});},
  addEdge(edge){mutate(()=>{phase='edges';const json=encoded(edge,limits.maxRowBytes);check(counts.edges<limits.maxEdges,'sqlite_graph_count_limit','Edge count limit reached');check(text(edge.from)&&statements.hasNode.get(edge.from),'sqlite_graph_invalid','Edge source must be an existing node');check(edge.to===undefined||edge.to===null||text(edge.to),'sqlite_graph_invalid','Invalid edge destination');statements.edge.run(counts.edges,edge.from,edge.to??null,edge.kind??null,edge.field??null,typeof edge.guid==='string'?edge.guid.toLowerCase():null,edge.status??null,json);if(edge.field==='m_GameObject'&&edge.status==='resolved'&&edge.to)statements.owner.run(edge.from,edge.to,counts.edges);counts.edges++;return Buffer.byteLength(json);});},
  findAssetGuid(guid){return get(statements.assetGuid,guid.toLowerCase());},findAssetId(id){return get(statements.assetId,id);},hasNode(id){usable();return Boolean(statements.hasNode.get(id));},
  *nodes(){usable();for(const row of statements.nodes.iterate()){usable();yield JSON.parse(row.json);}},
  seal(meta){usable();try{
   check(object(meta)&&hashPattern.test(meta.revision)&&object(meta.binding)&&object(meta.coverage),'sqlite_graph_metadata','Invalid graph seal metadata');const graphSha256=meta.graphSha256??manifestHash(meta);check(hashPattern.test(graphSha256),'sqlite_graph_metadata','Invalid complete manifest hash');
   commit();db.exec('BEGIN IMMEDIATE');transaction=true;
   // Disk-backed hierarchy preserves the legacy edge pass, then ownership pass order.
   db.exec(`INSERT OR IGNORE INTO children
    SELECT parent,child,ordinal,suborder FROM (
     SELECT from_id parent,to_id child,ordinal,0 suborder FROM edges WHERE kind='component'
     UNION ALL SELECT to_id,from_id,ordinal,0 FROM edges WHERE kind='parent' AND to_id IS NOT NULL
     UNION ALL SELECT po.owner_id,co.owner_id,e.ordinal,1 FROM edges e JOIN owners po ON po.node_id=e.to_id JOIN owners co ON co.node_id=e.from_id WHERE e.kind='parent' AND e.to_id IS NOT NULL
    ) WHERE parent IS NOT NULL AND child IS NOT NULL AND parent!=child ORDER BY ordinal,suborder;
    INSERT OR IGNORE INTO children SELECT o.node_id,o.owner_id,(SELECT count(*) FROM edges)+o.ordinal,0 FROM owners o JOIN nodes n ON n.id=o.node_id WHERE n.type IN ('Transform','RectTransform') AND o.owner_id IS NOT NULL AND o.node_id!=o.owner_id;
    INSERT OR IGNORE INTO child_objects SELECT co.owner_id FROM edges e JOIN owners po ON po.node_id=e.to_id JOIN owners co ON co.node_id=e.from_id JOIN nodes pn ON pn.id=po.owner_id JOIN nodes cn ON cn.id=co.owner_id WHERE e.kind='parent' AND e.to_id IS NOT NULL AND po.owner_id!=co.owner_id AND pn.asset_id=cn.asset_id;`);
   budget();const metadata={kind:'retoolkit-sqlite-asset-graph',schemaVersion:1,revision:meta.revision,bindingSha256:fingerprint(meta.binding),graphSha256,coverage:meta.coverage,counts:{...counts}};
   db.prepare('INSERT INTO metadata VALUES(1,?)').run(encoded(metadata,limits.maxRowBytes));commit();db.close();closed=true;
   const stat=fileStat(file),fd=fs.openSync(file,'r');let sha256;try{sha256=fileHash(fd);check(sameStat(stat,fs.fstatSync(fd))&&sameStat(stat,fileStat(file)),'sqlite_graph_changed','Database changed while sealing');}finally{fs.closeSync(fd);}
   return {kind:'retoolkit-sqlite-graph-receipt',schemaVersion:1,sha256,size:stat.size,counts:{...counts},revision:meta.revision,bindingSha256:metadata.bindingSha256,graphSha256};
  }catch(error){poisoned=true;if(transaction){try{db.exec('ROLLBACK');}catch{}transaction=false;}throw error;}},
  close(){if(closed)return;try{if(transaction)db.exec('ROLLBACK');}finally{transaction=false;db.close();closed=true;}}
 };
 return store;
}

function filters(value,allowed){check(object(value),'invalid_query','Invalid graph selectors');for(const key of Object.keys(value))check(allowed.includes(key),'invalid_query_parameter',`Invalid selector parameter: ${key}`);}
function selection(value,max){if(value===undefined)return null;check(Array.isArray(value)&&value.length<=max&&value.every(text),'invalid_query_parameter','Invalid bounded selector list');return JSON.stringify(value);}

/** Authenticate immutable bytes before opening SQLite; every operation rechecks the pinned file identity. */
export function openSqliteGraph({file,receipt,graph}={}){
 check(typeof file==='string'&&path.isAbsolute(file),'sqlite_graph_invalid','Database file must be absolute');file=assertAssetPath(file);
 check(object(receipt)&&['sqlite','retoolkit-sqlite-graph-receipt'].includes(receipt.kind)&&receipt.schemaVersion===1&&hashPattern.test(receipt.sha256)&&hashPattern.test(receipt.graphSha256)&&Number.isSafeInteger(receipt.size)&&receipt.size>0&&receipt.size<=SQLITE_GRAPH_LIMITS.maxDatabaseBytes&&object(receipt.counts),'sqlite_graph_receipt','Invalid SQLite graph receipt');
 for(const [kind,max]of [['assets',SQLITE_GRAPH_LIMITS.maxAssets],['nodes',SQLITE_GRAPH_LIMITS.maxNodes],['edges',SQLITE_GRAPH_LIMITS.maxEdges]])check(Number.isSafeInteger(receipt.counts[kind])&&receipt.counts[kind]>=0&&receipt.counts[kind]<=max,'sqlite_graph_receipt','Invalid receipt counts');
 check(object(graph)&&hashPattern.test(graph.revision)&&object(graph.binding)&&object(graph.coverage),'sqlite_graph_metadata','Expected graph metadata is required');
 const expected={revision:graph.revision,bindingSha256:fingerprint(graph.binding),graphSha256:manifestHash(graph),coverage:graph.coverage},stat=fileStat(file);
 check(stat.size===receipt.size,'sqlite_graph_receipt','Database receipt size differs');
 for(const suffix of ['-journal','-wal','-shm']){try{fs.lstatSync(file+suffix);fail('sqlite_graph_receipt','Sealed database has an unexpected journal');}catch(error){if(error.code!=='ENOENT')throw error;}}
 let fd,db,closed=false;try{
  fd=fs.openSync(file,'r');check(sameStat(stat,fs.fstatSync(fd)),'sqlite_graph_changed','Database identity changed');check(fileHash(fd)===receipt.sha256,'sqlite_graph_receipt','Database receipt hash differs');check(sameStat(stat,fs.fstatSync(fd))&&sameStat(stat,fileStat(file)),'sqlite_graph_changed','Database changed while hashing');
  db=new (sqlite())(file,{readOnly:true,defensive:true,allowExtension:false});configure(db,true);
  check(sameStat(stat,fileStat(file))&&sameStat(stat,fs.fstatSync(fd)),'sqlite_graph_changed','Database changed while opening');
  const row=db.prepare('SELECT json FROM metadata WHERE id=1').get();check(row&&Buffer.byteLength(row.json)<=SQLITE_GRAPH_LIMITS.maxRowBytes,'sqlite_graph_metadata','Missing sealed database metadata');const metadata=JSON.parse(row.json);
  check(metadata.kind==='retoolkit-sqlite-asset-graph'&&metadata.schemaVersion===1&&metadata.revision===expected.revision&&metadata.bindingSha256===expected.bindingSha256&&metadata.graphSha256===expected.graphSha256&&receipt.graphSha256===expected.graphSha256&&fingerprint(metadata.coverage)===fingerprint(expected.coverage)&&fingerprint(metadata.counts)===fingerprint(receipt.counts)&&(!receipt.revision||receipt.revision===expected.revision)&&(!receipt.bindingSha256||receipt.bindingSha256===expected.bindingSha256),'sqlite_graph_metadata','Database manifest, revision, binding or coverage metadata differs');
 }catch(error){db?.close();if(fd!==undefined)fs.closeSync(fd);throw error;}
 const prepare=sql=>db.prepare(sql),getAsset=prepare('SELECT json FROM assets WHERE id=?'),getNode=prepare('SELECT json FROM nodes WHERE id=?'),assetExists=prepare('SELECT 1 FROM assets WHERE id=?'),nodeExists=prepare('SELECT 1 FROM nodes WHERE id=?');
 const childRows=prepare('SELECT child_id FROM children WHERE parent_id=? ORDER BY ordinal,suborder'),rootRows=prepare('SELECT n.id FROM nodes n WHERE n.asset_id=? AND NOT EXISTS(SELECT 1 FROM owners o WHERE o.node_id=n.id) AND NOT EXISTS(SELECT 1 FROM child_objects c WHERE c.node_id=n.id) ORDER BY n.ordinal'),assetNodeRows=prepare('SELECT id FROM nodes WHERE asset_id=? ORDER BY ordinal');
 const listRows=prepare('SELECT json FROM assets ORDER BY ordinal');
 const referenceRows=prepare(`SELECT e.json FROM edges e WHERE (?!='incoming' AND (e.from_id=? OR e.from_id IN (SELECT id FROM nodes WHERE asset_id=?))) OR (?!='outgoing' AND (e.to_id=? OR e.to_id IN (SELECT id FROM nodes WHERE asset_id=?))) ORDER BY e.ordinal`);
 // Separate fixed statements keep selective focus reads on their indexes.
 const nodeRows=[prepare('SELECT json FROM nodes ORDER BY ordinal'),prepare('SELECT json FROM nodes WHERE id IN (SELECT value FROM json_each(?)) ORDER BY ordinal'),prepare('SELECT json FROM nodes WHERE script_guid IN (SELECT lower(value) FROM json_each(?)) ORDER BY ordinal'),prepare('SELECT json FROM nodes WHERE id IN (SELECT value FROM json_each(?)) AND script_guid IN (SELECT lower(value) FROM json_each(?)) ORDER BY ordinal')];
 const edgeRows=[prepare('SELECT json FROM edges ORDER BY ordinal'),prepare('SELECT json FROM edges WHERE from_id IN (SELECT value FROM json_each(?)) ORDER BY ordinal'),prepare('SELECT json FROM edges WHERE guid IN (SELECT lower(value) FROM json_each(?)) ORDER BY ordinal'),prepare('SELECT json FROM edges WHERE from_id IN (SELECT value FROM json_each(?)) AND guid IN (SELECT lower(value) FROM json_each(?)) ORDER BY ordinal')];
 function guard(){check(!closed,'sqlite_graph_closed','Graph reader is closed');check(sameStat(stat,fileStat(file))&&sameStat(stat,fs.fstatSync(fd)),'sqlite_graph_changed','Database identity changed during graph read');}
 function decode(row){check(row&&Buffer.byteLength(row.json)<=SQLITE_GRAPH_LIMITS.maxRowBytes,'sqlite_graph_row_limit','Invalid graph row size');return JSON.parse(row.json);}
 function get(id){const row=getNode.get(id)??getAsset.get(id);return row?decode(row):null;}
 const base={revision:expected.revision,coverage:expected.coverage};
 function size(value){return Buffer.byteLength(JSON.stringify(value));}
 function response(value){check(size(value)<=MAX_RESPONSE,'graph_response_limit','Graph response exceeds one MiB; narrow the selector or read a bounded row iterator');guard();return value;}
 function tree(selector,depth){
  let truncated=false;const roots=[],reachable=new Set();
  function mark(root){if(reachable.has(root))return;if(reachable.size>=MAX_VISITED){truncated=true;return;}reachable.add(root);const pending=[root];while(pending.length){const id=pending.pop();for(const {child_id:child}of childRows.iterate(id))if(!reachable.has(child)){if(reachable.size>=MAX_VISITED){truncated=true;return;}reachable.add(child);pending.push(child);}}}
  if(nodeExists.get(selector))roots.push(selector);else{
   for(const {id}of rootRows.iterate(selector)){if(roots.length>=MAX_VISITED){truncated=true;break;}roots.push(id);}
   for(const id of roots){mark(id);if(truncated)break;}
   if(!truncated)for(const {id}of assetNodeRows.iterate(selector))if(!reachable.has(id)){if(roots.length>=MAX_VISITED){truncated=true;break;}roots.push(id);mark(id);if(truncated)break;}
  }
  const queue=[],seen=new Set();function enqueue(id,level){if(seen.has(id))return;if(seen.size>=MAX_VISITED){truncated=true;return;}seen.add(id);queue.push([id,level]);}
  for(const id of roots)enqueue(id,0);
  for(let i=0;i<queue.length;i++){const [id,level]=queue[i];if(level<depth)for(const {child_id:child}of childRows.iterate(id)){enqueue(child,level+1);if(truncated&&queue.length>=MAX_VISITED)break;}}
  return {queue,traversalTruncated:truncated,visitedCount:seen.size};
 }
 const reader={
  query(method,params={}){
   guard();filters(params,['id','assetId','kind','name','path','search','direction','depth','limit','cursor']);const limit=params.limit??100;check(Number.isInteger(limit)&&limit>=1&&limit<=1000,'invalid_limit');
   for(const key of ['id','assetId','kind','name','path','search','direction','cursor'])check(params[key]===undefined||typeof params[key]==='string'&&params[key].length<=(key==='cursor'?65536:4096),'invalid_query_parameter',key);
   const signature=fingerprint({method,...Object.fromEntries(Object.entries(params).filter(([key])=>!['cursor','limit'].includes(key)).sort(([a],[b])=>a.localeCompare(b)))});let offset=0;
   if(params.cursor){try{const cursor=JSON.parse(Buffer.from(params.cursor,'base64url').toString('utf8'));check(cursor.revision===expected.revision&&cursor.sha256===receipt.sha256&&cursor.signature===signature&&Number.isSafeInteger(cursor.offset)&&cursor.offset>=0,'invalid_cursor');offset=cursor.offset;}catch{fail('invalid_cursor');}}
   if(method==='assets.get'){check(params.id,'missing_selector');const item=get(params.id);check(item,'asset_not_found');return response({...base,item});}
   let rows,extra={};
   if(method==='assets.list')rows=(function*(){for(const row of listRows.iterate()){const a=decode(row);if((!params.kind||a.kind===params.kind)&&(!params.name||a.path.toLowerCase().includes(params.name.toLowerCase()))&&(!params.path||a.path.startsWith(params.path))&&(!params.search||`${a.path} ${a.kind}`.toLowerCase().includes(params.search.toLowerCase())))yield a;}})();
   else if(method==='assets.refs'){check(params.id&&(assetExists.get(params.id)||nodeExists.get(params.id)),'asset_not_found');const direction=params.direction??'both';check(['incoming','outgoing','both'].includes(direction),'invalid_direction');rows=(function*(){for(const row of referenceRows.iterate(direction,params.id,params.id,direction,params.id,params.id))yield decode(row);})();}
   else if(method==='assets.tree'){const selector=params.id??params.assetId;check(selector&&(assetExists.get(selector)||nodeExists.get(selector)),'asset_not_found');const depth=params.depth??32;check(Number.isInteger(depth)&&depth>=0&&depth<=100,'invalid_depth');const traversal=tree(selector,depth);extra={traversalTruncated:traversal.traversalTruncated,visitedCount:traversal.visitedCount};rows=(function*(){for(const [id,level]of traversal.queue){const node=get(id);if(node)yield {...node,depth:level};}})();}
   else fail('unsupported_graph_query',method);
   const items=[];let index=0,hasMore=false;const overhead=size({...base,...extra,items:[],nextCursor:'x'.repeat(512)});let bytes=overhead;
   for(const row of rows){if(index++<offset)continue;if(items.length>=limit){hasMore=true;break;}const rowBytes=size(row)+1;if(bytes+rowBytes>MAX_RESPONSE){check(items.length,'graph_response_limit','One graph row exceeds one MiB; narrow the selector or read a bounded row iterator');hasMore=true;break;}items.push(row);bytes+=rowBytes;}
   const nextCursor=hasMore?Buffer.from(JSON.stringify({revision:expected.revision,sha256:receipt.sha256,signature,offset:offset+items.length})).toString('base64url'):null;
   return response({...base,...extra,items,nextCursor});
  },
  *readNodes(selectors={}){guard();filters(selectors,['scriptGuids','ids']);const guids=selection(selectors.scriptGuids,10000),ids=selection(selectors.ids,50000),args=[ids,guids].filter(value=>value!==null);let count=0;try{for(const row of nodeRows[(ids!==null?1:0)+(guids!==null?2:0)].iterate(...args)){if(++count%BATCH===0)guard();yield decode(row);}}finally{guard();}},
  *readEdges(selectors={}){guard();filters(selectors,['fromIds','scriptGuids']);const ids=selection(selectors.fromIds,50000),guids=selection(selectors.scriptGuids,10000),args=[ids,guids].filter(value=>value!==null);let count=0;try{for(const row of edgeRows[(ids!==null?1:0)+(guids!==null?2:0)].iterate(...args)){if(++count%BATCH===0)guard();yield decode(row);}}finally{guard();}},
  close(){if(closed)return;try{db.close();}finally{fs.closeSync(fd);closed=true;}}
 };
 return reader;
}
