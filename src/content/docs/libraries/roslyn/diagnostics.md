---
title: Diagnostics
description: Cache-safe diagnostics, Result of T, ReportDiagnostics and partial-type validation.
sidebar:
  order: 4
---

A `DiagnosticDescriptor` has no value equality and a `Location` pins a syntax tree, so neither can sit in a pipeline value. Haitch.Roslyn provides cache-safe stand-ins and a railway-style `Result<T>` that splits a pipeline into reported diagnostics and successful values.

## LocationInfo and DiagnosticInfo

`LocationInfo(string FilePath, TextSpan Span, LinePositionSpan LineSpan)` is a value-equal location. `LocationInfo.From(location)` returns `null` for locations that are not in a source or external file, and `ToLocation()` converts back.

`ToLocation(Compilation)` and `DiagnosticInfo.ToDiagnostic(Compilation)` bind the location to one of the compilation's syntax trees, so the diagnostic honours `#pragma warning disable`. If no single tree matches the file path, or the span is out of range for it, they fall back to the external-file location that `ToLocation()` returns. Use the parameterless versions only for locations outside the compilation, such as additional files.

`DiagnosticInfo` is a value-equal diagnostic: a descriptor, an optional `LocationInfo`, and message arguments.

```csharp
var info = new DiagnosticInfo(descriptor, syntax.Location, type.Name);

// or, from a live Location:
var info2 = DiagnosticInfo.Create(descriptor, location, type.Name);

Diagnostic diagnostic = info.ToDiagnostic();
Diagnostic bound = info.ToDiagnostic(compilation); // suppressible by #pragma
```

Keep `DiagnosticDescriptor` instances in `static readonly` fields, so every run passes the same instance.

## Result&lt;T&gt;

`Result<T>` carries either one value or one or more diagnostics, never both. `T` must implement `IEquatable<T>`, which every model does.

```csharp
Result<TypeModel> ok = type;                       // implicit Success
Result<TypeModel> failed = new DiagnosticInfo(descriptor, syntax.Location, type.Name); // implicit Failure

Result<TypeModel> explicitOk = Result<TypeModel>.Success(type);
Result<TypeModel> explicitFail = Result<TypeModel>.Failure(diagnosticInfo);
```

Members: `IsSuccess`, `Diagnostics`, `TryGetValue(out T value)`, `Map`, `Bind` and `Match(onSuccess, onFailure)`. There is no direct value accessor, so the diagnostic path has to be handled.

`Map` transforms the value and `Bind` chains a step that itself returns a `Result`. Both keep a failure's diagnostics untouched, and the result type must implement `IEquatable<TResult>`.

```csharp
Result<string> name = result.Map(t => t.Name);

Result<TypeModel> notStatic = result.Bind(t => t.IsStatic
    ? Result<TypeModel>.Failure(info)
    : Result<TypeModel>.Success(t));
```

```csharp
string text = result.Match(
    onSuccess: type => type.Name,
    onFailure: diagnostics => $"{diagnostics.Count} problem(s)");
```

`Result<T>.Failure(EquatableArray<DiagnosticInfo>)` throws if the array is empty. When `T` is `DiagnosticInfo` itself the implicit conversions are ambiguous, so call `Success` or `Failure` explicitly.

**`default(Result<T>)` is a failure with no diagnostics.** Guard against it if a value can be uninitialised.

### Combine and Collect

Unlike `Bind`, which stops at the first failure, `Result.Combine` and `Result.Collect` gather every diagnostic so a build reports all problems in one pass.

```csharp
Result<(TypeModel, Settings)> both = Result.Combine(typeResult, settingsResult);
Result<(A, B, C)> three = Result.Combine(a, b, c);

Result<EquatableArray<TypeModel>> all = Result.Collect(results);
```

`Combine` has two- and three-argument overloads. `Collect` takes an `IEnumerable<Result<T>>`; every entry must succeed, an empty input succeeds with an empty array, and a `default` entry fails the whole collection.

## ReportDiagnostics

`ReportDiagnostics` splits a `Result<T>` pipeline in two. It registers the failures for reporting and returns an `IncrementalValuesProvider<T>` of only the successful values, which you register your own output on.

```csharp
IncrementalValuesProvider<TypeModel> valid = types
    .Select(static (item, _) => Validate(item.Type, item.Syntax))
    .ReportDiagnostics(context, "MyGenerator.Validated");

context.RegisterSourceOutput(valid, static (spc, type) => /* generate */);
```

The tracking name is applied to the result step, and `{trackingName}.Diagnostics` to the diagnostics half. Splitting this way lets the engine cache the value step per item, independent of unrelated failures.

Only the diagnostics branch is combined with `CompilationProvider`, so the value and source outputs stay cached. The diagnostics are bound to the compilation's syntax tree, which means `#pragma warning disable` suppresses them.

There is also an overload on `SourceProductionContext` for reporting an `EquatableArray<DiagnosticInfo>` directly:

```csharp
spc.ReportDiagnostics(diagnostics);
spc.ReportDiagnostics(diagnostics, compilation);
```

Pass the `Compilation` when the locations are in the compilation's source, so `#pragma warning disable` can suppress them. Use the overload without it for locations outside the compilation, such as additional files.

## PartialTypeValidation

Generators that add a partial declaration need the target to be partial. `PartialTypeValidation.Validate` checks the three common problems and returns `Result<TypeModel>`, reporting every one that applies.

```csharp
private static readonly PartialTypeDiagnostics Diagnostics = new(
    NotPartial: notPartialDescriptor,
    ContainingTypeNotPartial: containingDescriptor,
    FileLocal: fileLocalDescriptor);

Result<TypeModel> result = PartialTypeValidation.Validate(type, syntax, Diagnostics);
```

| Condition | Descriptor used |
|---|---|
| The type is not `partial` | `NotPartial` |
| A containing type is not `partial` | `ContainingTypeNotPartial` |
| The type is `file`-local | `FileLocal` |

Each descriptor receives the type name as message argument `{0}`. `PartialTypeDiagnostics` is generator configuration: hold it in a `static readonly` field, never as a pipeline value.

### Validating members

A member found by `ForMethodsWithAttribute` and its siblings has no `TypeModel` to validate, and its own `partial` modifier is often irrelevant. `PartialTypeValidation.ValidateContainingTypes` checks only that every containing type is partial, and passes any value through on success.

```csharp
Result<MethodModel> result = PartialTypeValidation.ValidateContainingTypes(
    item.Method,
    item.Syntax,
    ContainingTypeNotPartial,
    item.Method.Name);
```

The descriptor is reported at `syntax.Location` with the last argument as message argument `{0}`. `T` must implement `IEquatable<T>`, which every model does.

Add your own rules by binding on the validated result. For example, rejecting static types:

```csharp
return PartialTypeValidation.Validate(type, syntax, Diagnostics)
    .Bind(t => t.IsStatic
        ? Result<TypeModel>.Failure(new DiagnosticInfo(StaticType, syntax.Location, t.Name))
        : Result<TypeModel>.Success(t));
```
