// Explicit real Swing acceptance. The source-owned bootstrap opens no project
// and disposes/exits only windows and threads inside its own JVM.
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {createToolkit} from '../src/toolkit.js';
import {buildDesktopLaunchSpec,statusDesktopLauncher} from '../src/desktop-launch/index.js';
import {fileIdentity} from '../src/state.js';
import {acquireToolchainRead,withToolchainWrite} from '../src/toolchain/lease.js';
import {runProcess} from '../src/process.js';
import {verifyDesktopRuntime} from '../src/desktop-runtime/index.js';
const checkout=path.resolve(import.meta.dirname,'..');
if(![3,4].includes(process.argv.length))throw Error('Usage: node test/real-desktop-launch.mjs <reference-toolkit-root> [managed-runtime-acceptance-root]');
const managed=process.argv[3]?path.resolve(process.argv[3]):null;if(managed)assert.ok(managed.startsWith(path.join(checkout,'.cache/desktop-runtime-acceptance')+path.sep),'Use only an isolated managed-runtime acceptance root');
const mode=managed?'pyghidra':'ghidra',name=managed?'PyGuiFixture':'GuiFixture',reference=createToolkit(path.resolve(process.argv[2]),{log:()=>{}}),root=managed??path.join(checkout,'.cache/desktop-launch-acceptance',randomUUID().slice(0,8)),toolkit=createToolkit(root,{log:()=>{}});await fs.mkdir(root,{recursive:true});await toolkit.init(name);
Object.assign(toolkit.tools,{java:reference.tools.java,jdk:reference.tools.jdk,ghidra:reference.tools.ghidra});
const sentinelFiles=[reference.tools.java,path.join(reference.tools.ghidra,'Ghidra/application.properties'),path.join(reference.tools.ghidra,'support/launch.properties')],before=sentinelFiles.map(fileIdentity),lease=acquireToolchainRead(reference.root),report={kind:'retoolkit-desktop-launch-acceptance',schemaVersion:1,startedAt:new Date().toISOString(),passed:false,root,mode,productionActivation:false,projectOpened:false,mcp:'unverified',analysis:'unverified'};
let worker;
try{
 if(managed)assert.equal((await verifyDesktopRuntime(root)).ok,true);
 const fixtureRoot=path.join(root,'.cache/gui-fixture',randomUUID().slice(0,8));await fs.mkdir(fixtureRoot,{recursive:true});const source=path.join(fixtureRoot,'RetkDesktopAcceptance.java'),classes=path.join(fixtureRoot,'classes'),observation=path.join(fixtureRoot,'swing.json');await fs.mkdir(classes);
 await fs.writeFile(source,`import java.awt.*;import javax.swing.*;import java.nio.file.*;import java.nio.charset.StandardCharsets;import java.util.concurrent.atomic.AtomicReference;
public class RetkDesktopAcceptance {
 public static void arm(String file) throws Exception {
  Path receipt=Path.of(file);Thread observer=new Thread(()->{try{
   long deadline=System.currentTimeMillis()+45000;AtomicReference<String> found=new AtomicReference<>();
   while(System.currentTimeMillis()<deadline){SwingUtilities.invokeAndWait(()->{for(Window window:Window.getWindows())if(window.isShowing()&&window instanceof Frame){Frame frame=(Frame)window;String type=window.getClass().getName();String title=frame.getTitle();if(type.equals("docking.DockingFrame")&&title.startsWith("Ghidra"))found.set(type);}});if(found.get()!=null)break;Thread.sleep(100);}
   boolean passed=found.get()!=null;Files.writeString(receipt,"{\\"windowCreated\\":"+passed+",\\"mainFrameClass\\":\\""+(passed?found.get():"unobserved")+"\\",\\"projectOpened\\":false}",StandardCharsets.UTF_8);
   SwingUtilities.invokeAndWait(()->{for(Window window:Window.getWindows())window.dispose();});System.exit(passed?0:3);
  }catch(Throwable failure){try{Files.writeString(receipt,"{\\"windowCreated\\":false,\\"observerFailure\\":true}");}catch(Exception ignored){}System.exit(4);}},"retk-owned-swing-observer");observer.setDaemon(false);observer.start();
 }
 public static void main(String[] args) throws Exception { arm(args[0]);ghidra.Ghidra.main(new String[]{"ghidra.GhidraRun"}); }
}
`);
 const utility=path.join(reference.tools.ghidra,'Ghidra/Framework/Utility/lib/Utility.jar');await runProcess(path.join(reference.tools.jdk,'bin/javac.exe'),['-cp',utility,'-d',classes,source],{cwd:root,env:reference.env});
 const spec=await buildDesktopLaunchSpec(toolkit,{mode,name}),classFile=path.join(classes,'RetkDesktopAcceptance.class');spec.identities.push({file:classFile,...fileIdentity(classFile)});
 if(managed){spec.args[4]=spec.args[4].replace('launcher = GuiPyGhidraLauncher(install_dir=Path(config[\'install\']))',`import jpype\nclass ObservedLauncher(GuiPyGhidraLauncher):\n    def _launch(self):\n        jpype.JClass('RetkDesktopAcceptance').arm(config['receipt'])\n        super()._launch()\nlauncher = ObservedLauncher(install_dir=Path(config['install']))\nlauncher.add_classpaths(config['classes'])`);const args=JSON.parse(spec.args[6]);spec.args[6]=JSON.stringify({...args,classes,receipt:observation});}
 else{const cp=spec.args.indexOf('-cp');spec.args=[...spec.args.slice(0,cp),'-cp',classes+path.delimiter+utility,'RetkDesktopAcceptance',observation];}
 const runId=randomUUID(),run=path.join(root,'.cache/desktop-launch/runs',runId),config=path.join(run,'config.json');await fs.mkdir(run,{recursive:true});await fs.writeFile(config,JSON.stringify({root,runId,run,name,mode,workspace:toolkit.workspace(name),spec}));
 worker=spawn(process.execPath,[fileURLToPath(new URL('../src/desktop-launch/worker.js',import.meta.url)),config],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let error='';worker.stderr.on('data',b=>error+=b.toString().slice(0,8192-error.length));const closed=new Promise(resolve=>worker.once('close',(code,signal)=>resolve({code,signal,error})));const observedDeadline=Date.now()+15000;let live;
 while(Date.now()<observedDeadline){try{live=statusDesktopLauncher(toolkit,runId);if(live.state==='launched'||live.state==='failed')break;}catch{}await delay(40);}assert.equal(live?.state,'launched');
 await assert.rejects(withToolchainWrite(root,async()=>{}, {inspectProcesses:async()=>({state:'idle',processes:[]})}),{code:'TOOLCHAIN_BUSY'});report.leaseRetainedDuringGui=true;
 const completion=await Promise.race([closed,delay(65000,undefined,{ref:false}).then(()=>{throw Error('Owned source bootstrap did not close in bounded time; retained engine ownership requires inspection.');})]);assert.equal(completion.code,0,completion.error);report.launch=statusDesktopLauncher(toolkit,runId);report.swing=JSON.parse(await fs.readFile(observation,'utf8'));assert.equal(report.swing.windowCreated,true);assert.equal(report.launch.childCloseObserved,true);assert.equal(report.launch.state,'closed');assert.equal(fsSync.existsSync(path.join(toolkit.workspace(name),'.retk-lock')),false);report.leaseReleasedAfterClose=true;if(managed){assert.equal((await verifyDesktopRuntime(root)).ok,true);report.sealedProfileUnchanged=true;}
 assert.deepEqual(sentinelFiles.map(fileIdentity),before);report.referenceSentinelsUnchanged=true;report.passed=true;
}catch(error){report.error={code:error.code??'DESKTOP_GUI_ACCEPTANCE_FAILED',message:String(error.message??error)};process.exitCode=1;}
finally{if(!worker||report.launch?.childCloseObserved===true)lease.release();else report.referenceReadLeaseRetained=true;report.completedAt=new Date().toISOString();const file=path.join(root,managed?'pyghidra-gui-acceptance.json':'acceptance.json');await fs.writeFile(file,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,reportFile:file,mode,swing:report.swing,error:report.error,leaseRetainedDuringGui:report.leaseRetainedDuringGui,leaseReleasedAfterClose:report.leaseReleasedAfterClose,sealedProfileUnchanged:report.sealedProfileUnchanged,referenceSentinelsUnchanged:report.referenceSentinelsUnchanged,projectOpened:false,mcp:'unverified'}));}
