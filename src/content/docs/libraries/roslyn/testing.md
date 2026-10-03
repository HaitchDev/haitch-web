---
title: Testing generators
description: GeneratorHarness, harness input, diagnostic and output assertions, AssertCacheable and CachingHazardWalker from Haitch.Roslyn.Testing.
sidebar:
  order: 6
---

`Haitch.Roslyn.Testing` is a regular (not source-only) package for your test project. It targets net10.0 and is test-framework agnostic: every failure is a `GeneratorTestException`.

## Installation

```sh
dotnet add package Haitch.Roslyn.Testing --version 0.4.0
```

## GeneratorHarness.Run

`Run` compiles in-memory sources (nullable enabled, the test host's platform references), runs the generator with step tracking, and returns a `GeneratorHarnessResult`.

```csharp
var result = GeneratorHarness.Run(new MyGenerator(), ["[My] public partial class Foo;"]);

// TUnit assertion; any framework works
await Assert.That(result.Sources).ContainsKey("Foo.g.cs");
```

Optional parameters: `additionalReferences` (extra `MetadataReference`s) and `parseOptions` (defaults to the latest language version).

`Run` throws `GeneratorTestException` if the generator throws, or if the input or the generated output has compile errors. Errors are checked **after** generation, so inputs may use post-initialization types such as marker attributes.

| `GeneratorHarnessResult` member | Contents |
|---|---|
| `Sources` | Generated text keyed by hint name. |
| `Diagnostics` | Diagnostics reported by the generator itself, not compiler diagnostics. |
| `InputDiagnostics` | Error diagnostics the input compilation reported before generation that remain after it. Empty unless `AllowInputErrors` let them through. |
| `Compilation` | The compilation after generation. |
| `InputCompilation` | The compilation before generation. |
| `Driver` | The driver after the run, for rerunning against a changed compilation. |
| `RunResult` | The driver's run result, including tracked steps. |

## GeneratorHarnessInput

`Run` and `AssertCacheable` also take a `GeneratorHarnessInput`, which carries everything the harness feeds the generator. The overloads that take a `string` list delegate to it, so 0.3 callers compile unchanged.

```csharp
var result = GeneratorHarness.Run(
    new TextConstantsGenerator(),
    new GeneratorHarnessInput
    {
        Sources = ["class Input { }"],
        AdditionalTexts = [new("docs/greeting.txt", "Hello")],
        GlobalOptions = new Dictionary<string, string>
        {
            ["build_property.RootNamespace"] = "App",
        },
        PerFileOptions = new Dictionary<string, IReadOnlyDictionary<string, string>>
        {
            ["docs/greeting.txt"] = new Dictionary<string, string>
            {
                ["build_metadata.AdditionalFiles.ConstantName"] = "Welcome",
            },
        },
    });
```

| Property | Meaning |
|---|---|
| `Sources` | Required. The C# source texts of the input compilation. |
| `AdditionalReferences` | Extra `MetadataReference`s. The test host's platform references are always included. |
| `ParseOptions` | Defaults to the latest language version. |
| `AdditionalTexts` | `HarnessAdditionalText(Path, Text)` records handed to the generator as additional files. |
| `GlobalOptions` | Global analyzer-config options, such as `build_property.RootNamespace`. |
| `PerFileOptions` | Analyzer-config options keyed by file path, such as `build_metadata.AdditionalFiles.ConstantName`. |
| `AllowInputErrors` | Lets errors that exist before generation through; see [below](#input-errors). |

Option keys are passed through verbatim, so write the full `build_property.` or `build_metadata.AdditionalFiles.` prefix. Lookups are case-insensitive, like the compiler's. A source tree's path in `PerFileOptions` is `Source{i}.cs` (zero-based, in `Sources` order); an additional text's path is its `HarnessAdditionalText.Path`.

### Input errors

By default `Run` throws `GeneratorTestException` when the input compilation has errors that remain after generation. Set `AllowInputErrors = true` to test how a generator behaves on broken input, such as a syntax error or a missing type.

```csharp
var result = GeneratorHarness.Run(
    new MyGenerator(),
    new GeneratorHarnessInput
    {
        Sources = ["[My] public partial class Foo { int x = ; }"],
        AllowInputErrors = true,
    });

await Assert.That(result.InputDiagnostics).IsNotEmpty();
```

The errors the input already had are exposed on `InputDiagnostics` and no longer fail the run. An error that is new after generation still throws, wherever it is located, so a generator that breaks the user's code is still caught.

## Diagnostic assertions

These extension methods on `GeneratorHarnessResult` check the generator's own diagnostics, not compiler diagnostics. Each throws `GeneratorTestException` and lists the actual diagnostics when it fails.

- **`AssertNoDiagnostics()`** requires that the generator reported nothing. It returns the result, so calls chain.
- **`AssertDiagnostic(id, ...)`** requires exactly one diagnostic with that id that matches every filter you pass, and returns it. Two matches fail as well as none. The optional filters are `severity`, `line` and `column` (both 1-based), `file` and `messageContains` (an ordinal substring).

```csharp
result.AssertNoDiagnostics();

Diagnostic diagnostic = result.AssertDiagnostic(
    "SAMPLE001",
    severity: DiagnosticSeverity.Error,
    line: 3,
    column: 14,
    messageContains: "must be partial");
```

## Output assertions

- **`AssertSource(hintName, expected)`** compares a generated source with an inline string.
- **`AssertSourceFile(hintName, path)`** compares it with the content of a file, which keeps large outputs out of the test code.

Both ignore the line-ending style (`\r\n` against `\n`) and nothing else: trailing whitespace counts. A mismatch reports the first line that differs. A missing hint name fails and lists the hint names that exist. Both return the result.

```csharp
result
    .AssertNoDiagnostics()
    .AssertSourceFile("TextConstants.g.cs", "Expected/TextConstants.Two.g.cs.txt");
```

A relative `path` resolves against the directory of the calling test file (the harness reads `[CallerFilePath]`), or pass an absolute path. If the build remaps source paths (`ContinuousIntegrationBuild`, `PathMap`), the caller path is not a real directory and a relative path throws a `GeneratorTestException` asking for an absolute one.

### Accepting output

When the expected file does not exist, or the environment variable `HAITCH_ACCEPT=1` is set, `AssertSourceFile` writes the actual output to the file and **still fails**. The failure is deliberate: the change shows up in version control to be reviewed, and rerunning without the variable passes.

```sh
HAITCH_ACCEPT=1 dotnet test
```

Name the expected files so the compiler does not pick them up, for example with a `.txt` suffix as in the sample above.

## AssertCacheable

`AssertCacheable` runs the generator, reruns it on a cloned compilation, then on one where the first source gained a trailing comment, and requires every output of the named steps to be `Cached` or `Unchanged`. It also fails if a step output holds a caching hazard. It returns the first run's `GeneratorHarnessResult`.

Name the steps with `WithTrackingName` in the generator:

```csharp
// in the generator
var models = context.SyntaxProvider
    .ForAttributeWithMetadataName("My.MyAttribute", (_, _) => true, (ctx, _) => Model.From(ctx))
    .WithTrackingName("Models");

// in the test
GeneratorHarness.AssertCacheable(new MyGenerator(), ["[My] public partial class Foo;"], "Models");
```

Step names can be passed as `params string[]` or as an `IEnumerable<string>`, in which case the optional `additionalReferences` and `parseOptions` follow. To run against additional files or options, pass a `GeneratorHarnessInput` in place of the sources: `AssertCacheable(generator, input, steps, options)`, where `options` is an optional `CacheabilityOptions`.

```csharp
GeneratorHarness.AssertCacheable(new TextConstantsGenerator(), input, ["TextConstantsGenerator.Files"]);
```

`ForTypesWithAttribute` and `ReportDiagnostics` take a tracking name for exactly this purpose.

### CacheabilityOptions

An overload takes a `CacheabilityOptions` after the step names, followed by the optional `additionalReferences` and `parseOptions`. Both options are off by default.

```csharp
GeneratorHarness.AssertCacheable(
    new MyGenerator(),
    ["[My] public partial class Foo;", "public class Other;"],
    ["Models"],
    new CacheabilityOptions
    {
        UnrelatedEditSourceIndex = 1,
        RequireRecomputationAfterTriviaEdit = true,
    });
```

- **`UnrelatedEditSourceIndex`** adds a third run. `namespace HarnessUnrelatedEdit { }` is appended to the source at that index, so the compilation changes but no tracked step should read what changed. Every output of the named steps must still be `Cached` or `Unchanged`; a model that depends on the whole compilation fails here. The index must be at least 1, because source 0 takes the trivia edit, and less than the number of sources, so it needs at least two sources. `null` skips the run.
- **`RequireRecomputationAfterTriviaEdit`** guards against a check that passes only because nothing re-ran. After the trivia edit, every output of each named step must be `Cached` or `Unchanged`, and at least one must be `Unchanged`, meaning the step re-ran for the edited source and produced an equal value. Name the per-item model step: an aggregate such as `Collect` over unchanged items reports `Cached` and fails this check.

Caveats:

- **Name model steps only.** Steps that combine with `CompilationProvider` or output syntax nodes are legitimately `Modified` by the trivia edit.
- **The edit targets the first source**, so put the code your tracked steps read there.
- **An unknown or never-run step name fails**; the message lists the steps that exist.
- **Passing `null` positionally as the fourth argument is ambiguous** between the overloads; use named arguments.

## CachingHazardWalker

`CachingHazardWalker.Find` is what the harness uses on each tracked output. It returns the member path of the first value that defeats caching, or `null`.

```csharp
string? hazard = CachingHazardWalker.Find(model);

await Assert.That(hazard).IsNull();
```

It reports Roslyn symbols, syntax nodes and trees, semantic models, compilations, locations and diagnostics, arrays, `ImmutableArray<T>`, and classes without an `Equals` override. A path looks like `Item1.Members[0].Symbol`. `EquatableArray<T>` is walked element by element.

The walker can report false positives: BCL types with internal state that override `Equals` are walked field by field, and value-equal collection wrappers other than `EquatableArray<T>` are reported if they hold a hazard or lack an `Equals` override. Models nested deeper than 256 levels are reported.
