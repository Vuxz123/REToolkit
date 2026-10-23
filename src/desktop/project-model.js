// Presentation decisions only: no filesystem, engines, mutations or inferred receipts.
export const workflowRoutes=[['home','Tất cả project'],['overview','Tổng quan'],['reconstruction','Tái dựng'],['resources','Tài nguyên'],['verification','Kiểm chứng'],['activity','Tác vụ & bằng chứng'],['libraries','Kho thư viện'],['settings','Cài đặt'],['advanced','Công cụ nâng cao']];
export const activeState=state=>['running','queued'].includes(state);
// Session-routed AssetRipper commands validate the existing owner in the backend.
// Only known conflicting operations are gated here; this is not authorization.
const conflictingOperations=new Set(['workspace.prepare','workspace.init','workspace.dump','workspace.import','workspace.analyze','workspace.open','workspace.add','workspace.scan','workspace.flow','project.inputs.select','project.inputs.recover','project.inputs.resolve','adb.capture','assets.start','reconstruct.apply','reconstruct.validate','migration.observe','migration.apply']);
export const conflictsWithOwnership=(model,operation)=>Boolean(conflictingOperations.has(operation)&&(model.lock?.workspaceBusy||model.project?.state==='busy'));
export const stateLabel=state=>({running:'Đang chạy',queued:'Đang chờ',succeeded:'Lệnh hoàn tất',failed:'Có lỗi',unknown:'Cần kiểm tra kết quả',unverified:'Chưa xác minh',partial:'Một phần',stale:'Cần kiểm tra lại',ready:'Sẵn sàng',pending:'Chưa chạy','not-started':'Chưa bắt đầu',blocked:'Cần xử lý',available:'Không có khóa',busy:'Đang có chủ sở hữu',exited:'Đã thoát','terminal-opened':'Đã mở terminal'}[state]??state??'Chưa xác minh');
export function mergeProjectJobs(desktop,name,activity={}){
 if(!name)return [];
 const workers=activity.name===name?(activity.jobs??[]).filter(job=>(job.name??job.payload?.name)===name).map(job=>({...job,key:job.key??`${job.source??'durable'}:${job.id??job.jobId}`,id:job.id??job.jobId,payload:{name}})):[];
 const linked=new Map(workers.filter(row=>row.source==='durable'&&row.jobId).map(row=>[row.jobId,row]));
 const rows=[...workers];
 for(const job of desktop??[]){
  if(job.payload?.name!==name)continue;
  const target=linked.get(job.result?.jobId);
  if(target){target.desktopId=job.id;continue;}
  rows.push({...job,key:'desktop:'+job.id,source:'desktop',name});
 }
 return rows.sort((a,b)=>String(b.createdAt??b.startedAt??'').localeCompare(String(a.createdAt??a.startedAt??'')));
}
export function buildProjectModel(snapshot,name,{activity,preparation,inputs}={}){
 const project=snapshot.workspaces?.find(item=>item.name===name),jobs=mergeProjectJobs(snapshot.jobs,name,activity);
 const current=Boolean(project)&&preparation?.name===name&&preparation.freshness==='current';
 const dimensions=[['native','Phân tích native','nativeAnalysis'],['source','Toàn vẹn source',null],['compilation','Biên dịch Unity','compilation'],['bindings','Liên kết asset–script','bindings'],['gameplay','Gameplay',null],['visual','Hình ảnh gốc',null]];
 const verification=dimensions.map(([id,label,key])=>{
  const entry=current&&key?(preparation.readiness?.[key]??preparation.readiness?.[{compilation:'unityCompile',bindings:'unityBindings'}[key]]):null;
  const observed=entry?.state??entry;
  return {id,label,state:['ready','succeeded','verified'].includes(observed)?'verified':observed==='partial'?'partial':'unverified',scope:entry?.scope??null,coverage:entry?.coverage??null};
 });
 const uncertain=jobs.find(job=>['unknown','unverified'].includes(job.state)),running=jobs.filter(job=>activeState(job.state));
 let next={action:'observe',title:'Đọc trạng thái project',description:'Chưa có quan sát hiện tại. Làm mới để xác định bước tiếp theo.',label:'Làm mới trạng thái',tone:'info'};
 if(uncertain)next={action:'activity',jobKey:uncertain.key,title:'Cần kiểm tra kết quả tác vụ trước',description:'Kết quả chưa rõ. Đọc operation và receipt trước khi thực hiện thêm thao tác ghi.',label:'Kiểm tra tác vụ',tone:'warn'};
 else if(running.length)next={action:'activity',jobKey:running[0].key,title:'Project đang có tác vụ xử lý',description:'Theo dõi giai đoạn, thời gian và bằng chứng. Cậu vẫn có thể duyệt project trong lúc chờ.',label:'Xem tiến trình',tone:'info'};
 else if(activity?.name===name&&activity.lock?.workspaceBusy||project?.state==='busy')next={action:'activity',title:'Workspace đang có chủ sở hữu',description:'Kiểm tra ownership trước khi chạy thao tác ghi. Đọc kết quả và duyệt project vẫn có thể tiếp tục.',label:'Xem ownership và tác vụ',tone:'warn'};
 else if(inputs?.name===name&&inputs.state!=='selected')next={action:'inputs',title:'Cần hoàn thiện đầu vào build',description:'Kiểm tra binary / metadata hoặc dữ liệu split còn thiếu; không cần giải nén lại chỉ để chọn ABI.',label:'Kiểm tra đầu vào',tone:'warn'};
 else if(current&&preparation.state==='succeeded')next={action:'agent',title:'Tiếp tục tái dựng cùng Agent',description:'Chuẩn bị đã có bằng chứng hiện tại. Mở Agent với context và checklist của project.',label:'Mở AI Agent',tone:'good'};
 else if(preparation?.name===name&&preparation.freshness&&preparation.freshness!=='current')next={action:'freshness',title:'Kiểm tra lại bằng chứng đã lưu',description:'Kết quả lịch sử chưa xác nhận mức sẵn sàng hiện tại. Kiểm tra đầu vào và receipt trước khi dùng lại.',label:'Kiểm tra bằng chứng',tone:'warn'};
 else if(inputs?.name===name&&inputs.state==='selected')next={action:'prepare',title:'Chuẩn bị project cho tái dựng',description:'Chọn chính sách chuẩn bị và tiếp tục các bước còn thiếu. Dữ liệu gốc được giữ lại.',label:'Xem chuẩn bị project',tone:'info'};
 return {name:project?.name??'',project,jobs,running:running.length,next,verification,currentEvidence:current,evidenceCheckedAt:current?preparation.freshnessCheckedAt??null:null,lock:activity?.name===name?activity.lock:null,warnings:activity?.name===name?activity.warnings??[]:[],inputs:inputs?.name===name?inputs:null,preparation:preparation?.name===name?preparation:null};
}
