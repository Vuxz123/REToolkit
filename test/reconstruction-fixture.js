import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
export const source = 'namespace Game { public class Player : UnityEngine.MonoBehaviour { public int health; public void Run() {} } }';
export const replacement = source.replace('Run() {}','Run() { health += 1; }');
export async function fixture(t, second = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'retk-reconstruction-'));
  t.after(() => fs.rm(root,{recursive:true,force:true}));
  const projectDir=path.join(root,'project'), journalDir=path.join(root,'journal');
  const files={'ProjectSettings/ProjectVersion.txt':'m_EditorVersion: 2022.3.1f1\n','Assets/Player.cs':source,'Assets/Player.cs.meta':'fileFormatVersion: 2\nguid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n','Assets/Main.unity':'%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n--- !u!114 &9007199254740993\nMonoBehaviour:\n  m_Script: {fileID: 11500000, guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, type: 3}\n  health: 42\n'};
  if(second){files['Assets/Other.cs']=source.replace('Player','Other'); files['Assets/Other.cs.meta']='fileFormatVersion: 2\nguid: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n';}
  for(const [name,bytes] of Object.entries(files)){await fs.mkdir(path.dirname(path.join(projectDir,name)),{recursive:true});await fs.writeFile(path.join(projectDir,name),bytes);}
  const {indexUnityProject}=await import('../src/assets/graph.js');
  const binding={native:{sha256:'a'.repeat(64),size:100},metadata:{sha256:'b'.repeat(64),size:100},assetsSha256:'c'.repeat(64)};
  const graph=await indexUnityProject(projectDir,{binding});
  const {buildScriptMap}=await import('../src/reconstruction/map.js');
  const scriptMap=await buildScriptMap(graph,{projectDir});
  const request={kind:'retoolkit-reconstruction-request',schemaVersion:1,graphRevision:graph.revision,changes:scriptMap.scripts.map(s=>({scriptId:s.scriptId,source:s.path.endsWith('/Other.cs')?replacement.replace('Player','Other'):replacement}))};
  return {root,projectDir,journalDir,graph,scriptMap,request,files};
}
