import os from 'node:os';
import path from 'node:path';
import {planAgentCleanup,applyAgentCleanup} from '../src/agents/config-migration.js';

const args=process.argv.slice(2);
if(args.some(arg=>arg!=='--apply')||args.length>1)throw Error('Usage: node scripts/clean-agent-integrations.mjs [--apply]');
const plan=planAgentCleanup(path.resolve(import.meta.dirname,'..'),os.homedir(),{codexHome:process.env.CODEX_HOME||path.join(os.homedir(),'.codex')});
// Never print configuration contents, credentials or replacement bytes.
console.log(JSON.stringify({mode:args.includes('--apply')?'apply':'plan',changes:plan.changes.map(item=>({file:item.file,action:item.after===null?'retire':item.before===null?'install':'update'})),warnings:plan.warnings}));
if(args.includes('--apply'))console.log(JSON.stringify(applyAgentCleanup(plan)));
