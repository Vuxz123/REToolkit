export class Element extends EventTarget{
 constructor(tag,registry){super();this.tag=tag;this.registry=registry;this.children=[];this.dataset={};this.value='';this.text='';this.checked=false;this.disabled=false;this.attributes={};}
 set id(value){this._id=value;this.registry?.set('#'+value,this);}get id(){return this._id;}
 set textContent(value){this.text=String(value);this.children=[];}get textContent(){return this.text+this.children.map(node=>node.textContent).join('');}
 append(...nodes){this.children.push(...nodes);}after(node){this.registry?.set('#'+node.id,node);}before(node){this.registry?.set('#'+node.id,node);}
 replaceChildren(...nodes){this.text='';this.children=nodes;}setAttribute(key,value){this.attributes[key]=value;}
 get options(){return this.children;}get selectedOptions(){return this.children.filter(node=>node.value===this.value);}
 querySelectorAll(tag){return this.children.flatMap(child=>[...(child.tag===tag?[child]:[]),...child.querySelectorAll(tag)]);}
 click(){if(!this.disabled)this.dispatchEvent(new Event('click'));}focus(){}showModal(){this.open=true;}close(){this.open=false;}
}
export function fakeDocument(){const registry=new Map();for(const id of ['#workspace','#overview','.workspace-content'])registry.set(id,new Element('div',registry));return {hidden:false,registry,body:new Element('body',registry),createElement:tag=>new Element(tag,registry),querySelector:selector=>registry.get(selector)};}
export const flush=async()=>{for(let n=0;n<16;n++)await Promise.resolve();};
