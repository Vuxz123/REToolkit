import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {parseDesktopRuntimeArgs} from '../src/desktop-runtime/cli.js';
import {parseDesktopLaunchArgs} from '../src/desktop-launch/cli.js';
test('runtime CLI strictly separates offline plan, explicit install and verify',()=>{
 assert.equal(parseDesktopRuntimeArgs(['desktop-runtime','plan','--lock','x']).action,'plan');
 for(const args of [['desktop-runtime','verify','--lock','x'],['desktop-runtime','plan','--lock','x','--cache','y'],['desktop-runtime','install','--lock','x','--lock','y']])assert.throws(()=>parseDesktopRuntimeArgs(args));
 const r=spawnSync(process.execPath,['re.js','desktop-runtime','plan','--lock','config/desktop-windows-x64.lock.json','--json'],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).kind,'retoolkit-desktop-plan');
});
test('Ghidra launcher CLI rejects arbitrary passthrough and tracks receipt status',()=>{
 assert.deepEqual(parseDesktopLaunchArgs(['pyghidra-gui','Game','--json']).launch,{mode:'pyghidra',name:'Game'});
 assert.equal(parseDesktopLaunchArgs(['ghidra-gui']).launch.mode,'ghidra');
 for(const args of [['ghidra-gui','Game','--eval','x'],['pyghidra-gui','Game','Other'],['desktop-launch','status']])assert.throws(()=>parseDesktopLaunchArgs(args));
});
