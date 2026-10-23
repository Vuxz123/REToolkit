// Keep the meaning of a workspace result while omitting its large file manifests.
const operations=new Set(['workspace.init','workspace.status','workspace.add','workspace.scan','workspace.flow','workspace.dump','workspace.import','workspace.analyze','project.inputs.select','project.inputs.recover']);
const stepNames=['extract','scan','dump','import','analyze','symbols','assetripper','notes'];
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fits=(value,limit)=>typeof value==='string'&&Buffer.byteLength(value)<=limit;
const size=value=>Buffer.byteLength(JSON.stringify(value));
const MAX_BYTES=8192;

export function workspaceResultPreview(job){
 const project=job.result;
 if(!operations.has(job.operation)||!record(project)||!record(project.steps)||!fits(project.name,64))return null;
 const omittedFields=[],preview={kind:'retoolkit-workspace-preview',schemaVersion:1,name:project.name,steps:{},omittedFields};
 const copy=(target,key,value,limit=512)=>{
  if(value===null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))target[key]=value;
  else if(fits(value,limit))target[key]=value;
  else if(value!==undefined)omittedFields.push(key);
 };
 for(const key of ['platform','extractedPath','nativeBinary','metadata','il2cppDumperOutput','ghidraProjectDir','ghidraProgramName','reconstructedSourceDir'])copy(preview,key,project[key]);
 for(const name of stepNames){
  const step=project.steps[name];if(!record(step))continue;
  const summary={};copy(summary,'state',step.state,32);copy(summary,'runId',step.runId,64);copy(summary,'completedAt',step.completedAt,64);
  if(step.state==='failed'||step.state==='unknown')copy(summary,'error',step.error,256);
  preview.steps[name]=summary;
 }
 const input=project.inputSelection;
 if(record(input)){
  const result={binaries:[],metadata:[],selection:{}};preview.inputSelection=result;
  for(const key of ['state','revision','canSelect','canRecover'])copy(result,key,input[key],128);
  if(record(input.source)){result.source={};copy(result.source,'location',input.source.location,32);copy(result.source,'path',input.source.path);}
  if(record(input.selection))for(const key of ['binary','metadata','abi','reason','policy'])copy(result.selection,key,input.selection[key]);
  for(const key of ['binaries','metadata']){
   const items=Array.isArray(input[key])?input[key]:[];result[key+'Count']=items.length;
   for(const item of items.slice(0,8)){
    if(!record(item)||!fits(item.path,512))continue;
    const entry={path:item.path};if(key==='binaries'&&fits(item.abi,64))entry.abi=item.abi;result[key].push(entry);
   }
   result['omitted'+(key==='binaries'?'Binaries':'Metadata')]=items.length-result[key].length;
  }
  preview.nextSteps=result.state==='needs-selection'?['Trong mục Binary / ABI và metadata của project, chọn một ABI rồi bấm Chọn và tiếp tục. Không cần nhập APK lại.']:result.state==='missing-input'?['Kiểm tra binary/metadata còn thiếu và nguồn split APK/OBB hoặc loại build trước khi tiếp tục.']:result.state==='selected'?['Đầu vào đã được chọn; kiểm tra riêng các bước dump, import, phân tích và symbol trước khi sử dụng kết quả.']:['Kiểm tra nguồn đầu vào và trạng thái project trước khi tiếp tục.'];
  // Very long names or many candidates must not expand the IPC envelope.
  while(size(preview)>MAX_BYTES&&(result.binaries.length||result.metadata.length)){
   const key=result.binaries.length>=result.metadata.length?'binaries':'metadata';result[key].pop();result['omitted'+(key==='binaries'?'Binaries':'Metadata')]++;
  }
 }
 if(size(preview)>MAX_BYTES)for(const step of Object.values(preview.steps))delete step.error;
 if(size(preview)>MAX_BYTES)for(const key of ['reconstructedSourceDir','ghidraProjectDir','il2cppDumperOutput','nativeBinary','metadata']){if(Object.hasOwn(preview,key)){delete preview[key];omittedFields.push(key);}if(size(preview)<=MAX_BYTES)break;}
 if(omittedFields.length)preview.omittedFields=[...new Set(omittedFields)];else delete preview.omittedFields;
 return preview;
}
