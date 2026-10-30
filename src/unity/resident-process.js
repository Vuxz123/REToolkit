import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {withoutJevCredentials} from '../jev-environment.js';

// Read-only reconciliation for the gap between Editor spawn and session save.
// Never expose command lines or infer death when process inspection is denied.
export async function inspectResidentProcess(project,{spawnImpl=spawnSync,platform=process.platform}={}){
 const unknown=()=>({state:'unknown',pids:[]});
 if(platform!=='win32'||typeof project!=='string'||!path.isAbsolute(project)||/[\0\r\n]/.test(project))return unknown();
 const script=`$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RetkResidentArgs {
 [DllImport("shell32.dll", SetLastError=true)] static extern IntPtr CommandLineToArgvW([MarshalAs(UnmanagedType.LPWStr)] string command, out int count);
 [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);
 public static string[] Parse(string command) {
  int count; IntPtr memory=CommandLineToArgvW(command,out count); if(memory==IntPtr.Zero) throw new InvalidOperationException();
  try { string[] values=new string[count]; for(int i=0;i<count;i++) values[i]=Marshal.PtrToStringUni(Marshal.ReadIntPtr(memory,i*IntPtr.Size)); return values; }
  finally { LocalFree(memory); }
 }
}
'@
$target=[IO.Path]::GetFullPath($env:RETK_RESIDENT_PROJECT).TrimEnd('\\')
$pidsFound=@();$uncertain=$false
foreach($item in @(Get-CimInstance Win32_Process -Filter "Name = 'Unity.exe'" -ErrorAction Stop)) {
 if(!$item.CommandLine -or !$item.ExecutablePath){$uncertain=$true;continue}
 try {
  $parts=[RetkResidentArgs]::Parse([string]$item.CommandLine);$projects=@()
  for($i=0;$i -lt $parts.Length;$i++) {
   if($parts[$i] -ieq '-projectPath') {
    if($i+1 -ge $parts.Length){throw 'Missing project argument'}
    $i++;if(![IO.Path]::IsPathRooted($parts[$i])){throw 'Relative project argument'}
    $projects+=([IO.Path]::GetFullPath($parts[$i]).TrimEnd('\\'))
   }
  }
  if($projects.Count -gt 1){$uncertain=$true;continue}
  if($projects.Count -eq 1 -and [string]::Equals($projects[0],$target,[StringComparison]::OrdinalIgnoreCase)){$pidsFound+=[int]$item.ProcessId}
 } catch {$uncertain=$true}
}
@{state=$(if($uncertain){'unknown'}elseif($pidsFound.Count){'running'}else{'idle'});pids=@($pidsFound)}|ConvertTo-Json -Compress`;
 let result;
 try{result=spawnImpl(path.join(process.env.SystemRoot??'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,shell:false,encoding:'utf8',timeout:15000,maxBuffer:65536,env:{...withoutJevCredentials(process.env),RETK_RESIDENT_PROJECT:path.resolve(project)}});}catch{return unknown();}
 if(result.status!==0||result.error)return unknown();
 try{const value=JSON.parse(result.stdout.replace(/^\uFEFF/,''));if(!['idle','running','unknown'].includes(value.state)||!Array.isArray(value.pids)||value.pids.some(pid=>!Number.isSafeInteger(pid)||pid<=0)||value.pids.length>1024||new Set(value.pids).size!==value.pids.length||value.state==='idle'&&value.pids.length||value.state==='running'&&!value.pids.length)return unknown();return {state:value.state,pids:value.pids};}catch{return unknown();}
}
