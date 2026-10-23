// Deliberately a declaration scanner, not a C# compiler. Uncertain declarations
// cannot authorize source replacement. Bodies and literals are opaque tokens.
function tokenize(source) {
 const out=[]; let i=0;
 while(i<source.length) {
  const c=source[i];
  if(/\s/.test(c)){i++;continue;}
  if(source.startsWith('//',i)){i=source.indexOf('\n',i);if(i<0)break;continue;}
  if(source.startsWith('/*',i)){const end=source.indexOf('*/',i+2);if(end<0)throw Error('Unterminated comment');i=end+2;continue;}
  if(c==='#'||source.startsWith('"""',i)||source.startsWith('$',i))throw Error('Conditional compilation, raw and interpolated strings require compiler validation');
  if(c==='"'||c==="'"||(c==='@'&&source[i+1]==='"')) {
   const verb=c==='@', quote=verb?'"':c; i+=verb?2:1; let closed=false;
   while(i<source.length){if(source[i]===quote){if(verb&&source[i+1]===quote){i+=2;continue;}i++;closed=true;break;}if(!verb&&source[i]==='\\')i+=2;else i++;}
   if(!closed)throw Error('Unterminated literal');out.push('$literal');continue;
  }
  const word=/^@?[\p{L}_][\p{L}\p{N}_]*/u.exec(source.slice(i));
  if(word){out.push(word[0]);i+=word[0].length;continue;}
  const num=/^\d+(?:\.\d+)?[\w]*/.exec(source.slice(i));if(num){out.push(num[0]);i+=num[0].length;continue;}
  out.push(c);i++;if(out.length>200000)throw Error('C# token limit exceeded');
 }
 return out;
}
const modifiers=new Set(['public','private','protected','internal','static','readonly','const','volatile','new','virtual','override','abstract','sealed','partial','extern','async']);
/** Conservative prerequisite for compiler-only source classification. This is
 * never evidence of a type identity: directives and unsupported lexical forms
 * stay unknown, and a class with a base/constraint or split declaration still
 * requires reflected identity. Comments and literals cannot hide its header. */
export function sourceExcludesComponentInheritance(source){
 try{
  const tokens=tokenize(source);if(tokens.includes('partial')||tokens.some(token=>token.includes('\\')||/\p{Cf}/u.test(token)))return false;
  for(let i=0;i<tokens.length;i++)if(tokens[i]==='class'){
   let body=false;
   for(let j=i+1;j<tokens.length;j++){
    if(tokens[j]===':'||tokens[j]===';'||tokens[j]==='}')return false;
    if(tokens[j]==='{'){body=true;break;}
   }
   if(!body)return false;
  }
  return true;
 }catch{return false;}
}
function joinType(t){return t.join('');}
export function parseCSharp(source,{fileName}={}) {
 const types=[],limitations=['Declaration scan only; compilation and behavior are unverified.'];
 try {
  if(typeof source!=='string'||Buffer.byteLength(source)>1024*1024)throw Error('C# source limit exceeded');
  const ts=tokenize(source); let p=0;
  function balanced(open,close){if(ts[p]!==open)throw Error(`Expected ${open}`);let depth=0;do{const t=ts[p++];if(t===open)depth++;if(t===close)depth--;if(p>ts.length)throw Error(`Unclosed ${open}`);}while(depth);}
  function attrs(){const a=[];while(ts[p]==='['){const start=p;balanced('[',']');a.push(ts.slice(start,p).join(''));}return a.join(' ');}
  function member(type) {
   const attributes=attrs(),mods=[];while(modifiers.has(ts[p]))mods.push(ts[p++]);
   if(['class','struct','interface','enum','record','event','delegate','unsafe','fixed'].includes(ts[p]))throw Error('Unsupported nested type or member declaration');
   const head=[]; let angle=0, brackets=0;
   while(p<ts.length) {const t=ts[p];if(angle===0&&brackets===0&&[';','=','{','('].includes(t))break;if(t==='<')angle++;if(t==='>')angle--;if(t==='[')brackets++;if(t===']')brackets--;if(t==='}'||angle<0||brackets<0)throw Error('Malformed member');head.push(t);p++;}
   if(!head.length)throw Error('Unsupported member declaration');
   if(ts[p]==='('){balanced('(',')');if(ts[p]===':'){while(p<ts.length&&ts[p]!=='{')p++;}if(ts[p]==='{')balanced('{','}');else if(ts[p]==='='&&ts[p+1]==='>'){while(p<ts.length&&ts[p]!==';')p++;p++;}else if(ts[p]===';')p++;else throw Error('Unsupported method declaration');return;}
   if(ts[p]==='{'){if(attributes.includes(':')||/\bSerialize(?:Field|Reference)\b/.test(attributes))throw Error('Serialized auto-properties require compiler validation');balanced('{','}');if(ts[p]==='='){while(p<ts.length&&ts[p]!==';')p++;p++;}return;}
   if(head.includes(',')||head.includes('=>')||head.length<2||!/^@?[\p{L}_][\p{L}\p{N}_]*$/u.test(head.at(-1)))throw Error('Unsupported field declaration');
   const name=head.at(-1).replace(/^@/,''),fieldType=joinType(head.slice(0,-1));
   if(!/^[\p{L}\p{N}_@.<>?,\[\]]+$/u.test(fieldType))throw Error('Unsupported field type');
   if(attributes.includes(':'))throw Error('Targeted field attributes require compiler validation');
   const knownAttributes=new Set(['SerializeField','SerializeReference','NonSerialized','HideInInspector','Header','Tooltip','Range','Min','Space','Multiline','TextArea','ColorUsage','Delayed','Token','FieldOffset']);
   for(const match of attributes.matchAll(/(?:\[|,)(?:(?:UnityEngine|System)\.)?([A-Za-z_]\w*)/g))if(!knownAttributes.has(match[1]))throw Error('Unknown field attributes require compiler validation');
   if(ts[p]==='=') {if(ts[p+1]==='>')throw Error('Expression properties require compiler validation');p++;let par=0,brace=0,bracket=0;while(p<ts.length){const t=ts[p];if(t===';'&&!par&&!brace&&!bracket)break;if(t===','&&!par&&!brace&&!bracket)throw Error('Multiple field declarations require compiler validation');if(t==='(')par++;if(t===')')par--;if(t==='{')brace++;if(t==='}')brace--;if(t==='[')bracket++;if(t===']')bracket--;if(par<0||brace<0||bracket<0)throw Error('Malformed field initializer');p++;}}
   if(ts[p++]!==';')throw Error('Unterminated field');
   const serialized=!mods.some(m=>['static','const','readonly'].includes(m))&&!/\bNonSerialized\b/.test(attributes)&&(mods.includes('public')||/\bSerialize(?:Field|Reference)\b/.test(attributes));
   type.fields.push({name,type:fieldType,serialized});
  }
  function scope(namespace='',closing=false) {
   while(p<ts.length&&ts[p]!=='}') {
    attrs();while(modifiers.has(ts[p])){if(ts[p]==='partial')throw Error('Partial types require complete compiler validation');p++;}
    if(ts[p]==='using'){while(p<ts.length&&ts[p]!==';')p++;if(ts[p++]!==';')throw Error('Malformed using');continue;}
    if(ts[p]==='namespace'){p++;const name=[];while(p<ts.length&&!['{',';'].includes(ts[p]))name.push(ts[p++]);if(!name.length)throw Error('Missing namespace');const next=[namespace,name.join('')].filter(Boolean).join('.');if(ts[p++]===';'){namespace=next;continue;}scope(next,true);continue;}
    const kind=ts[p++];if(!['class','struct','interface','enum'].includes(kind))throw Error('Unsupported type declaration');
    const name=ts[p++];if(!/^@?[\p{L}_][\p{L}\p{N}_]*$/u.test(name??''))throw Error('Missing type name');
    if(ts[p]==='<')throw Error('Generic type declarations require compiler validation');
    const baseTypes=[];if(ts[p]===':'){p++;let b=[];while(p<ts.length&&ts[p]!=='{'){if(ts[p]===','){baseTypes.push(joinType(b));b=[];}else b.push(ts[p]);p++;}if(b.length)baseTypes.push(joinType(b));}
    if(ts[p++]!=='{')throw Error('Missing type body');
    const type={name:name.replace(/^@/,''),namespace,fullName:[namespace,name.replace(/^@/,'')].filter(Boolean).join('.'),kind,baseTypes,fields:[]};types.push(type);
    if(kind==='enum'||kind==='interface')throw Error('Enum and interface declarations require compiler validation');
    while(p<ts.length&&ts[p]!=='}')member(type);
    if(ts[p++]!=='}')throw Error('Unclosed type body');if(ts[p]===';')p++;
   }
   if(closing&&ts[p++]!=='}')throw Error('Unclosed namespace');
  }
  scope();if(p!==ts.length)throw Error('Unexpected closing brace');if(!types.length)throw Error('No supported type declarations');
  return {supported:true,types,limitations};
 } catch(error) {return {supported:false,reason:error.message,types,limitations:[...limitations,error.message]};}
}
