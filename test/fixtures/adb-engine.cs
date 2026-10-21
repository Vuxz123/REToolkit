// Source-owned ADB protocol fixture. Never connects to a device or emulator.
using System;
using System.IO;
using System.Text;
using System.Diagnostics;
public static class OwnedAdbFixture {
 public static int Main(string[] args) {
  try {
   string root=Environment.GetEnvironmentVariable("RETK_ADB_FIXTURE_ROOT");
   if(String.IsNullOrEmpty(root))throw new Exception("Fixture root is required");
   string mode=Environment.GetEnvironmentVariable("RETK_ADB_FIXTURE_MODE") ?? "normal";
   string workspace=Environment.GetEnvironmentVariable("RETK_ADB_FIXTURE_WORKSPACE");
   bool locked=!String.IsNullOrEmpty(workspace) && Directory.Exists(Path.Combine(workspace,".retk-lock"));
   string encoded=Convert.ToBase64String(Encoding.UTF8.GetBytes(String.Join("\0",args)));
   File.AppendAllText(Path.Combine(root,"events.txt"),Process.GetCurrentProcess().Id+" "+(locked?"locked":"unlocked")+" "+encoded+"\n");
   if(args.Length==2 && args[0]=="devices" && args[1]=="-l") {
    Console.WriteLine("List of devices attached");Console.WriteLine("emulator-5554\tdevice product:owned model:fixture transport_id:1");
    if(mode=="multiple")Console.WriteLine("emulator-5556\tdevice product:owned model:fixture transport_id:2");
    return 0;
   }
   if(args.Length<3 || args[0]!="-s" || args[1]!="emulator-5554")throw new Exception("Unexpected selected fixture device");
   if(args[2]=="shell") {
    if(args.Length==7 && args[3]=="pm" && args[4]=="list" && args[5]=="packages") {Console.WriteLine("package:com.example.fixture");return 0;}
    if(args.Length==6 && args[3]=="pm" && args[4]=="path") {Console.WriteLine("package:/data/app/~~owned==/com.example.fixture==/base.apk");Console.WriteLine("package:/data/app/~~owned==/com.example.fixture==/split_config.arm64.apk");return 0;}
    if(args.Length==6 && args[3]=="ls" && args[4]=="-1") {
     if(mode=="denied"){Console.Error.WriteLine("ls: "+args[5]+": Permission denied");return 1;}
     if(mode=="missing-obb"){Console.Error.WriteLine("ls: "+args[5]+": No such file or directory");return 1;}
     Console.WriteLine("main.1.com.example.fixture.obb");return 0;
    }
    if(args.Length==7 && args[3]=="stat" && args[4]=="-c" && args[5]=="%s") {Console.WriteLine(new FileInfo(Source(root,args[6])).Length);return 0;}
   }
   if(args.Length==5 && args[2]=="pull") {
    File.Copy(Source(root,args[3]),args[4],false);
    if(mode=="partial")using(FileStream file=new FileStream(args[4],FileMode.Open,FileAccess.Write)){file.SetLength(file.Length-1);}
    Console.WriteLine("1 file pulled (source-owned fixture)");return 0;
   }
   throw new Exception("Unsupported fixture command");
  }catch(Exception error){Console.Error.WriteLine(error.Message);return 9;}
 }
 private static string Source(string root,string remote) {
  string name=remote.Substring(remote.LastIndexOf('/')+1);
  if(name!="base.apk" && name!="split_config.arm64.apk" && name!="main.1.com.example.fixture.obb")throw new Exception("Unexpected fixture source");
  return Path.Combine(root,name);
 }
}
