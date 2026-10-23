// Candidate paths come from the main process. The renderer never scans files.
export function createInputSelectionView({onJob,onMessage}){
 const make=(tag,text,className)=>{const node=document.createElement(tag);if(text)node.textContent=text;if(className)node.className=className;return node;};
 const panel=make('section',null,'card input-selection');panel.id='input-selection';panel.hidden=true;
 const title=make('h2','Binary / ABI và metadata'),status=make('p',null,'muted');status.id='input-selection-status';status.setAttribute('role','status');
 const source=make('p',null,'muted input-source'),fields=make('div',null,'input-choice-grid');source.id='input-selection-source';
 const binaryLabel=make('label','Binary / ABI'),binary=make('select');binary.id='input-binary';binaryLabel.append(binary);
 const metadataLabel=make('label','Metadata'),metadata=make('select');metadata.id='input-metadata';metadataLabel.append(metadata);fields.append(binaryLabel,metadataLabel);
 const actions=make('div',null,'input-choice-actions'),apply=make('button','Chọn và tiếp tục','primary'),automatic=make('button','Tự chọn ABI ưu tiên','secondary'),recover=make('button','Đưa dữ liệu về 01_Extracted','secondary');apply.id='select-inputs';automatic.id='resolve-inputs';recover.id='recover-inputs';recover.hidden=true;actions.append(apply,automatic,recover);
 panel.append(title,status,source,fields,actions);document.querySelector('#project-agent').before(panel);
 let name='',view=null,generation=0,loading=false,submitting=false,busy=false,visible=true,signature='';
 function enabled(){apply.disabled=busy||loading||submitting||!view?.canSelect||!binary.value||!metadata.value||!view?.revision;automatic.disabled=busy||loading||submitting||!view?.recommendation?.resolvable||view?.state==='selected'||!view?.canSelect;recover.disabled=busy||loading||submitting||!view?.canRecover;binary.disabled=metadata.disabled=busy||loading||submitting;}
 function options(select,items,label,chosen){select.replaceChildren();const placeholder=make('option',items.length?'Chọn '+label:'Chưa tìm thấy '+label);placeholder.value='';select.append(placeholder);for(const item of items){const option=make('option',(item.abi&&item.abi!=='unknown'?item.abi+' · ':'')+item.path);option.value=item.path;select.append(option);}if(items.some(item=>item.path===chosen))select.value=chosen;else if(items.length===1)select.value=items[0].path;}
 function render(){
  if(!view)return;options(binary,view.binaries??[],'binary / ABI',view.selection?.binary);options(metadata,view.metadata??[],'metadata',view.selection?.metadata);
  source.textContent=view.source?.location==='canonical'?'Dữ liệu đã giải nén: '+view.source.path:view.source?.path?'Dữ liệu giải nén đang chờ hoàn tất: '+view.source.path:'';
  recover.hidden=!view.canRecover;
  status.textContent=view.state==='selected'?'Đã chọn đầu vào. Đổi lựa chọn sẽ làm mất hiệu lực các bước phân tích phụ thuộc.':view.state==='missing-input'?'Giải nén đã hoàn tất nhưng chưa có đủ binary và metadata. Kiểm tra split APK/OBB hoặc loại build trước khi tiếp tục.':view.state==='needs-selection'?'Giải nén đã hoàn tất. Chọn binary / ABI và metadata bên dưới để tiếp tục; chưa cần giải nén lại.':'Chưa có dữ liệu giải nén để chọn. Nhập APK hoặc chọn thư mục build trước.';
  if(view.state==='selected'&&view.selection?.reason==='abi-preference')status.textContent+=' Đã tự chọn '+view.selection.abi+' theo thứ tự ARM64 → ARMv7 → x86_64 → x86.';
  else if(view.state==='needs-selection'&&view.recommendation?.resolvable)status.textContent+=' Có thể tự chọn '+view.recommendation.abi+' theo chính sách ưu tiên.';
  enabled();
 }
 async function reload(){
  if(!name)return;const selected=name,token=++generation;loading=true;status.textContent='Đang đọc danh sách binary / ABI và metadata…';enabled();
  try{const next=await window.retk.inputs(selected);if(token!==generation||name!==selected)return;view=next;loading=false;render();}
  catch(error){if(token!==generation||name!==selected)return;view=null;loading=false;status.textContent=String(error.message).slice(0,2000);enabled();}
 }
 async function submit(operation){
  if(!name||!view||!view.revision)return;const selected=name,payload=operation==='project.inputs.resolve'?{name:selected}:{name:selected,revision:view.revision};if(operation==='project.inputs.select'){payload.binary=binary.value;payload.metadata=metadata.value;}
  submitting=true;enabled();try{const job=await window.retk.run(operation,payload);onMessage(operation==='project.inputs.select'?'Đang áp dụng lựa chọn đầu vào…':operation==='project.inputs.resolve'?'Đang tự chọn ABI theo chính sách ưu tiên…':'Đang khôi phục dữ liệu về 01_Extracted…');onJob(job);}catch(error){if(name===selected)status.textContent=error.message;}finally{submitting=false;enabled();}
 }
 binary.addEventListener('change',enabled);metadata.addEventListener('change',enabled);apply.addEventListener('click',()=>submit('project.inputs.select'));automatic.addEventListener('click',()=>submit('project.inputs.resolve'));recover.addEventListener('click',()=>submit('project.inputs.recover'));
 return {reload,update(snapshot,selected,{visible:show=true}={}){
  visible=show;const valid=snapshot.workspaces.some(item=>item.name===selected&&item.state!=='invalid')?selected:'';
  busy=snapshot.jobs.some(job=>['queued','running'].includes(job.state));panel.hidden=!valid||!visible;
  const last=snapshot.jobs.filter(job=>job.payload?.name===valid&&['succeeded','failed','unverified'].includes(job.state)).at(-1),next=valid+'|'+(last?.id??'')+'|'+(last?.state??'');
  if(name!==valid){generation++;view=null;name=valid;binary.replaceChildren();metadata.replaceChildren();source.textContent='';}
  if(signature!==next){signature=next;if(name)reload();}enabled();
 }};
}
