#!/usr/bin/env node
import path from 'node:path';
import {runQuickstartCli} from '../src/bootstrap/cli.js';
try{await runQuickstartCli(process.argv.slice(2),path.resolve(import.meta.dirname,'..'));}catch(error){process.stderr.write(JSON.stringify({ok:false,error:{code:error.code??'QUICKSTART_FAILED',message:error.message}})+'\n');process.exitCode=1;}
