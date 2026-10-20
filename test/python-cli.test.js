import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePythonRuntimeArgs,isPythonRuntimeCommand} from '../src/python-runtime/cli.js';
test('Python CLI accepts only its strict offline plan/install/verify syntax',()=>{
 assert.equal(isPythonRuntimeCommand(['--root','X','python-runtime','verify']),true);
 assert.equal(parsePythonRuntimeArgs(['python-runtime','verify','--json']).action,'verify');
 assert.equal(parsePythonRuntimeArgs(['python-runtime','install','lock.json','--cache=cache']).options.cache,'cache');
 for(const args of [['verify','x'],['plan','lock','--cache','x'],['install'],['verify','--json=true'],['verify','--root','x','--root','y'],['verify','--force']])assert.throws(()=>parsePythonRuntimeArgs(['python-runtime',...args]),{code:'PYTHON_ARGUMENT_INVALID'});
});
