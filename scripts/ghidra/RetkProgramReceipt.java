// Attest the selected program without modifying it. Used after import and for
// read-only resume validation. API: https://ghidra.re/ghidra_docs/api/ghidra/program/model/listing/Program.html
// @category REToolkit
import ghidra.app.script.GhidraScript;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.charset.StandardCharsets;

public class RetkProgramReceipt extends GhidraScript {
    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length != 3 || currentProgram == null) {
            throw new IllegalStateException("Expected receipt path, native SHA-256 and program name");
        }
        String digest = currentProgram.getExecutableSHA256();
        String name = currentProgram.getName();
        if (digest == null || !digest.equalsIgnoreCase(args[1]) || !name.equals(args[2]) || currentProgram.getMemory().getBlocks().length == 0) {
            throw new IllegalStateException("Program identity or loaded memory does not match selected native input");
        }
        String safeName = name.replace("\\", "\\\\").replace("\"", "\\\"");
        Files.writeString(Path.of(args[0]), "{\"sha256\":\"" + digest.toLowerCase() + "\",\"program\":\"" + safeName + "\"}", StandardCharsets.UTF_8);
    }
}
