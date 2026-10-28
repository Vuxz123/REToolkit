// Renderer-only controls. The typed bridge validates every request again.
const make=(tag,text,css)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(css)node.className=css;return node;};
const enums={storage:['json','sqlite'],profile:['native','reconstruction'],symbols:['plan','apply','skip'],addressMode:['rva','va'],policy:['prefer-arm64','manual'],autoPull:['true','false'],includeData:['true','false'],baselineValidation:['true','false']};
const uuidKeys=new Set(['operation','resumeOperationId','resumeRunId','runId','artifactId','artifactRevision','baselineId','observationId','stageOperationId','reuseVerificationId']);
const uuid=value=>/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const labels={name:'Project',input:'Build hoặc thư mục',binary:'Binary',metadata:'Metadata',revision:'Revision đầu vào',operation:'Operation đã lưu · UUID',resumeOperationId:'Operation kiểm chứng cần tiếp tục · UUID',runId:'Lần chuẩn bị · UUID',resumeRunId:'Lần chuẩn bị cần tiếp tục · UUID',assetIds:'Phạm vi asset · mỗi dòng một ID hoặc mảng JSON',profile:'Mục tiêu',symbols:'Chính sách symbol',addressMode:'Địa chỉ symbol',autoPull:'Cho phép pull Android khi khớp build',includeData:'Kèm dữ liệu có quyền đọc',baselineValidation:'Chạy Unity baseline',storage:'Lưu graph',graphMaxMiB:'Ngân sách graph · 128, 256 hoặc 512 MiB',requirements:'Yêu cầu thư viện · file JSON',request:'Request JSON',observations:'Quan sát Unity JSON',receipt:'Receipt JSON',plan:'Kế hoạch JSON',out:'Đầu ra mới',packageName:'Package Android',serial:'Serial thiết bị · chọn rõ thiết bị',adb:'Đường dẫn adb.exe',components:'Phạm vi component · file JSON',id:'Asset / object ID',lock:'Runtime lock JSON',bundle:'Handoff bundle',questions:'Câu hỏi Jev JSON'};
Object.assign(labels,{artifactId:'Bản tái dựng · artifact UUID',artifactRevision:'Revision bản tái dựng · UUID',method:'Bước thực hiện',paramsFile:'Tham số của bước · file JSON'});
const noPicker=new Set(['name','binary','metadata','revision','id','graphMaxMiB','storage','packageName','serial','assetIds','componentIds','mappings','method',...uuidKeys,...Object.keys(enums)]);
Object.assign(labels,{componentIds:'Component cần quan sát · mỗi dòng một object ID',mappings:'Mapping tường minh · mảng JSON componentId / targetId',observationId:'Quan sát component · UUID',stageOperationId:'Migration đã apply · UUID'});
// Only compatible saved evidence may become a suggestion. Desktop queue IDs are
// not durable operation IDs, and a UUID alone does not attest compatible scope.
function compatible(target,key,source){
 if(key==='observationId')return source==='components.observe';
 if(key==='stageOperationId')return source==='components.apply';
 if(key==='runId'||key==='resumeRunId')return source==='workspace.prepare';
 if(key==='resumeOperationId')return source==='reconstruct.validate';
 const allowed={
  'components.apply':['components.plan'],
  'components.verify':['components.plan'],
  'components.report':['components.scan','components.observe','components.plan'],
  'reconstruct.apply':['reconstruct.plan'],
  'reconstruct.verify':['reconstruct.plan','reconstruct.apply'],
  'reconstruct.validation':['reconstruct.plan','reconstruct.apply'],
  'libraries.import':['libraries.plan'],
  'libraries.verify':['libraries.plan','libraries.import'],
  'visual.report':['visual.compare'],
 };
 return (allowed[target]??[]).includes(source);
}
export function createOperationForm({host,choose,getProject,getOperations,getActivity=()=>undefined,onSubmit,onMessage=()=>{}}){
 let operationId='',project='',generation=0,fields={},lists={};
 const currentProject=()=>{const value=getProject();return typeof value==='string'?value:value?.name??'';};
 const operation=()=>(getOperations()??[]).find(item=>item.id===operationId);
 function suggestions(){
  const value=getActivity(),rows=Array.isArray(value)?value:value?.jobs??[];
  for(const [key,list]of Object.entries(lists)){
   list.replaceChildren();const seen=new Set();
   for(const row of rows){
    const bound=row.name??row.project??row.payload?.name;
    const source=row.operation??row.operationIdType??row.kind;
    if(!project||bound!==project||!compatible(operationId,key,source))continue;
    const candidate=key==='runId'||key==='resumeRunId'?row.runId??row.result?.runId??row.preparationProgress?.runId:row.operationId??row.result?.operationId;
    if(!uuid(candidate)||seen.has(candidate))continue;seen.add(candidate);
    const option=make('option',[row.label??source,row.state,candidate].filter(Boolean).join(' · '));option.value=candidate;list.append(option);
   }
  }
 }
 function render(){
  generation++;fields={};lists={};host.replaceChildren();const item=operation();if(!item)return;const choices={...enums,...item.choices};
  if(item.id==='adb.capture')host.append(make('p','Chọn rõ serial và package. Chỉ pull build khớp danh tính; kết quả nêu phần dữ liệu thiếu hoặc chưa xác minh.','muted'));
  for(const key of [...item.required,...(item.optional??[])]){
   const optional=(item.optional??[]).includes(key),label=make('label',(labels[key]??key)+(optional?' · tùy chọn':'')),row=make('div',undefined,'field-row'),input=make(choices[key]?'select':['assetIds','componentIds','mappings'].includes(key)?'textarea':'input');
   input.dataset.key=key;input.autocomplete='off';input.required=!optional;
   if(choices[key]){const empty=make('option','Chưa chọn');empty.value='';input.append(empty);for(const value of choices[key]){const option=make('option',value);option.value=value;input.append(option);}}
   if(key==='name'){input.value=project;input.readOnly=!['project.create','workspace.init'].includes(item.id);}
   if(key==='graphMaxMiB'){input.type='number';input.min='128';input.max='512';input.step='128';}
   if(uuidKeys.has(key)){input.placeholder='xxxxxxxx-xxxx-4xxx-xxxx-xxxxxxxxxxxx';const list=make('datalist');list.id='operation-form-'+key;input.setAttribute('list',list.id);lists[key]=list;row.append(list);}
   if(['assetIds','componentIds','mappings'].includes(key)){input.rows=4;input.placeholder=key==='componentIds'?'object:<GUID>:<fileID>':key==='mappings'?'[{"componentId":"object:...","targetId":"..."}]':'asset:1\nasset:2';}
   fields[key]=input;row.append(input);
   if(!noPicker.has(key)){
    const browse=make('button','Chọn','browse');browse.type='button';browse.addEventListener('click',async()=>{
     const token=generation,selectedProject=currentProject(),selectedOperation=operationId;
     const kind=key==='adb'?'input':key==='out'?'out':key==='input'&&['workspace.scan','libraries.roots'].includes(item.id)?'folder':key==='input'?'input':'request';
     try{const value=await choose(kind);if(value&&token===generation&&currentProject()===selectedProject&&operationId===selectedOperation)input.value=value;}
     catch(error){if(token===generation&&currentProject()===selectedProject&&operationId===selectedOperation)onMessage(error.message);}
    });row.append(browse);
   }
   label.append(row);host.append(label);
  }
  suggestions();
 }
 function read(){
  const item=operation();if(!item)throw new Error('Chọn tác vụ trước khi chạy.');
  const payload={},choices={...enums,...item.choices};
  for(const [key,input]of Object.entries(fields)){
   let value=key==='name'&&input.readOnly?currentProject():input.value.trim();
   if(!value){if(item.required.includes(key))throw new Error('Cần nhập '+(labels[key]??key)+'.');continue;}
   if(['assetIds','componentIds'].includes(key)){
    let ids;try{ids=value.startsWith('[')?JSON.parse(value):value.split(/\r?\n/).map(id=>id.trim()).filter(Boolean);}catch{throw new Error('assetIds phải là mảng JSON hợp lệ hoặc mỗi dòng một ID.');}
    if(!Array.isArray(ids)||!ids.length||ids.length>1000||ids.some(id=>typeof id!=='string'||!id||id.length>2048||/[\x00-\x1f]/.test(id)||id.startsWith('-'))||new Set(ids).size!==ids.length)throw new Error('assetIds cần 1–1000 ID riêng biệt hợp lệ.');
    value=JSON.stringify(ids);
   }
   if(uuidKeys.has(key)&&!uuid(value))throw new Error(key+' cần UUID v4 hợp lệ.');
   if(choices[key]&&!choices[key].includes(value))throw new Error('Giá trị '+key+' không hợp lệ.');
   if(key==='graphMaxMiB'&&!['128','256','512'].includes(value))throw new Error('graphMaxMiB phải là 128, 256 hoặc 512.');
   if(key==='name'&&(!/^[A-Za-z0-9_.-]{1,64}$/.test(value)||value.endsWith('.')||['.','..'].includes(value)||/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(value)))throw new Error('Tên project không hợp lệ.');
   if(key==='revision'&&!/^[a-f0-9]{64}$/.test(value))throw new Error('revision cần SHA-256 hợp lệ.');
   if(value.length>(['componentIds','mappings'].includes(key)?128*1024:4096)||/[\x00-\x1f]/.test(value)||value.startsWith('-'))throw new Error('Giá trị '+key+' không hợp lệ.');
   payload[key]=value;
  }
  return payload;
 }
 return {
  select(id){if(id!==operationId||currentProject()!==project){operationId=id;project=currentProject();render();}else suggestions();},
  refresh(){if(currentProject()!==project){project=currentProject();render();}else suggestions();},
  async submit(){const token=generation,selectedProject=currentProject(),selectedOperation=operationId;try{return await onSubmit(operationId,read());}catch(error){if(token===generation&&currentProject()===selectedProject&&operationId===selectedOperation)onMessage(error.message);return undefined;}},
  selected:()=>operationId,
 };
}
