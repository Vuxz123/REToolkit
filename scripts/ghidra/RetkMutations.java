import com.google.gson.*;
import com.google.gson.stream.JsonWriter;
import ghidra.program.model.listing.*;
import ghidra.program.model.address.Address;
import ghidra.program.model.symbol.SourceType;
import ghidra.framework.options.Options;
import ghidra.util.task.TaskMonitor;
import java.nio.file.*;
import java.nio.channels.FileChannel;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.DigestOutputStream;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.util.*;

/** Durable executor. The caller must have ended GhidraScript's outer transaction. */
public final class RetkMutations {
    final Program program;final JsonObject config;final RetkQueries queries;final RetkSymbols symbols;final TaskMonitor monitor;final Options options;final Path directory;
    volatile boolean needsRecovery=false; volatile String latestReceipt; volatile long revision;volatile JsonArray verifiedReceipts=new JsonArray();
    JsonObject ledger;
    public RetkMutations(Program p,JsonObject c,RetkQueries q,RetkSymbols s,TaskMonitor m)throws Exception {
        program=p;config=c;queries=q;symbols=s;monitor=m;options=p.getOptions("REToolkit Bridge");revision=options.getLong("revision",0);
        ledger=JsonParser.parseString(options.getString("ledger","{}")).getAsJsonObject();
        directory=Path.of(c.get("workspace").getAsString()).toRealPath().resolve("04_Notes/bridge");checkDirectory();
        for(var entry:ledger.entrySet()){JsonObject saved=entry.getValue().getAsJsonObject();try{Path receipt=receiptPath(entry.getKey());JsonObject disk=JsonParser.parseString(Files.readString(receipt)).getAsJsonObject();if(!disk.equals(saved)||!disk.get("status").getAsString().equals("saved"))needsRecovery=true;}catch(Exception e){needsRecovery=true;}}
        Path journals=directory.resolve("journal");if(Files.exists(journals))try(var paths=Files.list(journals)){for(Path path:paths.filter(x->x.toString().endsWith(".json")).toList()){JsonObject intent=JsonParser.parseString(Files.readString(path)).getAsJsonObject();String id=intent.get("operationId").getAsString();if(RetkQueries.str(intent,"status","").equals("noop")){try{Path receipt=receiptPath(id);if(!JsonParser.parseString(Files.readString(receipt)).equals(intent))needsRecovery=true;else if(verifiedReceipts.size()<1024&&verifyNoop(intent))verifiedReceipts.add(receipt.toString());}catch(Exception e){needsRecovery=true;}}else if(!RetkQueries.str(intent,"status","").equals("rolled-back")&&!ledger.has(id)&&!Files.exists(directory.resolve("receipts").resolve(id+".json")))needsRecovery=true;}}
        if(!needsRecovery)for(var entry:ledger.entrySet())verifiedReceipts.add(receiptPath(entry.getKey()).toString());
    }
    Path receiptPath(String operationId){if(!UUID.fromString(operationId).toString().equals(operationId))throw RetkQueries.error("needs_recovery","Invalid operation ID in persisted history");return directory.resolve("receipts").resolve(operationId+".json");}
    void checkDirectory()throws Exception {Path workspace=Path.of(config.get("workspace").getAsString()).toRealPath(),cursor=workspace;for(Path component:workspace.relativize(directory)){cursor=cursor.resolve(component);if(Files.exists(cursor)&&(!cursor.toRealPath().startsWith(workspace)||Files.isSymbolicLink(cursor)))throw RetkQueries.error("artifact_path_invalid","Bridge artifacts must remain inside the workspace");}for(String child:new String[]{"snapshots","journal","receipts"}){Path candidate=directory.resolve(child);if(Files.exists(candidate)&&(!candidate.toRealPath().startsWith(workspace)||Files.isSymbolicLink(candidate)))throw RetkQueries.error("artifact_path_invalid","Bridge artifact directory is linked outside the workspace");}}
    boolean verifyNoop(JsonObject receipt){try{if(receipt.get("revision").getAsLong()!=revision||!receipt.get("workspace").equals(config.get("workspace"))||!receipt.get("projectName").equals(config.get("projectName"))||!receipt.get("program").equals(config.get("program")))return false;String method=receipt.get("method").getAsString();JsonObject params=receipt.deepCopy();if(method.equals("functions.rename"))params.add("name",receipt.get("after"));else if(method.equals("comments.set"))params.add("text",receipt.get("after"));JsonObject now=prepare(method,params);if(method.equals("symbols.apply"))now=compact(now,params);return now.get("before").equals(receipt.get("before"))&&now.get("after").equals(receipt.get("after"));}catch(Exception e){return false;}}
    public static JsonElement canonical(JsonElement v){if(v.isJsonObject()){JsonObject o=new JsonObject();new TreeSet<>(v.getAsJsonObject().keySet()).forEach(k->o.add(k,canonical(v.getAsJsonObject().get(k))));return o;}if(v.isJsonArray()){JsonArray a=new JsonArray();v.getAsJsonArray().forEach(x->a.add(canonical(x)));return a;}return v;}
    // Match JSON.stringify, including literal U+2028/U+2029 and well-formed lone
    // surrogate escaping. Gson deliberately escapes those line separators.
    static String quote(String value){StringBuilder s=new StringBuilder("\"");for(int i=0;i<value.length();i++){char c=value.charAt(i);switch(c){case '"':s.append("\\\"");break;case '\\':s.append("\\\\");break;case '\b':s.append("\\b");break;case '\f':s.append("\\f");break;case '\n':s.append("\\n");break;case '\r':s.append("\\r");break;case '\t':s.append("\\t");break;default:if(c<32||(Character.isHighSurrogate(c)&&(i+1==value.length()||!Character.isLowSurrogate(value.charAt(i+1))))||(Character.isLowSurrogate(c)&&(i==0||!Character.isHighSurrogate(value.charAt(i-1)))))s.append(String.format("\\u%04x",(int)c));else s.append(c);}}return s.append('"').toString();}
    static String canonicalText(JsonElement value){if(value==null||value.isJsonNull())return "null";if(value.isJsonObject()){List<String> entries=new ArrayList<>();for(String key:new TreeSet<>(value.getAsJsonObject().keySet()))entries.add(quote(key)+":"+canonicalText(value.getAsJsonObject().get(key)));return "{"+String.join(",",entries)+"}";}if(value.isJsonArray()){List<String> entries=new ArrayList<>();for(JsonElement item:value.getAsJsonArray())entries.add(canonicalText(item));return "["+String.join(",",entries)+"]";}JsonPrimitive primitive=value.getAsJsonPrimitive();return primitive.isString()?quote(primitive.getAsString()):primitive.toString();}
    public static String payloadHash(String method,JsonObject params)throws Exception {JsonObject p=params.deepCopy();p.remove("operationId");p.remove("payloadHash");JsonObject payload=new JsonObject();payload.addProperty("method",method);payload.add("params",p);return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(canonicalText(payload).getBytes(StandardCharsets.UTF_8)));}
    // Preserve canonical(value).toString() bytes, including Gson's escaping and
    // number spelling, without a duplicate tree or whole-array String/byte[].
    static void writeCanonical(JsonWriter out,JsonElement value)throws Exception {
        if(value==null||value.isJsonNull()){out.nullValue();return;}
        if(value.isJsonObject()){out.beginObject();JsonObject object=value.getAsJsonObject();for(String key:new TreeSet<>(object.keySet())){out.name(key);writeCanonical(out,object.get(key));}out.endObject();return;}
        if(value.isJsonArray()){out.beginArray();for(JsonElement item:value.getAsJsonArray())writeCanonical(out,item);out.endArray();return;}
        JsonPrimitive primitive=value.getAsJsonPrimitive();if(primitive.isNumber())out.value(primitive.getAsNumber());else if(primitive.isBoolean())out.value(primitive.getAsBoolean());else out.value(primitive.getAsString());
    }
    static String digest(JsonElement value)throws Exception {
        MessageDigest hash=MessageDigest.getInstance("SHA-256");
        try(JsonWriter out=new JsonWriter(new OutputStreamWriter(new DigestOutputStream(OutputStream.nullOutputStream(),hash),StandardCharsets.UTF_8))){out.setLenient(true);writeCanonical(out,value);}
        return "sha256:"+HexFormat.of().formatHex(hash.digest());
    }
    JsonObject compact(JsonObject descriptor,JsonObject params)throws Exception {JsonObject result=new JsonObject();for(var entry:descriptor.entrySet())if(!Set.of("changes","before","after").contains(entry.getKey()))result.add(entry.getKey(),entry.getValue().deepCopy());result.addProperty("before",digest(descriptor.get("before")));result.addProperty("after",digest(descriptor.get("after")));result.add("plan",params.get("plan"));result.addProperty("changeCount",descriptor.getAsJsonArray("changes").size());return result;}
    public static void atomic(Path path,JsonObject value)throws Exception {Files.createDirectories(path.getParent());Path tmp=path.resolveSibling(path.getFileName()+".tmp-"+UUID.randomUUID());try{try(FileChannel out=FileChannel.open(tmp,StandardOpenOption.CREATE_NEW,StandardOpenOption.WRITE)){ByteBuffer bytes=StandardCharsets.UTF_8.encode(value.toString()+"\n");while(bytes.hasRemaining())out.write(bytes);out.force(true);}Files.move(tmp,path,StandardCopyOption.ATOMIC_MOVE);}finally{Files.deleteIfExists(tmp);}}
    JsonObject prepare(String method,JsonObject p)throws Exception {
        if(method.equals("symbols.apply"))return symbols.validate(p,revision);
        Address address=RetkQueries.address(program,RetkQueries.str(p,"address",null));JsonObject change=new JsonObject();change.addProperty("address",RetkQueries.hex(address));
        if(method.equals("functions.rename")){Function f=program.getFunctionManager().getFunctionAt(address);if(f==null)throw RetkQueries.error("function_not_found","Rename requires an existing exact function entry");String name=RetkQueries.str(p,"name",null);if(name==null||name.isBlank()||name.length()>1000)throw RetkQueries.error("invalid_params","Nonempty function name required (maximum 1000 characters)");ghidra.program.model.symbol.SymbolUtilities.validateName(name);change.addProperty("before",f.getName());change.addProperty("after",name);}
        else {String type=RetkQueries.str(p,"type","plate");CommentType t=RetkQueries.commentTypes().get(type);if(t==null)throw RetkQueries.error("invalid_params","Comment type must be eol, pre, post, plate or repeatable");String text=RetkQueries.str(p,"text",null);if(text!=null&&text.length()>32768)throw RetkQueries.error("invalid_params","Comment exceeds 32768 characters");change.addProperty("type",type);change.add("before",RetkQueries.nullable(program.getListing().getComment(t,address)));change.add("after",RetkQueries.nullable(text));}
        change.addProperty("coverage","complete");return change;
    }
    void apply(String method,JsonObject change)throws Exception {if(method.equals("symbols.apply")){symbols.apply(change);return;}Address a=RetkQueries.address(program,change.get("address").getAsString());if(method.equals("functions.rename"))program.getFunctionManager().getFunctionAt(a).setName(change.get("after").getAsString(),SourceType.USER_DEFINED);else program.getListing().setComment(a,RetkQueries.commentTypes().get(change.get("type").getAsString()),change.get("after").isJsonNull()?null:change.get("after").getAsString());}
    public JsonObject execute(String method,JsonObject p)throws Exception {
        if(!config.get("mode").getAsString().equals("write"))throw RetkQueries.error("write_session_required","Stop session and start with --write");
        if(needsRecovery)throw RetkQueries.error("needs_recovery","Save state is uncertain; stop and inspect journal/receipts before reopening");
        checkDirectory();
        boolean dry=p.has("dryRun")&&p.get("dryRun").getAsBoolean();String id=RetkQueries.str(p,"operationId",null),hash=RetkQueries.str(p,"payloadHash",null);
        if(!dry){
            try{if(!UUID.fromString(id).toString().equals(id))throw new Exception();}catch(Exception e){throw RetkQueries.error("invalid_params","Canonical operation UUID required");}
            if(!payloadHash(method,p).equals(hash))throw RetkQueries.error("operation_conflict","Payload hash does not bind this request");
            if(ledger.has(id)){
                JsonObject saved=ledger.getAsJsonObject(id);if(!saved.get("payloadHash").getAsString().equals(hash))throw RetkQueries.error("operation_conflict","Operation UUID already binds another payload");
                JsonObject result=saved.deepCopy();try{Path receipt=receiptPath(id);if(!JsonParser.parseString(Files.readString(receipt)).equals(saved))throw new IllegalStateException();latestReceipt=receipt.toString();result.addProperty("receiptPath",receipt.toString());Path snapshot=directory.resolve("snapshots").resolve(id+".gzf");if(Files.exists(snapshot))result.addProperty("snapshotPath",snapshot.toString());}catch(Exception e){needsRecovery=true;throw RetkQueries.error("needs_recovery","Saved ledger/receipt no longer agree");}return result;
            }
            Path previous=directory.resolve("receipts").resolve(id+".json");
            if(Files.isRegularFile(previous)){
                JsonObject saved=JsonParser.parseString(Files.readString(previous)).getAsJsonObject();
                if(RetkQueries.str(saved,"status","").equals("noop")){
                    if(!saved.get("payloadHash").getAsString().equals(hash))throw RetkQueries.error("operation_conflict","Operation UUID already binds another payload");
                    saved.addProperty("receiptPath",previous.toString());
                    return saved;
                }
                throw RetkQueries.error("idempotency_expired","Receipt exists outside the Program verification window; inspect history before a new operation");
            }
            if(Files.exists(directory.resolve("journal").resolve(id+".json")))throw RetkQueries.error("idempotency_expired","Operation has prior journal history outside verified ledger; inspect receipt");
        }
        JsonObject prepared=prepare(method,p),change=method.equals("symbols.apply")?compact(prepared,p):prepared;
        if(dry){change.addProperty("status","preview");change.addProperty("expectedRevision",revision);return change;}
        if(!p.has("expectedRevision")||p.get("expectedRevision").getAsLong()!=revision)throw RetkQueries.error("revision_conflict","Revision changed; preview again");
        if(!p.has("expectedOld")||!p.get("expectedOld").equals(change.get("before")))throw RetkQueries.error("revision_conflict","Observed old value differs; preview again");
        JsonObject receipt=change.deepCopy();receipt.addProperty("version",1);receipt.addProperty("runId",config.get("runId").getAsString());receipt.addProperty("operationId",id);receipt.addProperty("method",method);receipt.addProperty("payloadHash",hash);
        receipt.add("workspace",config.get("workspace"));receipt.add("program",config.get("program"));receipt.add("projectName",config.get("projectName"));
        String coverage=change.has("coverage")&&change.get("coverage").isJsonPrimitive()?change.get("coverage").getAsString():change.has("symbolsApplied")&&change.get("symbolsApplied").getAsBoolean()?"complete":"partial";receipt.addProperty("coverage",coverage);
        receipt.add("native",config.get("native"));receipt.add("metadata",config.get("metadata"));receipt.add("profile",config.get("profile"));
        if((change.has("noop")&&change.get("noop").getAsBoolean())||(change.has("before")&&change.get("before").equals(change.get("after")))){receipt.addProperty("status","noop");receipt.addProperty("revision",revision);Path noopPath=directory.resolve("receipts").resolve(id+".json");receipt.addProperty("receiptPath",noopPath.toString());atomic(noopPath,receipt);atomic(directory.resolve("journal").resolve(id+".json"),receipt);latestReceipt=noopPath.toString();return receipt;}
        if(!program.canSave())throw RetkQueries.error("save_failed","Program cannot be saved; stop and reopen a writable project");
        if(program.getCurrentTransactionInfo()!=null)throw RetkQueries.error("transaction_conflict","Unexpected outer Program transaction");
        Path snapshot=directory.resolve("snapshots").resolve(id+".gzf"),temporary=snapshot.resolveSibling(id+".tmp.gzf");Files.createDirectories(snapshot.getParent());
        try{program.saveToPackedFile(temporary.toFile(),monitor);Files.move(temporary,snapshot,StandardCopyOption.ATOMIC_MOVE);JsonObject manifest=new JsonObject();manifest.addProperty("sha256",RetkProgramIdentity.hash(snapshot));manifest.addProperty("revision",revision);manifest.addProperty("operationId",id);atomic(snapshot.resolveSibling(id+".manifest.json"),manifest);}catch(Exception e){throw RetkQueries.error("backup_failed","Packed Program snapshot failed: "+e.getClass().getSimpleName());}
        receipt.addProperty("snapshotPath",snapshot.toString());receipt.addProperty("snapshotSha256",RetkProgramIdentity.hash(snapshot));Path receiptPath=directory.resolve("receipts").resolve(id+".json");receipt.addProperty("receiptPath",receiptPath.toString());receipt.addProperty("revision",revision+1);receipt.addProperty("status","saved");
        JsonObject intent=receipt.deepCopy();intent.addProperty("status","intent");atomic(directory.resolve("journal").resolve(id+".json"),intent);
        int tx=program.startTransaction("REToolkit "+method+" "+id);boolean commitAttempted=false;long before=revision;
        try {apply(method,prepared);JsonObject next=ledger.deepCopy();next.add(id,receipt);while(next.size()>1024)next.remove(next.keySet().iterator().next());options.setLong("revision",before+1);options.setString("ledger",next.toString());monitor.checkCancelled();commitAttempted=true;program.endTransaction(tx,true);revision=before+1;ledger=next;queries.flush();program.save("REToolkit saved "+id,monitor);if(program.isChanged()||options.getLong("revision",-1)!=revision||!options.getString("ledger","").equals(ledger.toString()))throw new IllegalStateException("Save/readback failed");atomic(receiptPath,receipt);latestReceipt=receiptPath.toString();return receipt;
        } catch(Exception e){if(!commitAttempted){try{program.endTransaction(tx,false);queries.flush();intent.addProperty("status","rolled-back");Path journal=directory.resolve("journal").resolve(id+".json"),replacement=journal.resolveSibling(id+".rollback");atomic(replacement,intent);Files.move(replacement,journal,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);}catch(Exception rollback){needsRecovery=true;}}else needsRecovery=true;if(needsRecovery)throw RetkQueries.error("needs_recovery","Commit/save/receipt uncertain; inspect operation "+id+" and snapshot");throw e;}
    }
}
