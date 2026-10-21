import net from 'node:net';
import {randomUUID} from 'node:crypto';
import {BridgeError,createFrameDecoder,requestFrame} from './protocol.js';
export async function sendRequest(binding,method,params={}, {timeoutMs=60000}={}) {
 if(!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>300000)throw new BridgeError('invalid_argument','Timeout must be 1..300000ms');
 if(binding.host!=='127.0.0.1'||!Number.isInteger(binding.port)||binding.port<1||binding.port>65535)throw new BridgeError('protocol_mismatch','Invalid owned endpoint');
 const id=randomUUID(),frame=requestFrame(binding,id,method,params);
 return new Promise((resolve,reject)=>{
  const socket=net.createConnection({host:binding.host,port:binding.port});let done=false;
  const finish=(error,result)=>{if(done)return;done=true;clearTimeout(timer);socket.destroy();error?reject(error):resolve(result);};
  const timer=setTimeout(()=>finish(new BridgeError('request_timeout','Request deadline exceeded; inspect session job status before retrying')),timeoutMs);
  const decode=createFrameDecoder(response=>{
   if(response.version!==1||response.runId!==binding.runId||response.id!==id||typeof response.ok!=='boolean')return finish(new BridgeError('protocol_mismatch','Asset response identity mismatch'));
   finish(response.ok?null:new BridgeError(response.error?.code??'asset_error',response.error?.message??'Asset operation failed'),response.result);
  });
  socket.on('connect',()=>socket.write(frame));socket.on('data',data=>{try{decode(data);}catch(error){finish(error);}});
  socket.on('error',()=>finish(new BridgeError('connection_lost','Owned asset bridge connection failed')));
  socket.on('close',()=>finish(new BridgeError('connection_lost','Owned asset bridge closed before response')));
 });
}
