// Metadata-only inspection. Never load or invoke the target assembly.
using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Text.Json;
using Mono.Cecil;
using Mono.Cecil.Cil;
internal static class REToolkitManagedInspector {
 static bool Attr(ICustomAttributeProvider p,string name)=>p.HasCustomAttributes&&p.CustomAttributes.Any(a=>a.AttributeType.FullName==name);
 static bool Generated(TypeDefinition t)=>Attr(t,"System.Runtime.CompilerServices.CompilerGeneratedAttribute")||(t.DeclaringType!=null&&Generated(t.DeclaringType));
 static bool Trivial(MethodDefinition m){
  if(!m.HasBody)return false;
  var code=m.Body.Instructions.Where(i=>i.OpCode.Code!=Code.Nop).ToArray();
  if(code.Length==1&&code[0].OpCode.Code==Code.Ret)return true;
  if(code.Length!=2||code[1].OpCode.Code!=Code.Ret)return false;
  return new[]{Code.Ldnull,Code.Ldc_I4_M1,Code.Ldc_I4_0,Code.Ldc_I4_1,Code.Ldc_I4_2,Code.Ldc_I4_3,Code.Ldc_I4_4,Code.Ldc_I4_5,Code.Ldc_I4_6,Code.Ldc_I4_7,Code.Ldc_I4_8,Code.Ldc_I4,Code.Ldc_I4_S,Code.Ldc_I8,Code.Ldc_R4,Code.Ldc_R8}.Contains(code[0].OpCode.Code);
 }
 static IEnumerable<TypeDefinition> Types(IEnumerable<TypeDefinition> roots){foreach(var t in roots){yield return t;foreach(var n in Types(t.NestedTypes))yield return n;}}
 static object Inspect(string file){
  var options=new ReaderParameters{ReadSymbols=false,ReadingMode=ReadingMode.Deferred,InMemory=true};
  using(var assembly=AssemblyDefinition.ReadAssembly(file,options)){
   if(assembly.Modules.Count!=1)throw new Exception("Multi-module assemblies are unsupported");
   var types=Types(assembly.MainModule.Types).Where(t=>t.Name!="<Module>").ToArray();if(types.Length>20000)throw new Exception("Type limit exceeded");
   return new {assembly=new {name=assembly.Name.Name,version=assembly.Name.Version.ToString(),culture=assembly.Name.Culture??"",publicKeyToken=Convert.ToHexString(assembly.Name.PublicKeyToken??Array.Empty<byte>()).ToLowerInvariant()},references=assembly.MainModule.AssemblyReferences.Select(r=>new{name=r.Name,version=r.Version.ToString(),publicKeyToken=Convert.ToHexString(r.PublicKeyToken??Array.Empty<byte>()).ToLowerInvariant()}).ToArray(),types=types.Select(t=>new {
    fullName=t.FullName,baseType=t.BaseType?.FullName,attributes=(int)t.Attributes,access=(t.Attributes&TypeAttributes.VisibilityMask).ToString(),genericArity=t.GenericParameters.Count,interfaces=t.Interfaces.Select(i=>i.InterfaceType.FullName).OrderBy(x=>x,StringComparer.Ordinal).ToArray(),visible=t.IsPublic||t.IsNestedPublic||t.IsNestedFamily||t.IsNestedFamilyOrAssembly,serializable=t.IsSerializable,isEnum=t.IsEnum,isAbstract=t.IsAbstract,isSealed=t.IsSealed,compilerGenerated=Generated(t),
    fields=t.Fields.Select(f=>new{name=f.Name,type=f.FieldType.FullName,isStatic=f.IsStatic,api=f.IsPublic||f.IsFamily||f.IsFamilyOrAssembly,access=(f.Attributes&FieldAttributes.FieldAccessMask).ToString(),readOnly=f.IsInitOnly,literal=f.IsLiteral,serialized=!f.IsStatic&&!f.IsLiteral&&!f.IsInitOnly&&!f.IsNotSerialized&&(f.IsPublic||Attr(f,"UnityEngine.SerializeField")||Attr(f,"UnityEngine.SerializeReference")),constant=f.HasConstant?Convert.ToString(f.Constant,System.Globalization.CultureInfo.InvariantCulture):null}).ToArray(),
    methods=t.Methods.Select(m=>new{signature=m.FullName,api=m.IsPublic||m.IsFamily||m.IsFamilyOrAssembly,access=(m.Attributes&MethodAttributes.MemberAccessMask).ToString(),isStatic=m.IsStatic,isVirtual=m.IsVirtual,isFinal=m.IsFinal,hasBody=m.HasBody,stub=Trivial(m),instructionCount=m.HasBody?m.Body.Instructions.Count:0}).ToArray()
   }).ToArray()};
  }
 }
 static int Main(string[] args){try{if(args.Length!=2)throw new Exception("Expected input and output");var result=Inspect(args[0]);var json=JsonSerializer.Serialize(result);if(json.Length>32*1024*1024)throw new Exception("Metadata output limit exceeded");using(var s=new FileStream(args[1],FileMode.CreateNew,FileAccess.Write)){using(var w=new StreamWriter(s))w.Write(json);}return 0;}catch(Exception e){Console.Error.WriteLine(e.GetType().Name+": "+e.Message);return 1;}}
}
