import {buildResultModel} from './result-model.js';

/** Render untrusted CLI observations as DOM text only. No target HTML or URLs. */
export function createResultView(host,{copyText=text=>window.retk.copyText(text)}={}){
 const document=host.ownerDocument;let currentId,open=new Map();
 const element=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(className)node.className=className;return node;};
 function disclosure(title,key,defaultOpen=false,className=''){
  const node=element('details',undefined,className);node.dataset.resultDisclosure=key;node.open=open.has(key)?open.get(key):defaultOpen;node.append(element('summary',title));return node;
 }
 function omitted(count){return element('p',`Còn ${count} mục ngoài bản xem trước. Xem JSON hoặc tệp kết quả đầy đủ.`, 'result-preview-note');}
 function copyButton(text,label='Sao chép',className=''){
  const button=element('button',label,'result-copy '+className);button.type='button';button.addEventListener('click',async()=>{button.disabled=true;try{await copyText(text);feedback.textContent='Đã sao chép.';}catch{feedback.textContent='Không sao chép được. Cậu có thể chọn văn bản để sao chép thủ công.';}finally{button.disabled=false;}});return button;
 }
 let feedback;
 function renderNode(node,key){
  if(!node||typeof node!=='object')return element('span','—','result-value');
  if(node.kind==='text')return element('pre',node.text,'result-text');
  if(node.kind==='path'){const row=element('div',undefined,'result-path');row.append(element('code',node.value),copyButton(node.value));return row;}
  if(node.kind==='value'){const value=element('span',node.value,'result-value');if(node.tone)value.dataset.tone=node.tone;return value;}
  if(node.kind==='object'){
   const list=element('dl',undefined,'result-facts');for(const [index,field]of node.fields.entries()){
    const row=element('div',undefined,'result-field'),value=element('dd');row.append(element('dt',field.label));
    if(['table','list'].includes(field.node?.kind)){
     row.classList.add('result-field-wide');value.append(renderNode(field.node,`${key}.${index}`));
    }else if(field.node?.kind==='object'){
     const nested=disclosure('Xem chi tiết',`${key}.${field.key??index}`,false,'result-nested');nested.append(renderNode(field.node,`${key}.${index}`));value.append(nested);
    }else value.append(renderNode(field.node,`${key}.${index}`));row.append(value);list.append(row);
   }if(node.omitted)list.append(omitted(node.omitted));return list;
  }
  if(node.kind==='list'){
   const list=element('ul',undefined,'result-list');for(const [index,item]of node.items.entries()){const row=element('li');row.append(renderNode(item,`${key}.${index}`));list.append(row);}if(node.omitted)list.append(omitted(node.omitted));return list;
  }
  if(node.kind==='table'){
   const container=element('div',undefined,'result-table-container'),scroll=element('div',undefined,'result-table-scroll'),table=element('table'),head=element('thead'),header=element('tr'),body=element('tbody'),hasDetails=node.rows.some(row=>row.details);
   for(const column of node.columns)header.append(element('th',column.label));if(hasDetails)header.append(element('th','Chi tiết'));head.append(header);table.append(head,body);
   for(const [index,row]of node.rows.entries()){
    const tr=element('tr');for(const [column,cell]of row.cells.entries()){const td=element('td');td.append(renderNode(cell,`${key}.${index}.${column}`));tr.append(td);}
    if(hasDetails){const td=element('td');if(row.details){const details=disclosure('Xem thêm',`${key}.row.${index}`,false,'result-row-details');details.append(renderNode(row.details,`${key}.row.${index}`));td.append(details);}else td.append(element('span','—'));tr.append(td);}body.append(tr);
   }scroll.append(table);container.append(scroll);if(node.omitted)container.append(omitted(node.omitted));return container;
  }
  return element('span','Không có dữ liệu để hiển thị.','muted');
 }
 return {render(job,options={}){
  const id=job.id??job.operation??'result';open=id===currentId?new Map([...host.querySelectorAll('details[data-result-disclosure]')].map(node=>[node.dataset.resultDisclosure,node.open])):new Map();currentId=id;
  const model=buildResultModel(job,options);host.replaceChildren();host.className='result-view';host.setAttribute('aria-busy',String(job.state==='running'));
  const hero=element('div',undefined,'result-hero');hero.dataset.tone=model.status.tone;
  const icon=element('span',model.status.tone==='good'?'✓':model.status.tone==='bad'?'!':model.status.tone==='warn'?'!':'•','result-status-icon');icon.setAttribute('aria-hidden','true');
  const heading=element('div',undefined,'result-hero-heading'),title=element('h3',model.title),status=element('span',model.status.label,'result-status');heading.append(title,status,element('p',model.status.description));hero.append(icon,heading);host.append(hero);
  if(model.meta.length){const meta=element('div',undefined,'result-meta');for(const item of model.meta){const pair=element('span');pair.append(element('span',item.label+': '),element('strong',item.value));meta.append(pair);}host.append(meta);}
  if(model.metrics.length){const metrics=element('div',undefined,'result-metrics');for(const item of model.metrics){const card=element('div',undefined,'result-metric');if(item.tone)card.dataset.tone=item.tone;card.append(element('span',item.label),element('strong',item.value));metrics.append(card);}host.append(metrics);}
  const content=element('div',undefined,'result-sections');for(const [index,section]of model.sections.entries()){const group=element('section',undefined,'result-section');if(section.collapsed){const details=disclosure(section.title,`section.${index}`,false,'result-technical');details.append(renderNode(section.node,`section.${index}`));group.append(details);}else group.append(element('h4',section.title),renderNode(section.node,`section.${index}`));content.append(group);}host.append(content);
  if(model.logs){const logs=disclosure('Nhật ký thực thi','logs',['running','failed'].includes(job.state),'result-logs');logs.append(element('pre',model.logs));host.append(logs);}
  const raw=disclosure('Chi tiết kỹ thuật · JSON','raw',false,'result-raw'),toolbar=element('div',undefined,'result-raw-toolbar');toolbar.append(element('span','Dữ liệu gốc để tra cứu hoặc gửi cho Agent.','muted'),copyButton(model.raw,'Sao chép JSON','result-copy-json'));raw.append(toolbar,element('pre',model.raw));host.append(raw);
  feedback=element('p','','result-copy-feedback');feedback.setAttribute('role','status');host.append(feedback);return model;
 }};
}
