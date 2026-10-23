# Unity packages and library selection

Read when a reconstructed project lacks a Unity package or library. This is an
agent recipe, not a new MCP installer. Install dependencies supported by project
evidence, rather than the entire list.

## Available version first

The user's policy permits trying a library already in the catalog before seeking
the game's exact release. A release mismatch alone is not a blocker.

1. Inspect installed payloads, catalog, manifest/lock, `.asmdef` references and
   diagnostics. Namespaces are hints, not version evidence. Keep a working
   implementation already present.
2. Choose a confirmed candidate for the required library. Prefer the original
   release if present, then a known compatible installed release, then the highest
   stable available release that passes declared Editor/platform/pipeline and
   dependency constraints. Same-version archives with different bytes remain
   ambiguous until inspected. Do not silently switch an existing implementation
   or render pipeline.
3. Record original requirement, selected version, archive/catalog identity,
   `available-version-trial`, candidate path and validation results in the ledger.
   These are agent notes, not new DTO fields. Preserve original manifest evidence;
   a selected trial is not proof of the game's original release.
4. Send explicit requirements using the candidate's actual `libraryId` and version.
   This replaces default manifest requirements for this plan without rewriting
   historical evidence. Do not send `latest`, `*` or guessed policy fields.
5. Import a ready plan into staging, then run `libraries_verify` on that operation.
   Check compilation, bindings and relevant integration behavior on the same stage.
   Compilation alone does not prove serialization or runtime compatibility.
6. If diagnostics establish an API, assembly, serialization or runtime version
   mismatch, obtain the exact original release next and create a fresh plan.
   Preserve the failed trial. Missing Editors, ownership gates, duplicate types
   and missing assembly references need their own fixes; they do not establish a
   release mismatch. Do not repeat an unchanged failed trial.

Example: original requirement `com.example.library@1.4.0`, catalog only `1.3.0`.
The agent may try `1.3.0`. For MCP `libraries_plan`, use the object below, then
`libraries_import` / `libraries_verify` with its returned operationId. Use real
catalog values; these are illustrative. For CLI `--requirements <file.json>`,
the file contains only the inner requirements object.

```json
{
  "requirements": {
    "kind": "retoolkit-library-requirements",
    "schemaVersion": 1,
    "packages": [{"id": "com.example.library", "version": "1.3.0"}]
  }
}
```

The resolver still validates the chosen package's declared dependency closure,
exact payload, plan freshness and collisions. Relaxing original-release matching
does not make uninspected DLLs or automatic DLL/stub replacement supported.
Staging imports are not automatically merged into the reconstruction branch.

## Common Unity package map

Confirm IDs and versions with the selected Editor's Package Manager and official
versioned manual. Do not apply a Unity 6 package set to a 2021/2022 export.

| Evidence / need | Package ID | Check after installation |
| --- | --- | --- |
| `UnityEngine.UI`, Canvas, EventSystem | `com.unity.ugui` | Serialized UI identities/resources. |
| `TMPro`, `Unity.TextMeshPro` | `com.unity.textmeshpro` on older Editors; merged into `com.unity.ugui` from 2023.2 | Actual provider; avoid duplicate TMP. Preserve font/material GUIDs. |
| `UnityEngine.InputSystem` | `com.unity.inputsystem` | Active Input Handling and input actions; preserve legacy input if used. |
| `Cinemachine` / `Unity.Cinemachine` | `com.unity.cinemachine` | Major-version API and component differences. |
| AddressableAssets, ResourceManager | `com.unity.addressables` | Catalogs/bundles/remote content remain separate inputs. |
| `UnityEngine.Localization` | `com.unity.localization` | Locales, tables and Addressables references. |
| Timeline assets / tracks | `com.unity.timeline` | Track/scene bindings; Playables alone can be an engine API. |
| `Unity.AI.Navigation`, NavMeshSurface | `com.unity.ai.navigation` | Legacy NavMesh usage alone need not require this package. |
| `Unity.Mathematics` | `com.unity.mathematics` | Package dependency metadata and API usage. |
| `Unity.Collections` | `com.unity.collections` | API and assembly constraints. |
| `Unity.Burst` | `com.unity.burst` | Editor/platform support and actual compilation. |
| `Newtonsoft.Json` | `com.unity.nuget.newtonsoft-json` | Existing DLL/source provider and duplicate types. |
| `UnityEngine.Rendering.Universal` | `com.unity.render-pipelines.universal` | Original pipeline/renderer assets; installing does not migrate materials. |
| HighDefinition rendering | `com.unity.render-pipelines.high-definition` | Original pipeline assets/shaders; do not substitute URP. |
| Shader Graph assets | `com.unity.shadergraph` | Pipeline dependency resolution. |
| Visual Effect Graph | `com.unity.visualeffectgraph` | Pipeline/platform support. |
| SpriteSkin / 2D skeletal animation | `com.unity.2d.animation` | Bones, skins and asset versions. |
| Tilemap Extras components | `com.unity.2d.tilemap.extras` | Core Tilemap alone is an engine module. |
| PixelPerfectCamera | `com.unity.2d.pixel-perfect` | Original resolution/camera settings. |
| `UnityEngine.Purchasing` | `com.unity.purchasing` | SDK install does not configure store IDs/purchases. |
| Test assembly dependencies | `com.unity.test-framework` | Editor/test scope, not gameplay implementation. |

Use the exact Editor's [released package index](https://docs.unity3d.com/2022.3/Documentation/Manual/pack-safe.html)
and individual package metadata before selecting a release. The TMP transition
is documented by [Unity's maintainer](https://discussions.unity.com/t/2023-2-latest-development-on-textmesh-pro/917387).
These links describe specific Editor releases; switch to the target's version.

## Engine modules and external libraries

`UnityEngine.*Module.dll` usually belongs to the Editor, not a ZIP library.
Check its built-in `com.unity.modules.*` packages: animation, audio, physics,
physics2d, ai, ui, uielements, particlesystem, tilemap, video and unitywebrequest
are examples. Their versions are tied to the Editor; do not download replacement
engine DLLs. Android/iOS build support and SDK/NDK/JDK are Editor modules or
toolchains, not registry libraries. See [Unity built-in packages](https://docs.unity3d.com/2022.3/Documentation/Manual/pack-build.html).

DOTween (`DG.Tweening`), UniTask (`Cysharp.Threading.Tasks`), Spine, Odin,
FairyGUI, Firebase and private game libraries such as ZeroX are not automatically
provided by Unity's registry. Use configured local libraries or a verified vendor
source within task scope; do not invent `com.unity.*` IDs. DOTween's local 1.2.335
snapshot may be a trial for a different original release, but uninspected DLL or
collision guards still apply. Renaming a stub does not supply its implementation.

## Installing official registry packages

Use the available `unity-package-management` skill if installed. Otherwise use
the selected Editor's `UnityEditor.PackageManager.Client` API via an Editor-only
helper on the authorized candidate project. REToolkit `libraries_*` MCP tools
import local catalog ZIPs; they do not download registry packages or expose
arbitrary Editor methods. Registry installation needs a shell/Editor route.
If that route is unavailable, record the capability gap.

Record the deduplicated IDs, selected versions and candidate path before mutation.
Within already authorized reconstruction scope, proceed without asking again
for routine package installation. Inspect metadata against the exact Editor;
an original-release mismatch alone does not require seeking that exact release.

Use `Client.List` for resolved packages and `Client.Search` for registry candidates.
Serialize Client requests. Install selected `id@version` with `Client.Add`, or
`Client.AddAndRemove` where supported. Wait through `EditorApplication.update`,
inspect request errors and persist resolved identities. In batch mode launch
the Editor directly without `-quit` for asynchronous installation; let the helper
record the outcome and exit. A blocking loop prevents updates. If a domain reload
interrupts it, inspect current resolution before retrying. Existing compilation
errors can prevent a helper from running: report the bootstrap blocker instead
of claiming installation succeeded. Do not fake resolution by hand-editing the
manifest/lock or deleting existing DLLs to force compilation.

Read resolved identities, manifest/lock and Editor diagnostics, then rerun compile
and binding/integration checks for the same candidate. Package changes stale
earlier validation. Keep installed, compiled, bindings checked and gameplay
verified separate. Check TMP resources separately; preserve recovered fonts,
materials and `.meta` identities rather than overwriting them with sample defaults.
See [Unity Package Manager API](https://docs.unity3d.com/2022.3/Documentation/Manual/upm-api.html)
and [Client.AddAndRemove](https://docs.unity3d.com/2022.3/Documentation/ScriptReference/PackageManager.Client.AddAndRemove.html).
