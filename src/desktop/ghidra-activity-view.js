const labels={'workspace.import':'Import Ghidra','workspace.analyze':'Auto Analysis','workspace.symbols':'Áp symbol','ghidra.symbols.plan':'Lập kế hoạch symbol','ghidra.symbols.apply':'Áp symbol','ghidra.session.start':'Mở session Ghidra'};
const states={running:'Đang chạy',queued:'Đang chờ',succeeded:'Hoàn tất',failed:'Thất bại',unknown:'Chưa xác minh', 'awaiting-user':'Chờ thao tác',pending:'Chưa chạy',stale:'Cần kiểm tra lại'};
const elapsed=seconds=>seconds===null?'Chưa rõ':`${Math.floor(seconds/3600)} giờ ${Math.floor(seconds%3600/60)} phút ${seconds%60} giây`;
const local=value=>value?new Date(value).toLocaleString('vi-VN'):'Chưa có';
export function createGhidraActivityView(){
 const make=(tag,text,css)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(css)node.className=css;return node;};
 const panel=make('section',undefined,'card ghidra-activity');panel.id='ghidra-activity';panel.hidden=true;
 const heading=make('div',undefined,'card-heading'),title=make('h2','Ghidra · Tác vụ và tiến độ'),reload=make('button','Làm mới','secondary');reload.id='ghidra-activity-refresh';heading.append(title,reload);
 const status=make('p','Đang đọc trạng thái…','muted'),content=make('div');status.id='ghidra-activity-status';content.id='ghidra-activity-tasks';panel.append(heading,status,content);document.querySelector('.workspace-content').before(panel);
 let name='',visible=true,timer,generation=0;
 function render(report){
  const disclosure=new Map([...content.querySelectorAll('details')].map(node=>[node.dataset.id,node.open]));content.replaceChildren();
  if(report.state==='unavailable'){status.textContent='Chưa đọc được trạng thái Ghidra. Workspace có thể đang cập nhật; sẽ kiểm tra lại.';return;}
  const lock=report.lock,ownership=lock.ownerPid?` · PID chủ sở hữu ${lock.ownerPid} (${lock.ownerAlive===true?'còn sống':lock.ownerAlive===false?'đã thoát':'chưa xác minh'})`:'';
  status.textContent=(report.workspaceBusy?'Workspace đang bị khóa':'Workspace không có khóa')+ownership+'. Cập nhật: '+local(report.observedAt)+'.';
  if(lock.ambiguous)content.append(make('p','Có bản ghi khóa chưa xác minh được chủ sở hữu. Không thể suy ra workspace đã rảnh chỉ từ PID.','ghidra-warning'));
  if(lock.engines?.length)content.append(make('p','Worker Ghidra: '+lock.engines.map(engine=>`PID ${engine.pid} (${engine.alive===true?'còn sống':engine.alive===false?'đã thoát':'chưa xác minh'})`).join(', '),'muted'));
  if(!report.tasks.length)content.append(make('p','Chưa có tác vụ Ghidra được ghi nhận cho project này.','muted'));
  for(const task of report.tasks){
   const card=make('article',undefined,'ghidra-task'),head=make('div',undefined,'card-heading'),state=make('span',states[task.state]??'Chưa xác minh','badge');state.dataset.tone=task.state==='failed'?'bad':task.state==='succeeded'?'good':task.state==='unknown'?'warn':'info';
   head.append(make('strong',labels[task.operation]??task.operation),state);card.append(head);
   if(task.state==='running'){const progress=make('progress');progress.setAttribute('aria-label','Ghidra đang xử lý; chưa có tổng số công việc');card.append(progress);}
   const facts=make('p',`${task.source==='mcp'?'Agent / MCP':'Trạng thái project (CLI / GUI)'} · Thời gian: ${elapsed(task.elapsedSeconds)} · Bắt đầu: ${local(task.startedAt)}`,'muted');card.append(facts);
   if(task.ownerPid)card.append(make('p',`PID tác vụ: ${task.ownerPid} · ${task.ownerAlive===true?'Tiến trình còn sống':task.ownerAlive===false?'Tiến trình đã thoát':'Chưa xác minh tiến trình'}`,'muted'));
   if(task.stage)card.append(make('p','Giai đoạn đã ghi nhận: '+task.stage,'muted'));
   if(task.state==='unknown')card.append(make('p','Trạng thái lưu chưa xác minh với tiến trình còn sống. Cần kiểm tra tác vụ/receipt trước khi chạy lại.','ghidra-warning'));
   if(task.log){
    card.append(make('p',`Log cập nhật: ${local(task.log.updatedAt)} · ${(task.log.bytes/1024/1024).toFixed(2)} MiB${task.log.lastObservedAnalyzer?' · Analyzer xuất hiện cuối log: '+task.log.lastObservedAnalyzer:''}`,'muted'));
    if(task.log.quiet&&['running','unknown'].includes(task.state))card.append(make('p','Chưa có log mới trong ít nhất 5 phút. Tiến trình còn sống hoặc log im lặng chưa chứng minh có tiến triển hay bị treo.','ghidra-warning'));
    const details=make('details'),summary=make('summary','Nhật ký Ghidra gần nhất');details.dataset.id=task.id;details.open=disclosure.get(task.id)??task.state==='running';details.append(summary,make('pre',task.log.tail||'Log chưa có nội dung.'));card.append(details,make('code',task.log.path,'ghidra-path'));
   }else card.append(make('p','Chưa có log khả dụng cho tác vụ này.','muted'));
   if(task.completedAt)card.append(make('p',`Kết thúc: ${local(task.completedAt)}${task.exitCode!==undefined?' · Exit code: '+task.exitCode:''}${task.domainState?' · Kết quả: '+task.domainState:''}`,'muted'));
   if(task.resultReference)card.append(make('p','Kết quả đầy đủ: '+task.resultReference,'ghidra-path'));
   content.append(card);
  }
  if(report.jobsTruncated||report.tasksTruncated)content.append(make('p','Danh sách đã giới hạn để giữ GUI nhẹ. Dùng jobs_list / jobs_get để xem thêm tác vụ.','muted'));
  content.append(make('p','Chỉ theo dõi tác vụ do REToolkit ghi nhận; cửa sổ Ghidra mở riêng không tự xuất hiện ở đây. Trạng thái tiến trình và log không phải phần trăm hoàn thành.','muted'));
 }
 async function load(){
  clearTimeout(timer);if(!name||!visible)return;const token=++generation,selected=name;reload.disabled=true;
  try{const report=await window.retk.ghidraActivity(selected);if(token===generation&&name===selected)render(report);}
  catch{if(token===generation)status.textContent='Không đọc được tiến độ Ghidra; sẽ tự kiểm tra lại.';}
  finally{if(token===generation){reload.disabled=false;timer=setTimeout(load,document.hidden?10000:2000);}}
 }
 reload.addEventListener('click',load);
 return {reload:load,update(snapshot,selected,{visible:show=true}={}){
  const next=snapshot.workspaces.some(item=>item.name===selected&&item.state!=='invalid')?selected:'';
  const changed=next!==name||visible!==show;visible=show;name=next;panel.hidden=!name||!visible;
  if(changed){generation++;clearTimeout(timer);if(name&&visible){status.textContent='Đang đọc trạng thái Ghidra…';content.replaceChildren();load();}}
 }};
}
