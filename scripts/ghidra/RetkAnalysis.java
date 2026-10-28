import com.google.gson.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.address.*;
import ghidra.program.model.mem.MemoryBlock;
import ghidra.program.model.symbol.SourceType;
import ghidra.app.cmd.disassemble.DisassembleCommand;
import ghidra.app.cmd.function.CreateFunctionCmd;
import ghidra.app.cmd.function.NewFunctionStackAnalysisCmd;
import ghidra.util.task.*;
import ghidra.util.exception.CancelledException;
import java.util.*;

/** Explicit scoped analysis. No global analyzer scheduling, code clearing or guessed extents. */
public final class RetkAnalysis {
    final Program program;final TaskMonitor parent;
    public RetkAnalysis(Program p,TaskMonitor m){program=p;parent=m;}
    IllegalArgumentException bad(String text){return RetkQueries.error("analysis_scope_invalid",text);}
    AddressSet range(JsonObject p){
        Address a=RetkQueries.address(program,RetkQueries.str(p,"address",null)),b=RetkQueries.address(program,RetkQueries.str(p,"endAddress",null));
        if(!a.getAddressSpace().equals(b.getAddressSpace())||b.compareTo(a)<0||b.subtract(a)>=65536)throw bad("One inclusive executable range of 1..65536 bytes is required");
        AddressSet set=new AddressSet(a,b);MemoryBlock block=program.getMemory().getBlock(a);
        if(block==null||!block.isExecute()||!block.isInitialized()||!block.contains(b))throw bad("Scope must stay inside one initialized executable memory block");
        String language=program.getLanguageID().toString();if(language.startsWith("ARM:"))throw bad("ARM/Thumb scoped analysis requires separate qualification");
        Instruction first=program.getListing().getInstructionContaining(a),last=program.getListing().getInstructionContaining(b);
        if(first!=null&&!first.getAddress().equals(a)||last!=null&&!set.contains(last.getMaxAddress()))throw bad("Scope splits an existing instruction");
        return set;
    }
    String key(JsonObject p)throws Exception{JsonObject k=new JsonObject();for(String field:new String[]{"address","endAddress","kind"})k.add(field,p.get(field));k.addProperty("version",1);return RetkMutations.digest(k);}
    JsonObject observe(AddressSet set,TaskMonitor work)throws Exception{
        JsonObject out=new JsonObject();Address a=set.getMinAddress();byte[] bytes=new byte[(int)set.getNumAddresses()];if(program.getMemory().getBytes(a,bytes)!=bytes.length)throw bad("Scope contains unreadable memory");out.addProperty("bytes",HexFormat.of().formatHex(bytes));
        JsonArray instructions=new JsonArray();var it=program.getListing().getInstructions(set,true);while(it.hasNext()){work.checkCancelled();Instruction i=it.next();JsonObject row=new JsonObject();row.addProperty("address",RetkQueries.hex(i.getAddress()));row.addProperty("length",i.getLength());JsonArray refs=new JsonArray();for(var ref:i.getReferencesFrom())refs.add(ref.toString());row.add("references",refs);instructions.add(row);}out.add("instructions",instructions);
        JsonArray functions=new JsonArray();var fs=program.getFunctionManager().getFunctionsOverlapping(set);while(fs.hasNext()){Function f=fs.next();JsonObject row=new JsonObject();row.addProperty("entry",RetkQueries.hex(f.getEntryPoint()));row.addProperty("body",f.getBody().toString());row.addProperty("signature",f.getSignature().toString());JsonArray variables=new JsonArray();for(Variable v:f.getAllVariables())variables.add(v.toString());row.add("variables",variables);functions.add(row);}out.add("functions",functions);return out;
    }
    public JsonObject prepare(JsonObject p,long revision)throws Exception{
        String kind=RetkQueries.str(p,"kind",null),reason=RetkQueries.str(p,"reason",null);if(!Set.of("disassemble","function","stack").contains(kind==null?"":kind))throw bad("kind must be disassemble, function or stack");if(reason==null||reason.isBlank()||reason.length()>2048)throw bad("A reason of 1..2048 characters is required");
        int timeout=60;try{if(p.has("timeoutSeconds")){if(!p.get("timeoutSeconds").toString().matches("[0-9]+"))throw bad("timeoutSeconds must be an integer");timeout=p.get("timeoutSeconds").getAsInt();}}catch(Exception e){throw bad("timeoutSeconds must be an integer in 1..300");}if(timeout<1||timeout>300)throw bad("timeoutSeconds must be 1..300");
        AddressSet set=range(p);Address a=set.getMinAddress();Function f=program.getFunctionManager().getFunctionContaining(a);if(f!=null&&!f.getEntryPoint().equals(a)&&!kind.equals("disassemble"))throw bad("Function analysis requires an exact entry");
        if(f!=null&&!kind.equals("disassemble")&&!set.contains(f.getBody()))throw bad("Scope must contain the entire existing function body");
        if(kind.equals("function")){var overlaps=program.getFunctionManager().getFunctionsOverlapping(set);while(overlaps.hasNext())if(!overlaps.next().getEntryPoint().equals(a))throw bad("Requested function scope overlaps another function");}
        if(kind.equals("stack")&&(f==null||!f.getEntryPoint().equals(a)))throw bad("Stack analysis requires an existing exact function entry");
        JsonObject out=new JsonObject();out.addProperty("address",RetkQueries.hex(a));out.addProperty("endAddress",RetkQueries.hex(set.getMaxAddress()));out.addProperty("kind",kind);out.addProperty("reason",reason);out.addProperty("timeoutSeconds",timeout);out.addProperty("coverage","scoped");out.addProperty("globalAnalysisComplete",false);out.addProperty("xrefsComplete",false);
        String state=RetkMutations.digest(observe(set,parent));out.addProperty("before",state);out.addProperty("after","analysis-pending");
        JsonObject cache=JsonParser.parseString(program.getOptions("REToolkit Bridge").getString("analysisCoverage","{}")).getAsJsonObject();String key=key(out);
        if(cache.has(key)){JsonObject entry=cache.getAsJsonObject(key);if(entry.get("revision").getAsLong()==revision&&entry.get("state").getAsString().equals(state)){if(kind.equals("function")){if(f==null)throw bad("Cached function entry no longer exists");validateFunctionFlow(f.getBody(),parent);}out.addProperty("after",state);out.addProperty("noop",true);}}
        return out;
    }
    // Only an existing, disjoint exact entry qualifies as a tail dependency.
    boolean knownArm64TailBranch(Instruction instruction,Address target,AddressSetView body){
        if(!program.getLanguageID().toString().equals("AARCH64:LE:64:v8A")||!instruction.getMnemonicString().equalsIgnoreCase("B"))return false;
        var flow=instruction.getFlowType();
        if(!flow.isJump()||flow.isCall()||flow.isConditional()||flow.isComputed()||instruction.getFallThrough()!=null)return false;
        Address[] targets=instruction.getFlows();if(targets.length!=1||!targets[0].equals(target)||body.contains(target))return false;
        Function callee=program.getFunctionManager().getFunctionAt(target);
        return callee!=null&&callee.getEntryPoint().equals(target)&&!callee.getBody().intersects(body);
    }
    void validateFunctionFlow(AddressSetView body,TaskMonitor scoped)throws CancelledException{
        var code=program.getListing().getInstructions(body,true);while(code.hasNext()){scoped.checkCancelled();Instruction i=code.next();Address fall=i.getFallThrough();if(fall!=null&&!body.contains(fall))throw bad("Function flow is incomplete; expand scope");if(!i.getFlowType().isCall())for(Address target:i.getFlows())if(!body.contains(target)&&!knownArm64TailBranch(i,target,body))throw bad("Branch leaves scope; inspect dependency and expand scope");if(i.getFlowType().isComputed()&&!i.getFlowType().isCall())throw bad("Indirect branch needs explicit control-flow recovery; scoped function is not complete");}
    }
    public void apply(JsonObject p,long nextRevision)throws Exception{
        AddressSet set=range(p);Address a=set.getMinAddress();String kind=p.get("kind").getAsString();long deadline=System.nanoTime()+p.get("timeoutSeconds").getAsLong()*1000000000L;
        TaskMonitor scoped=new TaskMonitorAdapter(true){public boolean isCancelled(){return parent.isCancelled()||System.nanoTime()>=deadline||super.isCancelled();}public void checkCancelled()throws CancelledException{parent.checkCancelled();if(isCancelled())throw new CancelledException();}};
        String state;
        try{
            scoped.checkCancelled();
            if(!kind.equals("stack")){
                DisassembleCommand cmd=new DisassembleCommand(a,set,true);cmd.enableCodeAnalysis(false);boolean ok=cmd.applyTo(program,scoped);scoped.checkCancelled();if(!ok)throw bad("Disassembly failed: "+cmd.getStatusMsg());
                var decoded=program.getListing().getInstructions(set,true);while(decoded.hasNext()){Instruction i=decoded.next();if(!set.contains(i.getMinAddress(),i.getMaxAddress()))throw bad("Instruction crosses scope; expand the explicit end address");}
                if(program.getListing().getInstructionAt(a)==null)throw bad("No instruction decoded at requested start");
            }
            if(kind.equals("function")){
                AddressSetView body=CreateFunctionCmd.getFunctionBody(program,a,scoped);if(body.isEmpty()||!set.contains(body))throw bad("Decoded function extends outside scope");
                // Reject truncated flow; calls remain dependencies for the agent to select separately.
                validateFunctionFlow(body,scoped);
                Function f=program.getFunctionManager().getFunctionAt(a);if(f==null)program.getFunctionManager().createFunction(null,a,body,SourceType.ANALYSIS);else f.setBody(body);
            }else if(kind.equals("stack")){
                NewFunctionStackAnalysisCmd cmd=new NewFunctionStackAnalysisCmd(a,false);boolean ok=cmd.applyTo(program,scoped);scoped.checkCancelled();if(!ok)throw bad("Stack analysis failed: "+cmd.getStatusMsg());
            }
            scoped.checkCancelled();
            state=RetkMutations.digest(observe(set,scoped));scoped.checkCancelled();
        }catch(CancelledException e){throw RetkQueries.error("analysis_cancelled","Scoped analysis canceled or exceeded its deadline; changes rolled back");}
        p.addProperty("after",state);
        var options=program.getOptions("REToolkit Bridge");JsonObject cache=JsonParser.parseString(options.getString("analysisCoverage","{}")).getAsJsonObject();JsonObject entry=new JsonObject();entry.addProperty("revision",nextRevision);entry.addProperty("state",state);cache.add(key(p),entry);while(cache.size()>128)cache.remove(cache.keySet().iterator().next());options.setString("analysisCoverage",cache.toString());
    }
}
