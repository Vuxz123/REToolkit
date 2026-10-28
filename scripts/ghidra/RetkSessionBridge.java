// Persistent authenticated REToolkit owner. No arbitrary scripting endpoint.
// @category REToolkit
import ghidra.app.util.headless.HeadlessScript;
import com.google.gson.*;
import com.google.gson.stream.*;
import java.net.*;
import java.io.*;
import java.nio.*;
import java.nio.charset.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

public class RetkSessionBridge extends HeadlessScript {
    static final int REQUEST_LIMIT=65536,RESPONSE_LIMIT=2*1024*1024;
    static final Gson JSON=new GsonBuilder().disableHtmlEscaping().serializeNulls().create();
    final ArrayBlockingQueue<Job> queue=new ArrayBlockingQueue<>(32);
    final Set<Socket> sockets=ConcurrentHashMap.newKeySet();
    final Semaphore readers=new Semaphore(64);
    volatile boolean stopping=false,closed=false,attached=false;
    volatile long heartbeat=System.currentTimeMillis(),lastActivity=System.currentTimeMillis();
    volatile Socket control;
    JsonObject config; RetkProgramIdentity identity; RetkQueries queries; RetkMutations mutations; RetkSymbols symbols; ServerSocket server;
    static class Job {final JsonObject request;final CompletableFuture<JsonObject> answer=new CompletableFuture<>();Job(JsonObject r){request=r;}}
    @Override public void run()throws Exception {
        if(getScriptArgs().length!=1||currentProgram==null)throw new IllegalArgumentException("Expected private config and selected Program");
        config=JsonParser.parseString(Files.readString(Path.of(getScriptArgs()[0]))).getAsJsonObject();
        if(config.get("version").getAsInt()!=1||!Set.of("read","write").contains(config.get("mode").getAsString())||config.get("token").getAsString().length()<32)throw new IllegalArgumentException("Invalid bridge config");
        // GhidraScript.executeNormal starts FlatProgramAPI.start(); end(true) clears
        // its transactionID. Framework cleanup end(true) is then harmless.
        end(true);
        // An AnalysisWorker would add an outer transaction and prevent durable
        // saves. This headless owner instead suppresses change notifications;
        // typed operations flush their own decompiler cache. The Program closes
        // with this session, so no GUI plugin can observe these disabled events.
        currentProgram.flushEvents();currentProgram.setEventsEnabled(false);
        enableHeadlessAnalysis(false);
        if(currentProgram.getCurrentTransactionInfo()!=null)throw new IllegalStateException("Cannot serve under an outer Program transaction");
        identity=new RetkProgramIdentity(currentProgram,config);queries=new RetkQueries(currentProgram,monitor,config.get("runId").getAsString());symbols=new RetkSymbols(currentProgram,config,identity.identity,monitor);mutations=new RetkMutations(currentProgram,config,queries,symbols,monitor);
        server=new ServerSocket();server.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"),0));server.setSoTimeout(1000);
        try {
            JsonObject endpoint=new JsonObject();endpoint.addProperty("version",1);endpoint.addProperty("runId",config.get("runId").getAsString());endpoint.addProperty("host","127.0.0.1");endpoint.addProperty("port",server.getLocalPort());endpoint.add("programIdentity",identity.identity);RetkMutations.atomic(Path.of(config.get("endpointPath").getAsString()),endpoint);
            Thread accept=new Thread(()->acceptLoop(),"retk-loopback-accept");accept.setDaemon(true);accept.start();
            while(!stopping) {
                monitor.checkCancelled();long now=System.currentTimeMillis();
                if(now-heartbeat>15000||now-lastActivity>config.get("idleMs").getAsLong())stopping=true;
                Job job=queue.poll(250,TimeUnit.MILLISECONDS);if(job==null)continue;
                if(stopping){job.answer.complete(failure(job.request,RetkQueries.error("operation_cancelled","Session is draining; queued operation was not started")));break;}
                try{job.answer.complete(execute(job.request));}catch(Exception e){job.answer.complete(failure(job.request,e));}finally{lastActivity=System.currentTimeMillis();}
            }
        }finally{if(mutations.needsRecovery){currentProgram.setTemporary(true);setHeadlessContinuationOption(HeadlessContinuationOption.ABORT);}stopping=true;Job pending;while((pending=queue.poll())!=null)pending.answer.complete(failure(pending.request,RetkQueries.error("operation_cancelled","Session stopped before queued operation began")));closed=true;server.close();for(Socket socket:sockets)try{socket.close();}catch(IOException ignored){}queries.close();}
    }
    void acceptLoop(){while(!closed){try{Socket socket=server.accept();if(!readers.tryAcquire()){socket.close();continue;}sockets.add(socket);Thread reader=new Thread(()->readLoop(socket),"retk-frame-reader");reader.setDaemon(true);reader.start();}catch(SocketTimeoutException ignored){}catch(IOException e){if(!closed)stopping=true;}}}
    byte[] frame(InputStream in)throws Exception {ByteArrayOutputStream bytes=new ByteArrayOutputStream();for(;;){int b=in.read();if(b==-1){if(bytes.size()==0)return null;throw RetkQueries.error("invalid_frame","Incomplete NDJSON frame");}if(b==10)return bytes.toByteArray();if(bytes.size()>=REQUEST_LIMIT)throw RetkQueries.error("request_limit","Request exceeds 64 KiB");bytes.write(b);}}
    JsonElement parseValue(JsonReader reader,int depth)throws Exception {if(depth>32)throw RetkQueries.error("invalid_frame","JSON nesting exceeds 32 levels");switch(reader.peek()){case BEGIN_OBJECT:{JsonObject value=new JsonObject();reader.beginObject();while(reader.hasNext()){String key=reader.nextName();if(value.has(key))throw RetkQueries.error("invalid_frame","Duplicate JSON property");value.add(key,parseValue(reader,depth+1));}reader.endObject();return value;}case BEGIN_ARRAY:{JsonArray value=new JsonArray();reader.beginArray();while(reader.hasNext())value.add(parseValue(reader,depth+1));reader.endArray();return value;}case STRING:return new JsonPrimitive(reader.nextString());case NUMBER:return JsonParser.parseString(reader.nextString());case BOOLEAN:return new JsonPrimitive(reader.nextBoolean());case NULL:reader.nextNull();return JsonNull.INSTANCE;default:throw RetkQueries.error("invalid_frame","Invalid JSON value");}}
    JsonObject parseRequest(String text)throws Exception {try(JsonReader reader=new JsonReader(new StringReader(text))){reader.setStrictness(Strictness.STRICT);JsonElement value=parseValue(reader,0);if(reader.peek()!=JsonToken.END_DOCUMENT||!value.isJsonObject())throw RetkQueries.error("invalid_frame","Expected one JSON object");return value.getAsJsonObject();}}
    void authenticate(JsonObject r){if(!r.has("version")||!r.get("version").toString().equals("1"))throw RetkQueries.error("protocol_mismatch","Protocol version 1 required");String token=RetkQueries.str(r,"token","");if(!MessageDigest.isEqual(token.getBytes(StandardCharsets.UTF_8),config.get("token").getAsString().getBytes(StandardCharsets.UTF_8))||!RetkQueries.str(r,"runId","").equals(config.get("runId").getAsString()))throw RetkQueries.error("authentication_failed","Session credentials do not match");if(!r.has("id")||!r.get("id").isJsonPrimitive()||!r.get("id").getAsJsonPrimitive().isString()||r.get("id").getAsString().length()>128||!r.has("method")||!r.get("method").isJsonPrimitive()||!r.get("method").getAsJsonPrimitive().isString()||!r.has("params")||!r.get("params").isJsonObject())throw RetkQueries.error("invalid_request","Request id, method and object params required");}
    void readLoop(Socket socket){try{socket.setSoTimeout(15000);InputStream in=socket.getInputStream();OutputStream out=socket.getOutputStream();while(!closed){JsonObject request=null;boolean authenticated=false;try{byte[] bytes=frame(in);if(bytes==null)break;String text=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();request=parseRequest(text);authenticate(request);authenticated=true;String method=request.get("method").getAsString();JsonObject response;
                    if(method.equals("control.attach")){synchronized(this){if(control!=null&&control!=socket)throw RetkQueries.error("session_conflict","Supervisor control channel already attached");control=socket;attached=true;heartbeat=System.currentTimeMillis();}JsonObject state=status();state.add("verifiedReceipts",mutations.needsRecovery?new JsonArray():mutations.verifiedReceipts);response=success(request,state);}
                    else if(method.equals("control.heartbeat")){if(control!=socket)throw RetkQueries.error("authentication_failed","Heartbeat requires dedicated attached channel");heartbeat=System.currentTimeMillis();response=success(request,status());}
                    else if(method.equals("session.status"))response=success(request,status());
                    else if(method.equals("session.stop")){JsonObject state=status();state.addProperty("state","draining");response=success(request,state);}
                    else{if(stopping)throw RetkQueries.error("session_stopping","Session is draining; restart after shutdown");lastActivity=System.currentTimeMillis();Job job=new Job(request);if(!queue.offer(job))throw RetkQueries.error("queue_full","Session queue is full; retry query later");response=job.answer.get();}
                    send(out,response);if(method.equals("session.stop"))stopping=true;
                }catch(Exception e){if(e instanceof SocketTimeoutException)break;try{if(e instanceof CharacterCodingException||e instanceof MalformedJsonException)e=RetkQueries.error("invalid_frame","Request must be valid UTF-8 JSON");JsonObject failed=failure(request,e);if(!authenticated){failed.add("programIdentity",JsonNull.INSTANCE);failed.add("revision",JsonNull.INSTANCE);}send(out,failed);}catch(Exception ignored){}break;}}
        }catch(Exception ignored){}finally{sockets.remove(socket);readers.release();try{socket.close();}catch(IOException ignored){}if(control==socket){control=null;stopping=true;}}}
    void send(OutputStream out,JsonObject response)throws Exception {byte[] bytes=JSON.toJson(response).getBytes(StandardCharsets.UTF_8);if(bytes.length>RESPONSE_LIMIT){response=failure(response,RetkQueries.error("response_limit","Response exceeds 2 MiB; narrow query or lower page limit"));bytes=JSON.toJson(response).getBytes(StandardCharsets.UTF_8);}out.write(bytes);out.write(10);out.flush();}
    JsonObject status(){JsonObject status=new JsonObject();status.addProperty("state",mutations.needsRecovery?"needs-recovery":stopping?"draining":"ready");status.addProperty("mode",config.get("mode").getAsString());status.addProperty("revision",mutations.revision);status.addProperty("latestReceipt",mutations.latestReceipt);return status;}
    JsonObject execute(JsonObject r)throws Exception {if(mutations.needsRecovery)throw RetkQueries.error("needs_recovery","Session requires recovery; inspect journal and stop");identity.validate();String method=r.get("method").getAsString();JsonObject p=r.getAsJsonObject("params"),result;if(Set.of("functions.rename","comments.set","symbols.apply","analysis.ensure").contains(method))result=mutations.execute(method,p);else if(method.equals("symbols.plan"))result=symbols.plan(p,mutations.revision);else result=queries.execute(method,p,mutations.revision);return success(r,result);}
    JsonObject envelope(JsonObject request){JsonObject response=new JsonObject();response.addProperty("version",1);response.add("id",request!=null&&request.has("id")?request.get("id"):JsonNull.INSTANCE);response.addProperty("runId",config.get("runId").getAsString());response.add("programIdentity",identity.identity);response.addProperty("revision",mutations.revision);response.addProperty("coverage","observed");response.addProperty("dataTrust","untrusted-target-content");JsonArray limits=new JsonArray();limits.add("Analysis state is not inferred from function count");response.add("limitations",limits);return response;}
    JsonObject success(JsonObject request,JsonObject result){JsonObject response=envelope(request);response.addProperty("ok",true);response.add("result",result);return response;}
    JsonObject failure(JsonObject request,Exception exception){JsonObject response=envelope(request);response.addProperty("ok",false);String message=exception.getMessage(),code="operation_failed";if(exception instanceof IllegalArgumentException&&message!=null&&message.matches("[a-z_]+: .*")){int index=message.indexOf(':');code=message.substring(0,index);message=message.substring(index+2);}else message="Bridge operation failed ("+exception.getClass().getSimpleName()+"); inspect engine diagnostics";JsonObject error=new JsonObject();error.addProperty("code",code);error.addProperty("message",message);response.add("error",error);return response;}
}
