import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { BridgeError,createFrameDecoder,requestFrame,VERSION } from './protocol.js';

export async function connectClient(binding,{timeoutMs=5000}={}) {
  if(binding.host!=='127.0.0.1'||!Number.isInteger(binding.port)||binding.port<1||binding.port>65535) throw new BridgeError('protocol_mismatch','Invalid loopback endpoint');
  const socket=net.createConnection({host:binding.host,port:binding.port});
  socket.setNoDelay(true);
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{socket.destroy();reject(new BridgeError('connection_timeout','Bridge handshake connection timed out'));},timeoutMs);
    const failed=error=>{clearTimeout(timer);reject(new BridgeError('session_not_running','Bridge connection failed',{cause:error}));};
    socket.once('error',failed); socket.once('connect',()=>{clearTimeout(timer);socket.removeListener('error',failed);resolve();});
  });
  const pending=new Map(); let closed=false;
  const fail=error=>{
    closed=true; for(const item of pending.values()) {clearTimeout(item.timer);item.reject(error);} pending.clear(); socket.destroy();
  };
  const decode=createFrameDecoder(response=>{
    if(response.version!==VERSION||response.runId!==binding.runId||typeof response.id!=='string'||typeof response.ok!=='boolean') {
      fail(new BridgeError('protocol_mismatch','Bridge response binding mismatch')); return;
    }
    const item=pending.get(response.id);
    if(!item) {fail(new BridgeError('protocol_mismatch','Unexpected bridge response ID'));return;}
    pending.delete(response.id); clearTimeout(item.timer);
    if(response.ok) item.resolve(response);
    else item.reject(new BridgeError(response.error?.code??'bridge_error',response.error?.message??'Bridge operation failed',
      {runId:response.runId,requestId:response.id,details:response.error}));
  });
  socket.on('data',data=>{try {decode(data);} catch(error) {fail(error);}});
  socket.on('error',()=>fail(new BridgeError('connection_lost','Bridge connection lost; mutation result may require reconciliation')));
  socket.on('close',()=>fail(new BridgeError('connection_lost','Bridge closed before response; do not replay mutations with a new operation ID')));
  return {
    request(method,params={}, {timeoutMs=60000}={}) {
      if(closed) return Promise.reject(new BridgeError('connection_lost','Bridge connection is closed'));
      if(!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>300000) return Promise.reject(new BridgeError('invalid_argument','Request timeout must be 1..300000ms'));
      const id=randomUUID(); let frame;
      try {frame=requestFrame(binding,id,method,params);} catch(error) {return Promise.reject(error);}
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>fail(new BridgeError('request_timeout','Request deadline exceeded; inspect operation status before retrying a write',{requestId:id})),timeoutMs);
        pending.set(id,{resolve,reject,timer}); socket.write(frame);
      });
    },
    close() {fail(new BridgeError('connection_closed','Client closed'));},
  };
}
