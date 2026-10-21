// Runs only in disposable staging projects. The supervisor owns the deadline.
// Resolve returns void; observe completion with update and a subsequent List request.
// https://docs.unity3d.com/2022.3/Documentation/ScriptReference/PackageManager.Client.Resolve.html
// https://docs.unity3d.com/2022.3/Documentation/ScriptReference/PackageManager.Client.List.html
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using UnityEditor;
using UnityEditor.PackageManager;
using UnityEditor.PackageManager.Requests;
using UnityEngine;

namespace REToolkit
{
    [InitializeOnLoad]
    public static class LibraryImport
    {
        const string SessionKey = "REToolkit.LibraryImport.Request";
        const string ReportKey = "REToolkit.LibraryImport.Report";
        [Serializable] public sealed class Package { public string id; public string version; }
        [Serializable] public sealed class Request
        {
            public string kind; public int schemaVersion; public string operationId;
            public string unityVersion; public Package[] packages;
        }
        [Serializable] public sealed class Diagnostic { public string severity; public string message; }
        [Serializable] public sealed class Report
        {
            public string kind = "retoolkit-library-import-observation"; public int schemaVersion = 1;
            public string operationId; public bool complete; public bool success;
            public List<Package> packages = new List<Package>();
            public List<Diagnostic> diagnostics = new List<Diagnostic>();
        }
        static Request request;
        static Report report;
        static string reportFile;
        static ListRequest pending;
        static double quietAfter;
        static bool finished;

        static LibraryImport()
        {
            if (!String.IsNullOrEmpty(SessionState.GetString(SessionKey, "")))
                EditorApplication.delayCall += Resume;
        }
        static string Argument(string name)
        {
            var args = Environment.GetCommandLineArgs();
            string result = null;
            for (int i = 0; i < args.Length; i++)
                if (args[i] == name)
                {
                    if (result != null || i + 1 >= args.Length) throw new InvalidDataException("Invalid fixed import arguments.");
                    result = args[++i];
                }
            if (String.IsNullOrEmpty(result)) throw new InvalidDataException("Missing fixed import argument.");
            return Path.GetFullPath(result);
        }
        static void Load(string requestFile, string outputFile)
        {
            var control = Directory.GetParent(Directory.GetParent(Application.dataPath).FullName).FullName;
            if (Path.GetDirectoryName(requestFile) != control || Path.GetDirectoryName(outputFile) != control || requestFile == outputFile)
                throw new InvalidDataException("Import control files must be siblings of the staging project.");
            var info = new FileInfo(requestFile);
            if (!info.Exists || info.Length > 1024 * 1024) throw new InvalidDataException("Invalid import request size.");
            request = JsonUtility.FromJson<Request>(File.ReadAllText(requestFile, new UTF8Encoding(false, true)));
            Guid operation;
            if (request == null || request.kind != "retoolkit-library-import-request" || request.schemaVersion != 1 ||
                !Guid.TryParseExact(request.operationId, "D", out operation) || request.unityVersion != Application.unityVersion ||
                request.packages == null || request.packages.Length > 256)
                throw new InvalidDataException("Invalid bound import request.");
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var p in request.packages)
                if (p == null || String.IsNullOrEmpty(p.id) || p.id.Length > 256 || String.IsNullOrEmpty(p.version) || p.version.Length > 128 || !seen.Add(p.id))
                    throw new InvalidDataException("Invalid import package identity.");
            reportFile = outputFile;
            report = new Report { operationId = request.operationId };
            finished = false;
            quietAfter = EditorApplication.timeSinceStartup + 2;
            Application.logMessageReceived -= OnLog;
            Application.logMessageReceived += OnLog;
            EditorApplication.update -= Poll;
            EditorApplication.update += Poll;
        }
        public static void Run()
        {
            try
            {
                var input = Argument("-retkRequest");
                var output = Argument("-retkReport");
                Load(input, output);
                SessionState.SetString(SessionKey, input);
                SessionState.SetString(ReportKey, output);
                Client.Resolve();
            }
            catch (Exception error) { Fail(error.Message); }
        }
        static void Resume()
        {
            if (request != null || finished) return;
            try { Load(SessionState.GetString(SessionKey, ""), SessionState.GetString(ReportKey, "")); }
            catch (Exception error) { Fail(error.Message); }
        }
        static void OnLog(string message, string stack, LogType type)
        {
            if (report == null || report.diagnostics.Count >= 1000) return;
            if (type == LogType.Error || type == LogType.Exception || type == LogType.Assert)
                report.diagnostics.Add(new Diagnostic { severity = "error", message = Clip(message) });
            else if (type == LogType.Warning)
                report.diagnostics.Add(new Diagnostic { severity = "warning", message = Clip(message) });
        }
        static string Clip(string message) { return message.Length > 8192 ? message.Substring(0, 8192) : message; }
        static void Poll()
        {
            if (finished || request == null) return;
            try
            {
                if (EditorApplication.isCompiling || EditorApplication.isUpdating)
                {
                    quietAfter = EditorApplication.timeSinceStartup + 2;
                    return;
                }
                if (EditorApplication.timeSinceStartup < quietAfter) return;
                if (pending == null) { pending = Client.List(true, true); return; }
                if (!pending.IsCompleted) return;
                if (pending.Status != StatusCode.Success) { Fail(pending.Error == null ? "Package listing failed." : pending.Error.message); return; }
                foreach (var expected in request.packages)
                {
                    UnityEditor.PackageManager.PackageInfo found = null;
                    foreach (var candidate in pending.Result) if (candidate.name == expected.id) { found = candidate; break; }
                    var target = Path.GetFullPath(Path.Combine(Directory.GetParent(Application.dataPath).FullName, "Packages", expected.id));
                    if (found == null || found.version != expected.version || found.source != PackageSource.Embedded ||
                        !String.Equals(Path.GetFullPath(found.resolvedPath).TrimEnd(Path.DirectorySeparatorChar), target, StringComparison.OrdinalIgnoreCase))
                    { Fail("Requested embedded package did not resolve: " + expected.id); return; }
                    report.packages.Add(new Package { id = found.name, version = found.version });
                }
                report.complete = true;
                report.success = !report.diagnostics.Exists(d => d.severity == "error");
                Finish();
            }
            catch (Exception error) { Fail(error.Message); }
        }
        static void Fail(string message)
        {
            if (report == null) report = new Report { operationId = request == null ? "" : request.operationId };
            if (report.diagnostics.Count < 1000) report.diagnostics.Add(new Diagnostic { severity = "error", message = Clip(message) });
            report.complete = false; report.success = false;
            Finish();
        }
        static void Finish()
        {
            if (finished) return;
            finished = true;
            EditorApplication.update -= Poll;
            Application.logMessageReceived -= OnLog;
            SessionState.EraseString(SessionKey);
            SessionState.EraseString(ReportKey);
            try
            {
                var bytes = new UTF8Encoding(false).GetBytes(JsonUtility.ToJson(report, true));
                if (bytes.Length > 16 * 1024 * 1024 || String.IsNullOrEmpty(reportFile)) throw new InvalidDataException("Invalid import report output.");
                using (var output = new FileStream(reportFile, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                { output.Write(bytes, 0, bytes.Length); output.Flush(true); }
            }
            catch { EditorApplication.Exit(2); return; }
            EditorApplication.Exit(report.complete && report.success ? 0 : 1);
        }
    }
}
