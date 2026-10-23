import {fingerprint} from '../state.js';

/** Internal authoritative-file guard; never accepted from an MCP/request DTO.
 * A valid captured dump must remain valid across async parsing and publication. */
export function initializationContext({changes,dump,expectedBinding,readDump,readBinding}){
 if(!changes?.some(change=>change.mode==='initialization'))return {};
 const fail=()=>{throw Object.assign(Error('Initialization native inputs, Program or verified dump changed; create a fresh plan against current evidence'),{code:'stale_graph'});};
 if(dump?.verified!==true||typeof dump.sha256!=='string'||!expectedBinding)fail();
 const expectedHash=dump.sha256,buildHash=fingerprint(dump.build),bindingHash=fingerprint(expectedBinding);
 return {dump,assertContextCurrent:()=>{
  const binding=readBinding();if(fingerprint(binding)!==bindingHash)fail();
  const current=readDump();
  if(current?.verified!==true||current.sha256!==expectedHash||fingerprint(current.build)!==buildHash)fail();
 }};
}
