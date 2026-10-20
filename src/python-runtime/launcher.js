import {inspectManagedPython,verifyPythonRuntime} from './verify.js';
import {managedMcpArgs,pythonMcpEnvironment} from './runner.js';

// Caller owns a toolchain read lease through the actual child close.
export async function prepareMcpCommand(toolkit){
 const selection=inspectManagedPython(toolkit.root);
 if(selection.state==='absent')return {file:toolkit.legacyBridge??toolkit.tools.bridge,args:['--transport','stdio'],env:toolkit.env};
 if(selection.state==='invalid')throw Object.assign(new Error(selection.error.message),{code:selection.error.code});
 const report=await verifyPythonRuntime(toolkit.root);
 if(!report.ok)throw Object.assign(new Error(report.errors[0].message),{code:report.errors[0].code});
 return {file:report.profile.python,args:managedMcpArgs(report.profile.site),env:pythonMcpEnvironment(toolkit.env)};
}
