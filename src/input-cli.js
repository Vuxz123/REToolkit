import path from 'node:path';
import {createToolkit} from './toolkit.js';
import {inputError} from './input-selection.js';

export const isInputCommand=argv=>argv[0]==='inputs';
const usage='Usage: inputs <Game> [--root <path>] [--json]\n       inputs resolve <Game> [--policy prefer-arm64|manual] [--root <path>] [--json]\n       inputs select <Game> --binary <relative> --metadata <relative> --revision <sha256>\n       inputs recover <Game> --revision <sha256>\n';
export function parseInputArgs(argv){
 if(!Array.isArray(argv)||argv.some(value=>typeof value!=='string')||!isInputCommand(argv))throw inputError('INPUT_CLI_INVALID','Expected inputs command');
 if(argv.length===2&&['--help','-h'].includes(argv[1]))return {help:true};
 const positional=[],options={};let json=false;
 for(let index=1;index<argv.length;index++){
  const value=argv[index];if(!value.startsWith('-')){positional.push(value);continue;}
  if(!['--root','--json','--binary','--metadata','--revision','--policy'].includes(value)||Object.hasOwn(options,value))throw inputError('INPUT_CLI_INVALID',`Unknown or duplicate inputs option: ${value}`);
  if(value==='--json'){options[value]=true;json=true;continue;}
  const next=argv[++index];if(!next||next.startsWith('-')||/[\x00-\x1f]/.test(next))throw inputError('INPUT_CLI_INVALID',`Missing or invalid ${value} value`);options[value]=next;
 }
 const command=['select','recover','resolve'].includes(positional[0])?positional.shift():'inspect',name=positional[0];
 if(positional.length!==1||!/^[A-Za-z0-9_.-]{1,64}$/.test(name)||['.','..'].includes(name))throw inputError('INPUT_CLI_INVALID',usage.trim());
 if(['inspect','resolve'].includes(command)&&['--binary','--metadata','--revision'].some(key=>Object.hasOwn(options,key)))throw inputError('INPUT_CLI_INVALID','Inspection/resolution does not accept selection options');
 if(Object.hasOwn(options,'--policy')&&(command!=='resolve'||!['prefer-arm64','manual'].includes(options['--policy'])))throw inputError('INPUT_CLI_INVALID','Only resolution accepts --policy prefer-arm64 or manual');
 if(command==='recover'&&['--binary','--metadata'].some(key=>Object.hasOwn(options,key)))throw inputError('INPUT_CLI_INVALID','Recovery does not choose inputs');
 if(['select','recover'].includes(command)&&!/^[a-f0-9]{64}$/.test(options['--revision']??''))throw inputError('INPUT_REVISION_REQUIRED','An exact --revision from inputs inspection is required');
 if(command==='select'&&(!options['--binary']||!options['--metadata']))throw inputError('INPUT_CLI_INVALID','Selection requires --binary and --metadata');
 return {command,name,json,root:options['--root'],options:{...(options['--policy']?{policy:options['--policy']}:{}),...(options['--binary']?{binary:options['--binary']} :{}),...(options['--metadata']?{metadata:options['--metadata']} :{}),...(options['--revision']?{revision:options['--revision']} :{})}};
}
export async function runInputCli(argv,defaultRoot,dependencies={}){
 const parsed=parseInputArgs(argv),stdout=dependencies.stdout??process.stdout;
 if(parsed.help){stdout.write(usage);return;}
 const toolkit=dependencies.toolkit??createToolkit(path.resolve(parsed.root??defaultRoot),{log:message=>process.stderr.write(`${message}\n`)});
 const result=parsed.command==='inspect'?await toolkit.inspectInputs(parsed.name):parsed.command==='resolve'?await toolkit.resolveInputs(parsed.name,parsed.options):parsed.command==='select'?await toolkit.selectBuildInputs(parsed.name,parsed.options):await toolkit.recoverInputs(parsed.name,parsed.options);
 stdout.write(JSON.stringify(result,null,2)+'\n');return result;
}
