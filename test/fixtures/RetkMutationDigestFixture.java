import com.google.gson.*;
import ghidra.framework.options.Options;
import ghidra.program.model.listing.Program;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;

/** Tests the real mutation descriptor code without opening a Ghidra project. */
public final class RetkMutationDigestFixture {
    static void check(boolean condition,String message){if(!condition)throw new AssertionError(message);}
    static String legacyDigest(JsonElement value)throws Exception{return "sha256:"+HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(RetkMutations.canonical(value).toString().getBytes(StandardCharsets.UTF_8)));}
    static RetkMutations mutations(Path workspace)throws Exception {
        Options options=(Options)Proxy.newProxyInstance(Options.class.getClassLoader(),new Class[]{Options.class},(proxy,method,args)->{
            if(method.getName().equals("getLong"))return 0L;
            if(method.getName().equals("getString"))return "{}";
            throw new UnsupportedOperationException(method.getName());
        });
        Program program=(Program)Proxy.newProxyInstance(Program.class.getClassLoader(),new Class[]{Program.class},(proxy,method,args)->{
            if(method.getName().equals("getOptions"))return options;
            throw new UnsupportedOperationException(method.getName());
        });
        JsonObject config=new JsonObject();config.addProperty("workspace",workspace.toString());
        return new RetkMutations(program,config,null,null,null);
    }
    static void compatible(Path workspace)throws Exception {
        List<JsonElement> cases=new ArrayList<>();
        for(String text:new String[]{"null","true","false","0","-0","1e+03","1.2300","[null,false,3.5]","{\"z\":null,\"a\":{\"z\":0,\"a\":[1,2]}}"})cases.add(JsonParser.parseString(text));
        cases.add(new JsonPrimitive("\"\\\b\f\n\r\t\u0000\u001f<>&='\u2028\u2029 tiếng Việt 😀 \ud800 x \udc00"));
        cases.add(new JsonPrimitive("x".repeat(8191)+"😀\ud800"+"y".repeat(8191)+"\udc00\u2028\u2029"));
        for(Number number:new Number[]{Double.NaN,Double.POSITIVE_INFINITY,Double.NEGATIVE_INFINITY,-0.0,1e100,new java.math.BigDecimal("12345678901234567890.000000")})cases.add(new JsonPrimitive(number));
        JsonObject keys=new JsonObject();keys.add("z",JsonNull.INSTANCE);keys.add("😀",cases.get(cases.size()-1));keys.add("\ud800",new JsonPrimitive("\udc00"));keys.add("a",new JsonArray());cases.add(keys);
        Random random=new Random(913);int primitiveCases=cases.size();
        for(int i=0;i<100;i++){JsonObject object=new JsonObject();for(int j=0;j<10;j++)object.add("key"+random.nextInt(30),cases.get(random.nextInt(primitiveCases)));cases.add(object);}
        for(JsonElement value:cases)check(RetkMutations.digest(value).equals(legacyDigest(value)),"Digest changed for "+value);
        JsonObject descriptor=new JsonObject();descriptor.add("before",JsonParser.parseString("[{\"z\":null,\"a\":1}]"));descriptor.add("after",JsonParser.parseString("[{\"a\":2,\"z\":null}]"));descriptor.add("changes",new JsonArray());descriptor.add("binding",keys);descriptor.addProperty("coverage","partial");descriptor.addProperty("noop",false);descriptor.add("optional",JsonNull.INSTANCE);
        JsonObject params=new JsonObject();params.addProperty("plan","owned-plan.json");JsonObject expected=descriptor.deepCopy();expected.remove("changes");expected.addProperty("before",legacyDigest(descriptor.get("before")));expected.addProperty("after",legacyDigest(descriptor.get("after")));expected.add("plan",params.get("plan"));expected.addProperty("changeCount",0);
        check(mutations(workspace).compact(descriptor,params).equals(expected),"Compact descriptor changed legacy fields");
        System.out.println("compatible="+cases.size());
    }
    static void large(Path workspace)throws Exception {
        // Shared immutable values keep fixture input small; serialized aggregate
        // exceeds the retained real plan and exposes whole-array serialization.
        int entries=8192;String text="x".repeat(32768);JsonObject item=new JsonObject();item.addProperty("value",text);
        JsonArray before=new JsonArray(),after=new JsonArray(),changes=new JsonArray();
        for(int i=0;i<entries;i++){before.add(item);after.add(item);changes.add(item);}
        long bytes=(long)entries*(text.length()+13)*3;check(bytes>228064550L,"Fixture must exceed retained plan size");
        JsonObject descriptor=new JsonObject();descriptor.add("changes",changes);descriptor.add("before",before);descriptor.add("after",after);descriptor.addProperty("coverage","complete");JsonObject binding=new JsonObject();binding.addProperty("revision",7);descriptor.add("binding",binding);
        JsonObject params=new JsonObject();params.addProperty("plan","owned-plan.json");
        JsonObject compact=mutations(workspace).compact(descriptor,params);
        check(compact.get("before").equals(compact.get("after")),"Equal arrays must have equal digests");
        MessageDigest expectedHash=MessageDigest.getInstance("SHA-256");byte[] encodedItem=("{\"value\":\""+text+"\"}").getBytes(StandardCharsets.UTF_8);expectedHash.update((byte)'[');for(int i=0;i<entries;i++){if(i>0)expectedHash.update((byte)',');expectedHash.update(encodedItem);}expectedHash.update((byte)']');
        check(compact.get("before").getAsString().equals("sha256:"+HexFormat.of().formatHex(expectedHash.digest())),"Large digest must cover every item and delimiter");
        check(compact.get("before").getAsString().matches("sha256:[0-9a-f]{64}"),"Digest format changed");
        check(compact.get("changeCount").getAsInt()==entries&&!compact.has("changes"),"Compact count or omission changed");
        check(compact.toString().getBytes(StandardCharsets.UTF_8).length<16384,"Preview must remain bounded");
        check(descriptor.get("before")==before&&descriptor.get("after")==after&&descriptor.get("changes")==changes,"Input arrays changed");
        compact.getAsJsonObject("binding").addProperty("revision",8);check(binding.get("revision").getAsInt()==7,"Small descriptor fields must remain detached");
        System.out.println("aggregateBytes="+bytes+" compactBytes="+compact.toString().length());
    }
    static void copyPressure(Path workspace)throws Exception {
        // Unused changes must not be cloned even when the digest inputs are tiny.
        JsonArray children=new JsonArray();for(int i=0;i<512;i++)children.add(new JsonObject());
        JsonObject item=new JsonObject();item.add("children",children);JsonArray changes=new JsonArray();for(int i=0;i<8192;i++)changes.add(item);
        JsonObject descriptor=new JsonObject();descriptor.add("changes",changes);descriptor.add("before",new JsonArray());descriptor.add("after",new JsonArray());
        JsonObject params=new JsonObject();params.addProperty("plan","owned-plan.json");JsonObject result=mutations(workspace).compact(descriptor,params);
        check(result.get("changeCount").getAsInt()==8192,"Change count lost");check(!result.has("changes"),"Bulk array leaked");
        System.out.println("bulkCopyAvoided=true");
    }
    public static void main(String[] args)throws Exception{if(args[0].equals("compatible"))compatible(Path.of(args[1]));else if(args[0].equals("copy"))copyPressure(Path.of(args[1]));else large(Path.of(args[1]));}
}
