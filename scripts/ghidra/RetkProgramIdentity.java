import com.google.gson.*;
import ghidra.program.model.listing.Program;
import java.nio.file.*;
import java.io.*;
import java.security.*;

/** Input and DomainFile identity checked before serving each Program operation. */
public final class RetkProgramIdentity {
    final Program program; final JsonObject config; final JsonObject identity;
    public RetkProgramIdentity(Program program, JsonObject config) throws Exception {
        this.program=program; this.config=config;
        if (!program.getName().equals(config.get("program").getAsString()) || program.getMemory().getBlocks().length==0 ||
            !program.getExecutableSHA256().equalsIgnoreCase(config.getAsJsonObject("native").get("sha256").getAsString()))
            throw RetkQueries.error("program_mismatch","Selected Program does not match native input");
        String expected=config.has("programPath")?config.get("programPath").getAsString():"/"+program.getName();
        if(!program.getDomainFile().getPathname().equals(expected)) throw RetkQueries.error("program_mismatch","Unexpected Program DomainFile path");
        var locator=program.getDomainFile().getProjectLocator();
        if(!locator.getName().equals(config.get("projectName").getAsString()) || !locator.getMarkerFile().getParentFile().toPath().toRealPath().equals(Path.of(config.get("projectDir").getAsString()).toRealPath()))
            throw RetkQueries.error("program_mismatch","Unexpected Ghidra project location");
        identity=new JsonObject();identity.addProperty("program",program.getName());identity.addProperty("programPath",program.getDomainFile().getPathname());
        identity.addProperty("sha256",program.getExecutableSHA256().toLowerCase());identity.addProperty("imageBase",RetkQueries.hex(program.getImageBase()));
        identity.addProperty("language",program.getLanguageID().toString()); identity.addProperty("projectName",locator.getName());
        identity.addProperty("compiler",program.getCompilerSpec().getCompilerSpecID().toString());identity.addProperty("addressSpace",program.getAddressFactory().getDefaultAddressSpace().getName());identity.addProperty("ghidraVersion",ghidra.framework.Application.getApplicationVersion());identity.addProperty("analysisStatus","unknown");
        validate();
    }
    public void validate() throws Exception {
        for(String key:new String[]{"native","metadata"}) {
            JsonObject input=config.getAsJsonObject(key);
            if(input==null || !hash(Path.of(input.get("path").getAsString())).equalsIgnoreCase(input.get("sha256").getAsString()))
                throw RetkQueries.error("input_changed","Selected "+key+" changed; stop and restart session");
        }
    }
    public static String hash(Path path) throws Exception {MessageDigest d=MessageDigest.getInstance("SHA-256");try(InputStream in=Files.newInputStream(path)){byte[] b=new byte[65536];int n;while((n=in.read(b))!=-1)d.update(b,0,n);}return java.util.HexFormat.of().formatHex(d.digest());}
}
