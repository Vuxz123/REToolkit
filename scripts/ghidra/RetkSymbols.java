import com.google.gson.*;
import com.google.gson.stream.JsonReader;
import com.google.gson.stream.JsonToken;
import ghidra.program.model.address.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.mem.MemoryBlock;
import ghidra.program.model.symbol.*;
import ghidra.util.task.TaskMonitor;
import java.io.*;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;

/** IL2CPP plain-script planner. Transaction, snapshot, ledger and save belong to RetkMutations. */
public final class RetkSymbols {
    private static final Gson JSON = new GsonBuilder().serializeNulls().disableHtmlEscaping().create();
    private static final String START = "[REToolkit IL2CPP]\n", END = "\n[/REToolkit IL2CPP]";
    private static final Set<String> GROUPS = new LinkedHashSet<>(Arrays.asList("ScriptMethod", "ScriptString", "ScriptMetadata", "ScriptMetadataMethod", "Addresses"));
    private final Program program;
    private final JsonObject config, identity;
    private final TaskMonitor monitor;
    private final Path workspace, plans, script;
    public RetkSymbols(Program p, JsonObject c, JsonObject i, TaskMonitor m) {
        program=p; config=c; identity=i.deepCopy(); monitor=m;
        try {
            workspace=Paths.get(required(c,"workspace")).toRealPath();
            plans=workspace.resolve("04_Notes/symbol-plans");
            script=inside(c.has("scriptPath") ? Paths.get(required(c,"scriptPath")) : workspace.resolve("02_Il2CppDumperOutput/script.json"));
        } catch (Exception e) { throw fail("plan_invalid", "Cannot resolve workspace/script: " + e.getMessage()); }
    }
    private static IllegalArgumentException fail(String code,String message) { return new IllegalArgumentException(code+": "+message); }
    private static String required(JsonObject o,String key) { if(!o.has(key)||o.get(key).isJsonNull()||!o.get(key).isJsonPrimitive())throw fail("plan_invalid","Missing "+key);return o.get(key).getAsString(); }
    private static boolean flag(JsonObject o,String key) { return o.has(key)&&o.get(key).getAsBoolean(); }
    private Path inside(Path p) throws IOException {
        Path normalized=p.toAbsolutePath().normalize();
        if(!normalized.startsWith(workspace))throw fail("plan_invalid","Path must be inside workspace");
        Path cursor=workspace;
        for(Path component:workspace.relativize(normalized)) { cursor=cursor.resolve(component);if(Files.isSymbolicLink(cursor))throw fail("plan_invalid","Linked paths are unsupported"); }
        if(Files.exists(normalized)&&!normalized.toRealPath().startsWith(workspace))throw fail("plan_invalid","Resolved path escapes workspace");
        return normalized;
    }
    private static String hash(byte[] bytes) throws Exception { StringBuilder s=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(bytes))s.append(String.format("%02x",b&255));return s.toString(); }
    private static String hash(Path p) throws Exception { MessageDigest d=MessageDigest.getInstance("SHA-256");try(InputStream in=Files.newInputStream(p)){byte[] b=new byte[65536];int n;while((n=in.read(b))!=-1)d.update(b,0,n);}StringBuilder s=new StringBuilder();for(byte b:d.digest())s.append(String.format("%02x",b&255));return s.toString(); }
    private JsonObject binding() throws Exception {
        JsonObject profile=config.has("profile")&&config.get("profile").isJsonObject()?config.getAsJsonObject("profile"):new JsonObject();
        if(!flag(profile,"dumpVerified"))throw fail("input_changed","Dump provenance is unverified; rerun dump before symbols plan");
        JsonObject b=new JsonObject();b.add("programIdentity",identity.deepCopy());b.addProperty("imageBase",hex(program.getImageBase()));
        b.addProperty("language",program.getLanguageID().toString());b.add("profile",profile.deepCopy());
        if(profile.has("toolInputs"))for(JsonElement value:profile.getAsJsonArray("toolInputs")) {
            JsonObject tool=value.getAsJsonObject();
            if(!hash(Paths.get(required(tool,"path"))).equals(required(tool,"sha256")))throw fail("input_changed","Dumper runtime/configuration changed; prepare dump and restart session");
        }
        for(String kind:Arrays.asList("native","metadata")) {
            JsonObject input=config.getAsJsonObject(kind);if(input==null)throw fail("input_changed","Missing "+kind+" binding");
            String actual=hash(Paths.get(required(input,"path")));
            if(!actual.equals(required(input,"sha256"))||!actual.equals(required(profile,kind+"Sha256")))throw fail("input_changed",kind+" changed; rerun scan/dump");
            b.addProperty(kind+"Sha256",actual);
        }
        String actual=hash(script);if(!actual.equals(required(profile,"scriptSha256")))throw fail("input_changed","script.json changed; rerun dump");
        b.addProperty("scriptSha256",actual);b.addProperty("scriptPath",script.toString());return b;
    }
    private static String hex(Address a) { return "0x"+a.getOffsetAsBigInteger().toString(16); }
    private static BigInteger integer(String s) {
        try { BigInteger n=s.matches("0[xX][0-9a-fA-F]+")?new BigInteger(s.substring(2),16):s.matches("[0-9]+")?new BigInteger(s):null;
            if(n==null||n.signum()<0||n.bitLength()>64)throw new NumberFormatException();return n;
        }catch(Exception e){throw fail("plan_invalid","Address must be an exact unsigned 64-bit integer");}
    }
    private Address address(String raw,String mode) {
        BigInteger n=integer(raw);if("rva".equals(mode))n=n.add(program.getImageBase().getOffsetAsBigInteger());
        AddressSpace space=program.getAddressFactory().getDefaultAddressSpace();
        if(n.signum()<0||n.bitLength()>space.getSize())throw fail("address_unmapped","Address overflow");
        Address a=space.getAddress(n.longValue());if(!program.getMemory().contains(a))throw fail("address_unmapped","Address is not mapped");return a;
    }
    private static JsonElement readExact(JsonReader r)throws IOException {
        switch(r.peek()) {
            case BEGIN_OBJECT: JsonObject o=new JsonObject();r.beginObject();while(r.hasNext()){String k=r.nextName();if(o.has(k))throw fail("plan_invalid","Duplicate JSON key "+k);o.add(k,readExact(r));}r.endObject();return o;
            case BEGIN_ARRAY: JsonArray a=new JsonArray();r.beginArray();while(r.hasNext())a.add(readExact(r));r.endArray();return a;
            case NUMBER: case STRING: return new JsonPrimitive(r.nextString());
            case BOOLEAN:return new JsonPrimitive(r.nextBoolean());
            case NULL:r.nextNull();return JsonNull.INSTANCE;
            default:throw fail("plan_invalid","Malformed JSON");
        }
    }
    private static String sanitize(String name) {
        String s=name.trim().replaceAll("[^A-Za-z0-9_.$]","_");if(s.isEmpty())s="il2cpp_empty";if(Character.isDigit(s.charAt(0)))s="_"+s;
        if(s.length()>512)s=s.substring(0,480)+"_"+Integer.toUnsignedString(name.hashCode(),16);return s;
    }
    private JsonObject before(Address a) {
        JsonObject b=new JsonObject();JsonArray names=new JsonArray();
        for(Symbol s:program.getSymbolTable().getSymbols(a)){JsonObject n=new JsonObject();n.addProperty("id",Long.toString(s.getID()));n.addProperty("name",s.getName());n.addProperty("source",s.getSource().toString());n.addProperty("primary",s.isPrimary());names.add(n);}
        b.add("symbols",names);String comment=program.getListing().getComment(CodeUnit.EOL_COMMENT,a);b.add("comment",comment==null?JsonNull.INSTANCE:new JsonPrimitive(comment));
        Function f=program.getFunctionManager().getFunctionContaining(a);b.add("function",f==null?JsonNull.INSTANCE:new JsonPrimitive(hex(f.getEntryPoint())));return b;
    }
    private boolean collision(String name,Address a,Map<String,String> reserved) {
        if(reserved.containsKey(name)&&!reserved.get(name).equals(hex(a)))return true;
        for(Symbol s:program.getSymbolTable().getGlobalSymbols(name))if(!s.getAddress().equals(a))return true;return false;
    }
    private String comment(String old,String value,boolean replace) {
        String managed=START+value.replace("[REToolkit IL2CPP]","[REToolkit_IL2CPP]").replace("[/REToolkit IL2CPP]","[/REToolkit_IL2CPP]")+END;
        if(old==null||old.isEmpty()||replace)return managed;
        int start=old.lastIndexOf(START),end=start<0?-1:old.indexOf(END,start+START.length());
        if(start>=0&&end>=0)return old.substring(0,start)+managed+old.substring(end+END.length());
        return old+"\n"+managed;
    }
    private JsonObject entry(String group,int index,JsonElement source,String mode,JsonObject policy,Map<String,String> reserved,Set<String> touched) {
        JsonObject e=new JsonObject();e.addProperty("group",group);e.addProperty("index",index);
        try {
            JsonObject item=source.isJsonObject()?source.getAsJsonObject():null;
            String raw=item==null?source.getAsString():required(item,"Address");BigInteger n=integer(raw);e.addProperty("rawAddress","0x"+n.toString(16));
            if(program.getLanguage().getProcessor().toString().equalsIgnoreCase("ARM"))throw fail("address_unmapped","ARM/Thumb mapping is unqualified; no Thumb bit normalization is performed");
            Address a=address(raw,mode);String mapped=hex(a);e.addProperty("address",mapped);e.addProperty("canonicalAddress",mapped);
            MemoryBlock block=program.getMemory().getBlock(a);if(!block.isInitialized())throw fail("address_unmapped","Uninitialized mapping");
            if((group.equals("ScriptMethod")||group.equals("Addresses"))&&!block.isExecute())throw fail("address_unmapped","Method entry requires executable mapping");
            JsonObject old=before(a);e.add("before",old);JsonObject change=new JsonObject();change.addProperty("address",mapped);change.add("before",old.deepCopy());
            String original=null,value=null;
            if(group.equals("ScriptString")){original="StringLiteral_"+index;value=required(item,"Value");}
            else if(!group.equals("Addresses")){original=required(item,"Name");if(!group.equals("ScriptMethod"))value=original;}
            if(original!=null) {
                e.addProperty("originalName",original);String name=sanitize(original);
                if(collision(name,a,reserved))name=name+"__"+a.getOffsetAsBigInteger().toString(16);
                if(collision(name,a,reserved))throw fail("plan_invalid","Deterministic symbol collision");
                reserved.put(name,mapped);e.addProperty("name",name);
                boolean same=false,user=false;
                for(Symbol s:program.getSymbolTable().getSymbols(a)){if(s.getName().equals(name))same=true;else if(s.getSource()==SourceType.USER_DEFINED)user=true;}
                if(!same) {
                    if(user&&!flag(policy,"replaceUserNames")){e.addProperty("status","conflict");e.addProperty("reason","USER_DEFINED name preserved");return e;}
                    if(!touched.add(mapped+":name"))throw fail("plan_invalid","Multiple names target the same address");
                    change.addProperty("name",name);change.addProperty("originalName",original);
                }
            }
            if(value!=null&&!value.isEmpty()) {
                String oldComment=old.get("comment").isJsonNull()?null:old.get("comment").getAsString();String next=comment(oldComment,value,flag(policy,"replaceUserComments"));
                if(!Objects.equals(oldComment,next)) {if(!touched.add(mapped+":comment"))throw fail("plan_invalid","Multiple comments target the same address");change.addProperty("comment",next);}
            }
            if(group.equals("Addresses")) {
                if(program.getFunctionManager().getFunctionAt(a)!=null){e.addProperty("status","noop");return e;}
                if(!flag(policy,"createFunctions")){e.addProperty("status","skipped");e.addProperty("reason","Function creation requires createFunctions");return e;}
                Instruction ins=program.getListing().getInstructionAt(a);
                if(ins==null||program.getFunctionManager().getFunctionContaining(a)!=null)throw fail("address_unmapped","Function requires an existing instruction and no function overlap");
                AddressSet body=new AddressSet(ins.getMinAddress(),ins.getMaxAddress());
                if(program.getFunctionManager().getFunctionsOverlapping(body).hasNext())throw fail("address_unmapped","Function body overlaps an existing function");
                change.addProperty("createFunction",true);change.addProperty("bodyEnd",hex(ins.getMaxAddress()));
            }
            if(change.size()==2)e.addProperty("status","noop");else {e.addProperty("status","planned");e.add("change",change);}
        } catch(IllegalArgumentException ex) {e.addProperty("status","skipped");e.addProperty("reason",ex.getMessage());}
        return e;
    }
    public JsonObject plan(JsonObject params,long revision) {
        try {
            JsonObject bound=binding();String mode=params.has("addressMode")?required(params,"addressMode"):null;
            // No installed Il2CppDumper profile has yet been qualified for automatic mapping.
            if(!"rva".equals(mode)&&!"va".equals(mode))throw fail("plan_invalid","Unqualified dumper profile requires addressMode rva or va");
            JsonObject policy=new JsonObject();policy.addProperty("addressMode",mode);for(String k:Arrays.asList("createFunctions","replaceUserNames","replaceUserComments"))policy.addProperty(k,flag(params,k));
            JsonArray entries=new JsonArray();Map<String,String> reserved=new HashMap<>();Set<String> touched=new HashSet<>();Set<String> seen=new HashSet<>();
            try(JsonReader r=new JsonReader(Files.newBufferedReader(script,StandardCharsets.UTF_8))) {
                r.setLenient(false);r.beginObject();while(r.hasNext()){String group=r.nextName();if(!seen.add(group))throw fail("plan_invalid","Duplicate group "+group);
                    if(!GROUPS.contains(group)){r.skipValue();continue;}r.beginArray();int i=0;while(r.hasNext()){monitor.checkCancelled();entries.add(entry(group,++i,readExact(r),mode,policy,reserved,touched));}r.endArray();}
                r.endObject();if(r.peek()!=JsonToken.END_DOCUMENT)throw fail("plan_invalid","Trailing JSON content");
            }
            // Revalidate after streaming to catch changes while reading.
            if(!bound.equals(binding()))throw fail("input_changed","Inputs changed during planning");
            JsonObject counts=new JsonObject();for(String k:Arrays.asList("planned","noop","conflict","skipped"))counts.addProperty(k,0);
            for(JsonElement v:entries){String k=v.getAsJsonObject().get("status").getAsString();counts.addProperty(k,counts.get(k).getAsInt()+1);}
            JsonArray missingGroups=new JsonArray();for(String group:GROUPS)if(!seen.contains(group))missingGroups.add(group);
            JsonObject coverage=new JsonObject();boolean full=counts.get("conflict").getAsInt()==0&&counts.get("skipped").getAsInt()==0&&missingGroups.isEmpty();coverage.addProperty("status",full?"complete":"partial");coverage.add("counts",counts.deepCopy());coverage.add("missingGroups",missingGroups);
            JsonObject plan=new JsonObject();plan.addProperty("version",1);plan.addProperty("revision",revision);plan.add("binding",bound);plan.add("policy",policy);plan.add("entries",entries);plan.add("coverage",coverage);plan.addProperty("symbolsApplied",full);
            byte[] bytes=(JSON.toJson(plan)+"\n").getBytes(StandardCharsets.UTF_8);String digest=hash(bytes);inside(plans);Files.createDirectories(plans);inside(plans);
            Path file=inside(plans.resolve(digest+".json"));if(Files.exists(file)){if(!hash(file).equals(digest))throw fail("plan_invalid","Existing immutable plan was modified");}else Files.write(file,bytes,StandardOpenOption.CREATE_NEW);
            JsonObject result=new JsonObject();result.addProperty("plan",file.toString());result.addProperty("planHash",digest);result.add("summary",counts);result.add("coverage",coverage.deepCopy());result.addProperty("symbolsApplied",false);return result;
        }catch(IllegalArgumentException e){throw e;}catch(Exception e){throw fail("plan_invalid",e.getMessage());}
    }
    public JsonObject validate(JsonObject params,long revision) {
        try {
            Path file=inside(Paths.get(required(params,"plan")));if(!file.getParent().equals(inside(plans)))throw fail("plan_invalid","Plan must be in fixed symbol-plans directory");
            byte[] bytes=Files.readAllBytes(file);String digest=hash(bytes);
            if(!digest.equals(required(params,"planHash"))||!file.getFileName().toString().equals(digest+".json"))throw fail("plan_invalid","Plan bytes/hash do not match preview");
            JsonObject plan=JsonParser.parseString(new String(bytes,StandardCharsets.UTF_8)).getAsJsonObject();
            if(plan.get("version").getAsInt()!=1)throw fail("plan_invalid","Unknown plan version");
            if(plan.get("revision").getAsLong()!=revision)throw fail("revision_conflict","Plan revision is stale; create a new plan");
            if(!plan.getAsJsonObject("binding").equals(binding()))throw fail("input_changed","Plan inputs/profile/program identity changed");
            JsonArray changes=new JsonArray(),oldValues=new JsonArray(),newValues=new JsonArray();
            for(JsonElement v:plan.getAsJsonArray("entries")) {
                monitor.checkCancelled();JsonObject entry=v.getAsJsonObject();if(!entry.has("before"))continue;
                Address a=address(required(entry,"address"),"va");
                if(!entry.getAsJsonObject("before").equals(before(a)))throw fail("revision_conflict","Plan before values changed at "+hex(a));
                if(entry.has("change")){JsonObject change=entry.getAsJsonObject("change");if(change.has("createFunction")){Instruction ins=program.getListing().getInstructionAt(a);if(ins==null||!hex(ins.getMaxAddress()).equals(required(change,"bodyEnd"))||!program.getMemory().getBlock(a).isExecute()||program.getFunctionManager().getFunctionsOverlapping(new AddressSet(a,ins.getMaxAddress())).hasNext())throw fail("revision_conflict","Instruction/function mapping changed");}changes.add(change.deepCopy());oldValues.add(entry.get("before").deepCopy());newValues.add(change.deepCopy());}
            }
            JsonObject result=new JsonObject();result.add("changes",changes);result.add("before",oldValues);result.add("after",newValues);result.add("coverage",plan.get("coverage").deepCopy());result.add("binding",plan.get("binding").deepCopy());result.add("policy",plan.get("policy").deepCopy());result.addProperty("symbolsApplied",plan.get("symbolsApplied").getAsBoolean());result.addProperty("planHash",digest);result.addProperty("noop",changes.isEmpty());return result;
        }catch(IllegalArgumentException e){throw e;}catch(Exception e){throw fail("plan_invalid",e.getMessage());}
    }
    public void apply(JsonObject validated) {
        try {
            for(JsonElement v:validated.getAsJsonArray("changes")) {
                monitor.checkCancelled();JsonObject c=v.getAsJsonObject();Address a=address(required(c,"address"),"va");
                if(c.has("name")){String name=required(c,"name");Symbol primary=program.getSymbolTable().getPrimarySymbol(a);if(primary!=null&&!primary.isDynamic())primary.setName(name,SourceType.IMPORTED);else program.getSymbolTable().createLabel(a,name,SourceType.IMPORTED).setPrimary();}
                if(c.has("comment"))program.getListing().setComment(a,CodeUnit.EOL_COMMENT,required(c,"comment"));
                if(flag(c,"createFunction"))program.getFunctionManager().createFunction(null,a,new AddressSet(a,address(required(c,"bodyEnd"),"va")),SourceType.IMPORTED);
            }
        }catch(IllegalArgumentException e){throw e;}catch(Exception e){throw fail("plan_invalid",e.getMessage());}
    }
}
