// Syntax-only analyzer. Target source is parsed as data, never compiled or loaded.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

internal static class REToolkitSourceContract
{
    private const int MaximumDeclarations = 10000;
    private static readonly CSharpParseOptions Options = new CSharpParseOptions(LanguageVersion.Latest, DocumentationMode.Parse, SourceCodeKind.Regular);
    private sealed class ConstructorSelector { public string fullName { get; set; } public string kind { get; set; } }
    private sealed class Document { public string path { get; set; } public string source { get; set; } public ConstructorSelector[] omitConstructors { get; set; } }
    private sealed class Body { public int Start; public int End; public string Kind; }

    private static string TypeName(SyntaxNode node)
    {
        if (node is BaseTypeDeclarationSyntax t) return t.Identifier.ValueText;
        return ((DelegateDeclarationSyntax)node).Identifier.ValueText;
    }
    private static int Arity(SyntaxNode node)
    {
        if (node is TypeDeclarationSyntax t) return t.TypeParameterList?.Parameters.Count ?? 0;
        if (node is DelegateDeclarationSyntax d) return d.TypeParameterList?.Parameters.Count ?? 0;
        return 0;
    }
    private static bool IsType(SyntaxNode n) => n is BaseTypeDeclarationSyntax || n is DelegateDeclarationSyntax;
    private static string MetadataName(SyntaxNode node) => TypeName(node) + (Arity(node) == 0 ? "" : "`" + Arity(node).ToString(CultureInfo.InvariantCulture));
    private static string Namespace(SyntaxNode node) => string.Join(".", node.Ancestors().OfType<BaseNamespaceDeclarationSyntax>().Reverse().Select(n => string.Concat(n.Name.DescendantTokens().Select(t => t.ValueText))));
    private static string FullName(SyntaxNode node)
    {
        string names = string.Join("+", node.AncestorsAndSelf().Where(IsType).Reverse().Select(MetadataName));
        string ns = Namespace(node);
        return ns.Length == 0 ? names : ns + "." + names;
    }
    private static object TypeRow(SyntaxNode node)
    {
        var parent = node.Ancestors().FirstOrDefault(IsType);
        var declaration = node as BaseTypeDeclarationSyntax;
        string kind = node is ClassDeclarationSyntax ? "class" : node is StructDeclarationSyntax ? "struct" : node is InterfaceDeclarationSyntax ? "interface" : node is EnumDeclarationSyntax ? "enum" : node is DelegateDeclarationSyntax ? "delegate" : "record";
        return new { fullName = FullName(node), name = TypeName(node), @namespace = Namespace(node), kind, arity = Arity(node), topLevel = parent == null, declaringType = parent == null ? null : FullName(parent), baseTypes = declaration?.BaseList?.Types.Select(t => string.Concat(t.Type.DescendantTokens().Select(token => token.Text))).ToArray() ?? Array.Empty<string>() };
    }
    private static void AddBody(List<Body> bodies, SyntaxNode node, string kind)
    {
        if (node != null) bodies.Add(new Body { Start = node.SpanStart, End = node.Span.End, Kind = kind });
    }
    private static string ConstructorKind(ConstructorDeclarationSyntax node) => node.Modifiers.Any(t => t.IsKind(SyntaxKind.StaticKeyword)) ? "static" : "instance";
    private static string TokensHash(SyntaxNode root, ConstructorDeclarationSyntax[] omitted)
    {
        var tokens = new StringBuilder();
        foreach (var token in root.DescendantTokens())
        {
            if (omitted.Any(node => token.SpanStart >= node.SpanStart && token.Span.End <= node.Span.End)) continue;
            tokens.Append(token.RawKind).Append(':').Append(token.Text.Length).Append(':').Append(token.Text).Append(';');
        }
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(tokens.ToString()))).ToLowerInvariant();
    }
    private static object Analyze(Document document)
    {
        if (document.source == null || Encoding.UTF8.GetByteCount(document.source) > 1024 * 1024) throw new InvalidDataException("Source exceeds 1 MiB");
        var tree = CSharpSyntaxTree.ParseText(document.source, Options, document.path ?? "source.cs", Encoding.UTF8);
        var root = tree.GetRoot();
        var nodes = root.DescendantNodesAndSelf().ToArray();
        var members = nodes.OfType<MemberDeclarationSyntax>().ToArray();
        int declarationCount = members.Length + nodes.OfType<VariableDeclaratorSyntax>().Count() - nodes.OfType<BaseFieldDeclarationSyntax>().Count() + nodes.OfType<AccessorDeclarationSyntax>().Count();
        bool declarationLimit = declarationCount > MaximumDeclarations;
        var types = nodes.Where(IsType).ToArray();
        var trivia = root.DescendantTrivia(descendIntoTrivia: true).ToArray();
        bool syntaxInvalid = tree.GetDiagnostics().Any(d => d.Severity == DiagnosticSeverity.Error) || root.DescendantTokens(descendIntoTrivia: true).Any(t => t.IsMissing) || trivia.Any(t => t.IsKind(SyntaxKind.SkippedTokensTrivia));
        bool conditional = trivia.Any(t => t.IsDirective || t.IsKind(SyntaxKind.DisabledTextTrivia));
        bool partial = members.Any(n => n.ChildTokens().Any(t => t.IsKind(SyntaxKind.PartialKeyword)));
        bool unsupported = nodes.Any(n => n is GlobalStatementSyntax || n is RecordDeclarationSyntax || n is IncompleteMemberSyntax);
        bool duplicate = types.GroupBy(FullName).Any(g => g.Count() != 1);
        string reason = declarationLimit ? "Source exceeds 10000 declarations" : syntaxInvalid ? "Malformed C# syntax or missing tokens" : conditional ? "Directives and disabled text are unsupported" : partial ? "Partial declarations are unsupported" : unsupported ? "Unsupported declaration shape" : duplicate ? "Ambiguous duplicate type identity" : null;
        bool supported = reason == null;
        var constructors = nodes.OfType<ConstructorDeclarationSyntax>().ToArray();
        var omitted = new List<ConstructorDeclarationSyntax>();
        foreach (var selector in document.omitConstructors ?? Array.Empty<ConstructorSelector>())
        {
            var matches = constructors.Where(node => node.Parent is ClassDeclarationSyntax && FullName(node.Parent) == selector.fullName && ConstructorKind(node) == selector.kind && node.ParameterList.Parameters.Count == 0).ToArray();
            if (matches.Length != 1 || omitted.Contains(matches[0])) throw new InvalidDataException("Missing or ambiguous omitted constructor");
            omitted.Add(matches[0]);
        }
        var bodies = new List<Body>();
        foreach (var node in nodes)
        {
            if (node is BaseMethodDeclarationSyntax method)
            {
                AddBody(bodies, method.Body, "method-block");
                AddBody(bodies, method.ExpressionBody, "method-expression");
            }
            else if (node is AccessorDeclarationSyntax accessor)
            {
                AddBody(bodies, accessor.Body, "accessor-block");
                AddBody(bodies, accessor.ExpressionBody, "accessor-expression");
            }
            else if (node is PropertyDeclarationSyntax property) AddBody(bodies, property.ExpressionBody, "property-expression");
            else if (node is IndexerDeclarationSyntax indexer) AddBody(bodies, indexer.ExpressionBody, "indexer-expression");
        }
        bodies = bodies.OrderBy(b => b.Start).ThenByDescending(b => b.End).ToList();
        var outerBodies = new List<Body>();
        foreach (var body in bodies)
        {
            if (outerBodies.Count != 0 && body.Start < outerBodies[outerBodies.Count - 1].End)
            {
                if (body.End > outerBodies[outerBodies.Count - 1].End) throw new InvalidDataException("Overlapping executable bodies");
                continue;
            }
            outerBodies.Add(body);
        }
        // Token kind plus exact token text preserves identifiers, literal spellings,
        // initializers, attributes and punctuation; trivia cannot change syntax here.
        // Bodies have explicit kind markers so declaration/body forms stay strict.
        var skeleton = new StringBuilder();
        int index = 0;
        foreach (var token in root.DescendantTokens())
        {
            while (index < outerBodies.Count && token.SpanStart >= outerBodies[index].End) index++;
            if (index < outerBodies.Count && token.SpanStart >= outerBodies[index].Start && token.Span.End <= outerBodies[index].End)
            {
                if (token.SpanStart == outerBodies[index].Start) skeleton.Append("BODY:").Append(outerBodies[index].Kind).Append(';');
                continue;
            }
            skeleton.Append(token.RawKind).Append(':').Append(token.Text.Length).Append(':').Append(token.Text).Append(';');
        }
        string hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(skeleton.ToString()))).ToLowerInvariant();
        // Blank directive lines for this conservative second lexer pass. It sees
        // identifiers in inactive branches too; uncertainty is surfaced separately.
        string[] identityNames = supported ? null : SyntaxFactory.ParseTokens(Regex.Replace(document.source, @"(?m)^[\t ]*#[^\r\n]*", ""), options: Options).Where(t => t.IsKind(SyntaxKind.IdentifierToken)).Select(t => t.ValueText).Concat(Regex.Matches(document.source, @"[A-Za-z_][A-Za-z0-9_]*").Cast<Match>().Select(match => match.Value)).Distinct().OrderBy(x => x, StringComparer.Ordinal).ToArray();
        bool identityUncertain = !supported && (Regex.IsMatch(document.source, @"\\[uU]") || document.source.Any(c => c > 127));
        return new { path = document.path, supported, reason, identitiesComplete = !syntaxInvalid && !conditional && !declarationLimit, identityNames, identityUncertain, skeletonSha256 = supported ? hash : null, tokenSha256 = supported ? TokensHash(root, Array.Empty<ConstructorDeclarationSyntax>()) : null, initializationSha256 = supported ? TokensHash(root, omitted.ToArray()) : null,
            constructors = constructors.Select(node => new { fullName = node.Parent is TypeDeclarationSyntax ? FullName(node.Parent) : null, kind = ConstructorKind(node), parameterCount = node.ParameterList.Parameters.Count,
                accessibility = string.Join(" ", node.Modifiers.Where(t => t.IsKind(SyntaxKind.PublicKeyword) || t.IsKind(SyntaxKind.PrivateKeyword) || t.IsKind(SyntaxKind.ProtectedKeyword) || t.IsKind(SyntaxKind.InternalKeyword)).Select(t => t.Text).OrderBy(x => x, StringComparer.Ordinal).DefaultIfEmpty("private")),
                eligible = node.Parent is ClassDeclarationSyntax && node.ParameterList.Parameters.Count == 0 && node.AttributeLists.Count == 0 && node.Initializer == null && node.Body != null && node.ExpressionBody == null && node.SemicolonToken.IsKind(SyntaxKind.None) && node.Identifier.ValueText == TypeName(node.Parent) && node.Modifiers.All(t => t.IsKind(SyntaxKind.StaticKeyword) || t.IsKind(SyntaxKind.PublicKeyword) || t.IsKind(SyntaxKind.PrivateKeyword) || t.IsKind(SyntaxKind.ProtectedKeyword) || t.IsKind(SyntaxKind.InternalKeyword)) }).ToArray(),
            types = types.Select(TypeRow).ToArray(), declarationCount, executableBodyCount = outerBodies.Count };
    }
    public static int Main()
    {
        try
        {
            Console.InputEncoding = new UTF8Encoding(false, true);
            Console.OutputEncoding = new UTF8Encoding(false, true);
            var documents = JsonSerializer.Deserialize<Document[]>(Console.In.ReadToEnd());
            if (documents == null || documents.Length == 0 || documents.Length > 10000) throw new InvalidDataException("Expected 1..10000 documents");
            var results = documents.Select(Analyze).ToArray();
            string output = JsonSerializer.Serialize(new { languageVersion = Options.LanguageVersion.ToString(), documents = results });
            if (Encoding.UTF8.GetByteCount(output) > 2 * 1024 * 1024) throw new InvalidDataException("Analysis output exceeds 2 MiB");
            Console.Write(output);
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.Write("Source contract analysis failed: " + error.GetType().Name);
            return 2;
        }
    }
}
