import fs from 'node:fs/promises';
import path from 'node:path';

export async function createUnityFixture(root) {
  const projectDir = path.join(root, 'ExportedProject');
  const guids = { scene: '11111111111111111111111111111111', script: '22222222222222222222222222222222', prefab: '33333333333333333333333333333333' };
  const source = 'using UnityEngine;\nnamespace Demo { public class Player : MonoBehaviour { public int health = 7; [SerializeField] private GameObject target; public void Tick() { string text = "{ }"; } } }\n';
  const files = {
    'ProjectSettings/ProjectVersion.txt': 'm_EditorVersion: 2022.3.1f1\n',
    'Assets/Player.cs': source,
    'Assets/Player.cs.meta': `fileFormatVersion: 2\nguid: ${guids.script}\n`,
    'Assets/Main.unity.meta': `guid: ${guids.scene}\n`,
    'Assets/Thing.prefab.meta': `guid: ${guids.prefab}\n`,
    'Assets/Thing.prefab': '%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n--- !u!1 &-9223372036854775808\nGameObject:\n  m_Name: Préfàb\n  m_Component: []\n',
    'Assets/Main.unity': `%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n--- !u!1 &1\nGameObject:\n  m_Name: Player\n  m_Component:\n  - component: {fileID: 4}\n  - component: {fileID: 9007199254740993}\n--- !u!4 &4\nTransform:\n  m_GameObject: {fileID: 1}\n  m_Father: {fileID: 0}\n--- !u!114 &9007199254740993\nMonoBehaviour:\n  m_GameObject: {fileID: 1}\n  m_Script: {fileID: 11500000, guid: ${guids.script}, type: 3}\n  m_Enabled: 1\n  health: 7\n  target: {fileID: -9223372036854775808, guid: ${guids.prefab}, type: 3}\n  missing: {fileID: 99}\n`,
  };
  for (const [name, content] of Object.entries(files)) { const target = path.join(projectDir, name); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, content); }
  return { projectDir, guids, source, files, scriptPath: path.join(projectDir, 'Assets/Player.cs'), scenePath: path.join(projectDir, 'Assets/Main.unity') };
}
