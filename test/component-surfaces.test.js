import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {componentFixture} from './helpers/component-fixture.js';
import {invokeAssetApi,validateAssetParams,registeredJobOperations} from '../src/assets/api.js';
import {assetTools} from '../src/assets/mcp.js';
import {desktopOperations} from '../src/desktop/operations.js';
import {recoveryOperations} from '../src/recovery/definitions.js';
import {workflowOperations} from '../src/workflow/definitions.js';
test('component operations have typed CLI MCP job GUI recovery and workflow surfaces',async t=>{
 const f=await componentFixture(t);
 for(const command of ['scan','observe','plan','apply','verify','report']){const op='components.'+command;assert.ok(registeredJobOperations[op]);assert.ok(assetTools.find(t=>t.name===op.replace('.','_')));assert.ok(desktopOperations.find(t=>t.id===op));assert.ok(recoveryOperations.has(op));assert.ok(workflowOperations.includes(op));}
 assert.throws(()=>validateAssetParams('components.observe',{componentIds:[f.id],command:'cmd.exe'}));
 assert.throws(()=>validateAssetParams('components.plan',{observationId:'a'.repeat(36),mappings:[{componentId:f.id,targetId:'x'}]}));
 const result=await invokeAssetApi(f.toolkit,'Game','components.scan',{});assert.equal(result.total,2);
 const cli=spawnSync(process.execPath,['re.js','components','report','Game','--operation',result.operationId,'--section','groups','--root',f.root,'--json'],{encoding:'utf8'});assert.equal(cli.status,0,cli.stderr);assert.equal(JSON.parse(cli.stdout).total,2);
});
