---
title: Testing generators
description: GeneratorHarness, AssertCacheable and CachingHazardWalker from Haitch.Roslyn.Testing.
sidebar:
  order: 6
---

`Haitch.Roslyn.Testing` is a regular (not source-only) package for your test project. It targets net10.0 and is test-framework agnostic: every failure is a `GeneratorTestException`.

## Installation

```sh
dotnet add package Haitch.Roslyn.Testing --version 0.2.0
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
| `Compilation` | The compilation after generation. |
| `InputCompilation` | The compilation before generation. |
| `Driver` | The driver after the run, for rerunning against a changed compilation. |
| `RunResult` | The driver's run result, including tracked steps. |

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

Step names can be passed as `params string[]` or as an `IEnumerable<string>`, in which case the optional `additionalReferences` and `parseOptions` follow.

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

## CachingHazardWalker

`CachingHazardWalker.Find` is what the harness uses on each tracked output. It returns the member path of the first value that defeats caching, or `null`.

```csharp
string? hazard = CachingHazardWalker.Find(model);

await Assert.That(hazard).IsNull();
```

It reports Roslyn symbols, syntax nodes and trees, semantic models, compilations, locations and diagnostics, arrays, `ImmutableArray<T>`, and classes without an `Equals` override. A path looks like `Item1.Members[0].Symbol`. `EquatableArray<T>` is walked element by element.

The walker can report false positives: BCL types with internal state that override `Equals` are walked field by field, and value-equal collection wrappers other than `EquatableArray<T>` are reported if they hold a hazard or lack an `Equals` override. Models nested deeper than 256 levels are reported.
