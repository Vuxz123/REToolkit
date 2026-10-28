// Pure presentation data: this module also runs in the isolated browser renderer.
const LIMIT = Object.freeze({depth:6, rows:50, fields:40, nodes:1200, value:4096, text:12000, raw:65536});
const labels = Object.freeze({
  componentId:'Component ID',targetId:'Đích mapping',componentPlanId:'Kế hoạch component',migrationOperationId:'Migration đã tạo',observationId:'Quan sát Editor',origin:'Nguồn type',implementation:'Triển khai runtime',groupCount:'Nhóm component',targetCount:'Type ứng viên',samplesComplete:'Mẫu gồm toàn bộ instance',blockers:'Điểm chặn',from:'Binding hiện tại',to:'Binding đích',writable:'Cho phép rebind',observed:'Đã quan sát type',counts:'Số lượng theo trạng thái',
  id:'ID', name:'Tên', state:'Trạng thái', status:'Trạng thái', ok:'Thành công', valid:'Hợp lệ',
  error:'Lỗi', errors:'Lỗi', code:'Mã', message:'Thông báo', reason:'Lý do', notice:'Lưu ý',
  path:'Đường dẫn', file:'Tệp', files:'Tệp', storedResult:'Kết quả đầy đủ', source:'Mã nguồn',
  pseudocode:'Mã giả', assets:'Asset', nodes:'Node', edges:'Edge', missingReferences:'Tham chiếu thiếu',
  missingRefs:'Tham chiếu thiếu', coverage:'Độ phủ', compileReady:'Biên dịch',
  packageName:'Package Android',serial:'Thiết bị',applicationData:'Dữ liệu ứng dụng',scopes:'Phạm vi thu thập',access:'Quyền đọc',bundle:'Gói đã lưu',archive:'Archive',staging:'Thư mục staging',
  inputSelection:'Lựa chọn đầu vào',binaries:'Binary / ABI',binariesCount:'Số binary',metadataCount:'Số metadata',nextSteps:'Bước tiếp theo',selection:'Đầu vào đã chọn',steps:'Trạng thái các bước',extractedPath:'Thư mục giải nén',omittedBinaries:'Binary không hiển thị',omittedMetadata:'Metadata không hiển thị',omittedFields:'Trường không hiển thị',
  bindingsVerified:'Liên kết', behavior:'Gameplay', logic:'Logic', limitations:'Giới hạn',
  warnings:'Cảnh báo', version:'Phiên bản', runtimes:'Runtime', tools:'Công cụ',
  operationId:'ID thao tác', graphRevision:'Phiên bản graph', scriptId:'ID script',
  components:'Component', references:'Tham chiếu', children:'Đối tượng con',
  storedReceipt:'Receipt đã lưu', storedPlan:'Kế hoạch đã lưu', stagedProject:'Project staging',
  graphRefresh:'Cập nhật index',strategy:'Cách cập nhật',changedScripts:'Script thay đổi',databaseBytes:'Dung lượng database (byte)',copiedBytes:'Đã sao chép (byte)',elapsedMs:'Thời gian đã chạy (ms)',phase:'Giai đoạn',
  items:'Danh sách', kind:'Loại', guid:'GUID', storage:'Lưu trữ', authentication:'Xác thực',
  network:'Kết nối mạng', behaviorVerified:'Gameplay',
  compilation:'Kết quả biên dịch',scopeBindingsVerified:'Liên kết trong phạm vi',scope:'Phạm vi kiểm chứng',classification:'Phân loại script',traversal:'Tiến độ duyệt',requestedAssets:'Asset yêu cầu',completedAssets:'Asset đã kiểm tra đủ',pendingAssets:'Asset cần kiểm tra tiếp',skippedSubtrees:'Nhánh dữ liệu không chứa reference',stopReason:'Lý do dừng',objectPath:'Đối tượng',componentType:'Loại component',propertyPath:'Property đang duyệt',resumeOperationId:'Operation cần tiếp tục',resume:'Tiếp tục kiểm chứng',
});
const stateLabels=Object.freeze({indexed:'Đã lập graph',blocked:'Thiếu điều kiện',prepared:'Đã chuẩn bị',
  unverified:'Chưa xác minh',failed:'Chưa đạt',succeeded:'Hoàn tất',ready:'Sẵn sàng'});
const bookkeepingKeys=new Set(['kind','schemaVersion','settingsSha256','payloadSha256','receiptSha256',
  'requestSha256','graphSha256','revision','graphRevision']);

export function fieldLabel(key) {
  if (Object.hasOwn(labels,key)) return labels[key];
  const words=String(key).replace(/([A-Z]+)([A-Z][a-z])/g,'$1 $2')
    .replace(/([a-z0-9])([A-Z])/g,'$1 $2').replace(/[_-]+/g,' ');
  return clip(words.charAt(0).toUpperCase()+words.slice(1),LIMIT.value);
}

function clip(value,limit=LIMIT.value) {
  const text=String(value),notice='… [đã lược bớt do giới hạn]';
  if(text.length<=limit)return text;
  let end=limit-notice.length;
  if(/[\uD800-\uDBFF]/.test(text[end-1]??''))end--;
  return text.slice(0,end)+notice;
}
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const scalar=value=>value===null||typeof value!=='object';
const scalarText=value=>value===null?'Không có dữ liệu':value===undefined?'Chưa có dữ liệu':typeof value==='boolean'?(value?'Có':'Không'):String(value);
function displayValue(key,value) {
  if((key==='state'||key==='status')&&typeof value==='string'&&Object.hasOwn(stateLabels,value))return stateLabels[value];
  if(key==='network'&&value==='not-sent')return 'Chưa gửi yêu cầu';
  if((key==='behavior'||key==='logic')&&value==='unverified')return 'Chưa xác minh';
  if(['compileReady','bindingsVerified','behaviorVerified'].includes(key)&&value===false)return 'Chưa xác minh';
  return scalarText(value);
}
const isPath=(key,value)=>typeof value==='string'&&(/^(?:[a-z]:[\\/]|[\\/]|\.\.?[\\/])/i.test(value)||/(?:path|file|directory|folder|^stored|project$|^input$|^output$)/i.test(key));
const largeText=(key,value)=>typeof value==='string'&&(/source|pseudocode|content|decompil/i.test(key)||value.includes('\n'));

function nodeBuilder() {
  let remaining=LIMIT.nodes;
  function build(value,key='',depth=0) {
    if(!remaining)return null;
    remaining--;
    if(scalar(value)){
      if(largeText(key,value))return {kind:'text',text:clip(value,LIMIT.text)};
      const result={kind:isPath(key,value)?'path':'value',value:clip(displayValue(key,value))};
      if(typeof value==='boolean')result.tone=value?'good':'warn';
      return result;
    }
    if(depth>=LIMIT.depth)return {kind:'text',text:'Đã lược dữ liệu sâu hơn do giới hạn độ sâu (6). Xem JSON hoặc kết quả đầy đủ.'};
    if(Array.isArray(value)){
      if(value.length&&value.slice(0,LIMIT.rows).every(record)){
        const keys=[];
        for(const row of value.slice(0,LIMIT.rows))for(const field of Object.keys(row).slice(0,LIMIT.fields)){
          if(scalar(row[field])&&!keys.includes(field)&&keys.length<6)keys.push(field);
        }
        const columns=keys.map(key=>({key:clip(key),label:fieldLabel(key)})),rows=[];
        for(const row of value.slice(0,LIMIT.rows)){
          // Reserve enough space for every visible cell and a details container.
          if(remaining<keys.length+1)break;
          const cells=keys.map(key=>build(row[key],key,depth+1));
          const extra=Object.fromEntries(Object.entries(row).filter(([key])=>!keys.includes(key)));
          const details=Object.keys(extra).length?build(extra,'',depth+1):null;
          rows.push({cells,details});
        }
        return {kind:'table',columns,rows,omitted:value.length-rows.length};
      }
      const items=[];
      for(const item of value.slice(0,LIMIT.rows)){
        if(!remaining)break;
        items.push(build(item,key,depth+1));
      }
      return {kind:'list',items,omitted:value.length-items.length};
    }
    const entries=Object.entries(value),fields=[];
    for(const [key,item] of entries.slice(0,LIMIT.fields)){
      if(!remaining)break;
      fields.push({key:clip(key),label:fieldLabel(key),node:build(item,key,depth+1)});
    }
    return {kind:'object',fields,omitted:entries.length-fields.length};
  }
  return {build,available:()=>remaining>0};
}

function evidenceMetric(label,value) {
  if(value===true||value==='verified'||value==='succeeded')return {label,value:'Đã xác minh',tone:'good'};
  return {label,value:'Chưa xác minh',tone:'warn'};
}

function metricsFor(job,result) {
  const metrics=[];
  // Summary authority stops at the DTO's root fields. Serialized asset fields,
  // source records and table rows can use the same names as toolkit diagnostics.
  const progress=['running','queued'].includes(job.state)&&record(job.validationProgress)?job.validationProgress:null;
  const coverage=progress??(record(result.coverage)?result.coverage:result);
  const countKeys=[['Asset',['assets','assetCount','totalAssets']],['Node',['nodes','nodeCount','totalNodes']],['Edge',['edges','edgeCount','totalEdges']],['Tham chiếu thiếu',['missingReferences','missingRefs','missingReferenceCount']]];
  for(const [label,keys] of countKeys){
    const key=keys.find(key=>typeof coverage[key]==='number');
    if(key)metrics.push({label,value:String(coverage[key]),...(label==='Tham chiếu thiếu'&&coverage[key]>0?{tone:'warn'}:{})});
  }
  if((result.kind==='retoolkit-unity-validation'||progress)&&Number.isSafeInteger(coverage.requestedAssets)&&coverage.requestedAssets>=0&&Number.isSafeInteger(coverage.completedAssets)&&coverage.completedAssets>=0&&coverage.completedAssets<=coverage.requestedAssets)metrics.push({label:'Độ phủ binding',value:coverage.completedAssets+'/'+coverage.requestedAssets,tone:coverage.completedAssets===coverage.requestedAssets&&!progress?'good':'warn'});
  const evidenceKeys=[['Biên dịch',['compileReady']],['Liên kết',['bindingsVerified']],['Gameplay',['behavior','gameplay','behaviorVerified']]];
  const reconstruction=/reconstruct|migration|libraries/.test(job.operation??'')||['compileReady','bindingsVerified','behavior','compilation'].some(key=>Object.hasOwn(result,key));
  if(reconstruction)for(const [label,keys]of evidenceKeys){
    if(label==='Biên dịch'&&result.compilation?.state==='failed')metrics.push({label,value:'Chưa đạt',tone:'bad'});
    else if(label==='Biên dịch'&&result.compilation?.state==='succeeded')metrics.push(evidenceMetric(label,true));
    else{
      const key=keys.find(key=>Object.hasOwn(result,key));
      metrics.push(evidenceMetric(label,result[key]));
    }
  }
  return metrics;
}

function statusFor(job,result,metrics) {
  const qualification=result.kind==='retoolkit-data-baseline-qualification'?result:result.result?.kind==='retoolkit-data-baseline-qualification'?result.result:null;
  if(qualification&&job.state==='succeeded')return {tone:'info',label:'Baseline gốc đủ bằng chứng dữ liệu',description:'Đã xác minh dữ liệu và script của các ScriptableObject đã chọn từ bằng chứng gốc. Receipt partial cũ được giữ nguyên; định danh source toàn project và gameplay cần kiểm chứng riêng.'};
  const component=result.kind==='retoolkit-component-operation'?result:result.result?.kind==='retoolkit-component-operation'?result.result:null;
  if(component&&job.state==='succeeded')return {tone:component.state==='blocked'?'warn':'info',label:component.state==='blocked'?'Mapping còn bị chặn':'Đã ghi nhận mapping component',description:'Xem type, thư viện và các điểm chặn. Áp dụng chỉ tạo staging; binding cần quan sát lại bằng Unity, gameplay có kiểm chứng riêng.'};
  const dataContract=result.kind==='retoolkit-data-contract'?result:result.result?.kind==='retoolkit-data-contract'?result.result:null;
  if(dataContract){
    const result=dataContract;
    if(result.command==='capture')return {tone:'info',label:result.dataCaptureComplete?'Đã lưu baseline':'Baseline chưa đầy đủ',description:'Baseline ghi dữ liệu tham chiếu; chưa xác minh bản tái dựng hay gameplay. Xem coverage và lý do còn thiếu.'};
    return {tone:result.dataPreserved===true?'good':'warn',label:result.dataPreserved===true?'Dữ liệu khớp baseline':'Dữ liệu chưa được xác minh',description:'Đối chiếu trên các ScriptableObject đã chọn. Runtime initialization và gameplay có kết quả riêng.'};
  }
  if(result.kind==='retoolkit-reconstruction-run'&&result.complete!==true)return {tone:'warn',label:'Mục tiêu chưa hoàn tất',description:result.state==='waiting-agent'?'Đang chờ agent nhận lại việc. Gửi thông báo thành công chưa xác nhận agent đã tiếp tục.':'Checklist gameplay còn bước chưa được xác minh; xem bước tiếp theo hoặc lý do bị chặn.'};
  const interrupted=[job.error,result.error].some(error=>error?.code==='DESKTOP_INTERRUPTED');
  const uncertainSession=job.operation==='agent.session'&&job.state==='unverified';
  if(job.state==='unknown'||interrupted||uncertainSession||job.state!=='failed'&&[result.state,result.status].includes('unknown'))return {tone:'warn',label:'Cần kiểm tra kết quả',description:job.operation==='agent.session'?'Trạng thái phiên chưa xác minh. Kiểm tra bản ghi terminal và tiến trình; chưa có bằng chứng MCP đã kết nối hoặc Agent đã tiếp tục.':'Kết quả tác vụ chưa xác định. Kiểm tra operation, ownership và receipt đã lưu trước khi thực hiện thêm thao tác ghi hoặc thử lại.'};
  if(job.state==='running')return {tone:'info',label:'Đang chạy',description:'Lệnh đang xử lý. Nhật ký bên dưới hiển thị tiến độ hiện có.'};
  if(job.state==='queued')return {tone:'info',label:'Đang chờ',description:'Lệnh đang chờ đến lượt xử lý.'};
  const errorRecords=[job.error,result.error,...(Array.isArray(result.errors)?result.errors.slice(0,LIMIT.rows):[])];
  const missingKey=errorRecords.some(error=>/jev_auth_missing|jev_auth_invalid/i.test(String(error?.code??'')));
  const error=job.error||result.error||(Array.isArray(result.errors)&&result.errors.length)||
    ['failed','error'].includes(result.state)||['failed','error'].includes(result.status)||result.compilation?.state==='failed';
  if(job.state==='failed'||error||typeof job.exitCode==='number'&&job.exitCode!==0)return {tone:'bad',label:'Có lỗi',description:missingKey?'Jev chưa có API key hợp lệ. Kiểm tra cấu hình Jev và API key của phiên hiện tại.':'Lệnh hoặc kết quả nghiệp vụ báo lỗi. Xem chi tiết lỗi và nhật ký bên dưới.'};
  if(result.kind==='retoolkit-unity-validation'&&result.state==='partial')return {tone:'warn',label:'Kiểm chứng chưa đủ',description:'Kết quả biên dịch được ghi riêng. Một số asset hoặc binding chưa được kiểm tra đủ; xem điểm dừng và Operation để tiếp tục trên cùng source.'};
  if(result.kind==='retoolkit-unity-validation'&&result.scope?.kind==='assets')return {tone:'warn',label:'Kiểm chứng theo phạm vi',description:'Kết quả chỉ áp dụng cho phạm vi asset đã chọn. Độ phủ này chưa xác nhận binding toàn project.'};
  if(result.state==='partial')return {tone:'warn',label:'Thu thập chưa đủ',description:'Đã lưu phần có thể truy cập. Xem phạm vi dữ liệu bị từ chối hoặc còn thiếu trước khi coi đây là bản capture đầy đủ.'};
  if(result.state==='needs-input')return {tone:'warn',label:'Cần bổ sung đầu vào',description:'Project đã được giữ lại. Xem vấn đề chọn binary/metadata và khả năng cần thêm split APK hoặc OBB trước khi phân tích.'};
  if(['workspace.add','workspace.scan','workspace.flow','project.inputs.recover'].includes(job.operation)&&['needs-selection','missing-input'].includes(result.inputSelection?.state))return {tone:'warn',label:'Chờ chọn đầu vào',description:'Giải nén đã hoàn tất. Chọn binary / ABI và metadata trong project; nếu còn thiếu tệp, kiểm tra split APK hoặc loại build.'};
  const blocked=[result.state,result.status].some(value=>['blocked','missing','invalid','unavailable','changed','not-installed','not-configured'].includes(value));
  if(blocked)return {tone:'warn',label:'Bị chặn',description:'Kết quả báo thiếu điều kiện hoặc cần xử lý thêm. Lệnh kết thúc chưa có nghĩa là tác vụ đã đạt yêu cầu.'};
  const notOk=['ok','valid','success'].some(key=>result[key]===false);
  if(notOk)return {tone:'warn',label:'Chưa đạt',description:'Kết quả có kiểm tra chưa đạt. Xem dữ liệu chi tiết bên dưới.'};
  if(job.state==='unverified'||job.storedResult||metrics.some(metric=>metric.tone==='warn')||[result.state,result.status].includes('unverified'))return {tone:'warn',label:'Cần xác minh',description:'Lệnh đã dừng hoặc có kết quả xem trước; bằng chứng hiện tại chưa xác minh đầy đủ biên dịch, liên kết và gameplay.'};
  if(job.state==='succeeded')return {tone:'good',label:'Lệnh hoàn tất',description:'Lệnh đã kết thúc thành công. Trạng thái này không xác nhận game phục hồi hoặc gameplay đã đúng.'};
  return {tone:'info',label:'Chưa có kết quả',description:'Chưa có trạng thái hoàn tất để đánh giá.'};
}

function rawJSON(job) {
  const serialized=JSON.stringify(job,null,2)??'null',encoder=new TextEncoder();
  if(encoder.encode(serialized).length<=LIMIT.raw)return serialized;
  const notice='JSON vượt giới hạn 64 KiB; đã lược bớt. Xem tệp kết quả đầy đủ nếu có.';
  // A valid JSON wrapper makes the truncation explicit and retains a literal envelope preview.
  let start=0,end=Math.min(serialized.length,LIMIT.raw),best='';
  while(start<=end){
    const middle=Math.floor((start+end)/2),candidate=JSON.stringify({notice,preview:serialized.slice(0,middle)},null,2);
    if(encoder.encode(candidate).length<=LIMIT.raw){best=candidate;start=middle+1;}else end=middle-1;
  }
  return best;
}

export function buildResultModel(job,{operationLabel}={}) {
  const envelope=job??{},result=record(envelope.result)?envelope.result:{},metrics=metricsFor(envelope,result),builder=nodeBuilder(),sections=[];
  const add=(title,value,key='')=>{if(builder.available())sections.push({title,node:builder.build(value,key)});};
  // Put saved-result and error evidence before potentially large nested result tables.
  if(envelope.storedResult){
    add('Kết quả đầy đủ',envelope.storedResult,'storedResult');
    add('Bản xem trước','Đây là bản xem trước có giới hạn. Sao chép đường dẫn kết quả đầy đủ để xem toàn bộ dữ liệu.','notice');
  }
  if(envelope.error)add('Lỗi của lệnh',envelope.error);
  const dataContract=result.kind==='retoolkit-data-contract'?result:result.result?.kind==='retoolkit-data-contract'?result.result:null;
  if(dataContract){
    add('Dữ liệu ScriptableObject',{state:dataContract.state,baselineId:dataContract.baselineId,dataCaptureComplete:dataContract.dataCaptureComplete,dataPreserved:dataContract.dataPreserved,schemaCompatible:dataContract.schemaCompatible,coverage:dataContract.coverage,reason:dataContract.reason,runtimeInitialized:dataContract.runtimeInitialized,gameplay:dataContract.gameplay,storedRaw:dataContract.storedRaw,storedData:dataContract.storedData});
    if(dataContract.differences?.length)add('Khác biệt dữ liệu',dataContract.differences);
  }
  const component=result.kind==='retoolkit-component-operation'?result:result.result?.kind==='retoolkit-component-operation'?result.result:null;
  if(component){add('Mapping component',{state:component.state,total:component.total,groupCount:component.groupCount,targetCount:component.targetCount,counts:component.counts,implementation:component.implementation,bindingsVerified:component.bindingsVerified,gameplay:component.gameplay,storedRecord:component.storedRecord});if(component.blockers?.length)add('Điểm chặn mapping',component.blockers);}
  if(result.kind==='retoolkit-reconstruction-run')add('Tiến trình tái dựng gameplay',{goal:result.goal,state:result.state,complete:result.complete,agentResumed:result.agentResumed,nextStep:result.nextStep,waiting:result.waiting,continuation:result.continuation,steps:result.steps});
  if(Array.isArray(envelope.phaseMetrics??result.phaseMetrics))add('Thời gian từng pha',envelope.phaseMetrics??result.phaseMetrics);
  if(result.error)add('Lỗi kết quả',result.error);
  if(Array.isArray(result.errors)&&result.errors.length)add('Các lỗi kết quả',result.errors);
  if(['running','queued'].includes(envelope.state)&&record(envelope.validationProgress))add('Tiến độ Unity',envelope.validationProgress);
  if(['running','queued'].includes(envelope.state)&&record(envelope.assetProgress))add('Tiến độ source / index',envelope.assetProgress);
  if(['running','queued'].includes(envelope.state)&&record(envelope.recoveryProgress))add('Tiến độ bản tái dựng',envelope.recoveryProgress);
  if(result.kind==='retoolkit-unity-validation'&&record(result.resume))add('Tiếp tục kiểm chứng',{...result.resume,hướngDẫn:'Chọn Kiểm chứng bằng Unity, điền Operation cần tiếp tục. Chỉ tái sử dụng kết quả còn khớp source, Editor và helper.'});
  if(Object.hasOwn(envelope,'result')){
    const isTechnical=([key,value])=>bookkeepingKeys.has(key)&&scalar(value);
    const technical=Object.fromEntries(Object.entries(result).filter(isTechnical));
    // Reserve the small technical section before a large inspector exhausts its node budget.
    const technicalNode=Object.keys(technical).length&&builder.available()?builder.build(technical):null;
    const visible=record(envelope.result)?Object.fromEntries(Object.entries(result).filter(entry=>!isTechnical(entry))):envelope.result;
    if(result.kind==='retoolkit-workspace-preview'&&/^(workspace\.(init|status|add|scan|flow|dump|import|analyze)|project\.inputs\.(select|recover))$/.test(envelope.operation??'')){
      const {steps,inputSelection,nextSteps,...summary}=visible;
      if(Array.isArray(nextSteps)&&nextSteps.length)add('Bước tiếp theo',nextSteps);
      if(record(inputSelection)){
        const {binaries,metadata}=inputSelection;
        if(Array.isArray(binaries)&&binaries.length)add('Binary / ABI',binaries);
        if(Array.isArray(metadata)&&metadata.length)add('Metadata',metadata);
      }
      if(record(steps))add('Trạng thái các bước',Object.entries(steps).map(([step,value])=>({step,...(record(value)?value:{state:String(value)})})));
      add('Workspace',summary);
      if(record(inputSelection)){const {binaries,metadata,...inputSummary}=inputSelection;add('Lựa chọn đầu vào',inputSummary);}
    }else add('Kết quả',visible);
    if(technicalNode)sections.push({title:'Thông tin kỹ thuật',node:technicalNode,collapsed:true});
  }
  if(!sections.length)add('Kết quả','Chưa có dữ liệu kết quả.');
  const meta=[];
  for(const [key,label,value]of [
    ['id','ID lệnh',envelope.id],['operation','Thao tác',envelope.operation],['name','Workspace',envelope.payload?.name],
    ['createdAt','Tạo lúc',envelope.createdAt],['startedAt','Bắt đầu',envelope.startedAt],['completedAt','Kết thúc',envelope.completedAt],['exitCode','Mã thoát',envelope.exitCode],
  ])if(value!==undefined&&value!==null)meta.push({label,value:clip(scalarText(value))});
  const logParts=[envelope.progress,envelope.diagnostics,envelope.logs].filter(value=>value!==undefined&&value!==null)
    .map(value=>Array.isArray(value)?value.map(item=>typeof item==='string'?item:JSON.stringify(item)).join('\n'):typeof value==='string'?value:JSON.stringify(value));
  return {
    title:clip(operationLabel??fieldLabel(envelope.operation??'Kết quả')),
    status:statusFor(envelope,result,metrics),meta,metrics,sections,
    logs:clip(logParts.join('\n'),LIMIT.text),raw:rawJSON(envelope),
  };
}
