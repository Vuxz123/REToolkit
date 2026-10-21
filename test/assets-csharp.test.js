import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCSharp } from '../src/assets/csharp.js';

test('C# scanner preserves namespace, base types and serialized declarations through bodies/comments/strings', () => {
 const result = parseCSharp('using UnityEngine; namespace Demo { public class Player : MonoBehaviour { public int health = 7; [SerializeField] private GameObject target; public static int ignored; private int hidden; public string Label { get { return "}"; } } public void Tick() { /* } */ var x = "{"; } } }');
 assert.equal(result.supported, true); assert.equal(result.types[0].fullName, 'Demo.Player'); assert.deepEqual(result.types[0].baseTypes, ['MonoBehaviour']);
 assert.deepEqual(result.types[0].fields.filter(x => x.serialized), [{ name:'health',type:'int',serialized:true },{name:'target',type:'GameObject',serialized:true}]);
});
test('C# scanner handles file namespace and generic array fields, refuses uncertain declarations', () => {
 const result = parseCSharp('namespace Demo; public class Data : UnityEngine.ScriptableObject { [UnityEngine.SerializeField] private System.Collections.Generic.List<int[]> values; }');
 assert.equal(result.supported, true); assert.equal(result.types[0].fields[0].type, 'System.Collections.Generic.List<int[]>');
 for (const source of ['#if A\nclass A {}\n#endif','public record A(int x);','class A { public event System.Action Changed; }','class A { public int a, b; }','class A { public int x;']) assert.equal(parseCSharp(source).supported,false,source);
});
test('C# scanner refuses partial and uncertain field attributes instead of approving incomplete preservation',()=>{
 for(const source of ['partial class Player { public int health; }','class A { [field: SerializeField] public int X { get; set; } }','class A { [SerializeField, UnknownFieldAttribute] private int health; }','class A { public System.Func<int> f => () => 1; }']) assert.equal(parseCSharp(source).supported,false,source);
});
