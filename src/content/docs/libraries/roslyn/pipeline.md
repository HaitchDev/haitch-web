---
title: Pipeline helpers
description: ForTypesWithAttribute and member discovery, build properties, additional files, marker attributes and hint names.
sidebar:
  order: 3
---

The `Haitch.Roslyn.Generators` namespace wraps the common first steps of an attribute-driven generator.

## ForTypesWithAttribute

`ForTypesWithAttribute` is `ForAttributeWithMetadataName` specialised for types. It matches type declarations (classes, records, structs, interfaces) and returns value-equal models instead of live Roslyn objects.

```csharp
IncrementalValuesProvider<(TypeModel Type, SyntaxInfo Syntax, EquatableArray<AttributeModel> Attributes)> types =
    context.SyntaxProvider.ForTypesWithAttribute("My.MyAttribute", "MyGenerator.Types");
```

The second argument is the tracking name given to the step, which the [testing helpers](/libraries/roslyn/testing/) use to look it up. An optional third argument, `includeMembers` (default `false`), is covered [below](#including-members). The provider passes Roslyn's cancellation token to `TypeModel.From`, so a cancelled build stops between members.

Each item holds:

- `Type`: the `TypeModel`, without members unless `includeMembers` is `true`.
- `Syntax`: the `SyntaxInfo`, with the partial flags and a `LocationInfo?` for reporting diagnostics.
- `Attributes`: every application of the attribute on the type.

**One item per type.** A partial type marked on several declarations still yields a single item, and `Attributes` carries the applications from all parts. This is done without `Collect()`, so unrelated edits still leave the step cached.

The provider does not report diagnostics for a bad match, such as a non-partial type. That is your decision; see [Diagnostics](/libraries/roslyn/diagnostics/).

### Including members

```csharp
var types = context.SyntaxProvider.ForTypesWithAttribute(
    "My.MyAttribute", "MyGenerator.Types", includeMembers: true);
```

With `includeMembers: true` the `TypeModel` has its `Fields`, `Properties`, `Methods` and `Events` filled from the symbol, and every part of a partial type contributes. This ties the item's equality to every member edit, so any edit to a member of the type recomputes the downstream steps. Leave it off unless the generator reads members, for example to detect a conflict with a member it is about to generate. The [walkthrough](/libraries/roslyn/walkthrough/) does exactly that.

### Predicate

`ForTypesWithAttribute` and the member providers below take an optional trailing `Func<SyntaxNode, CancellationToken, bool>? predicate`. It runs in the syntax phase, on every edit, after the built-in kind check, so it only ever sees nodes of the kind being discovered and can cast without testing. Keep it cheap and syntax-only, and do not capture state.

```csharp
var types = context.SyntaxProvider.ForTypesWithAttribute(
    "My.MyAttribute",
    "MyGenerator.Types",
    predicate: static (node, _) => ((TypeDeclarationSyntax)node).Modifiers.Any(SyntaxKind.PartialKeyword));
```

## Member discovery

Three more providers find attributed members instead of types. Each takes the attribute's fully qualified metadata name, a tracking name, an optional `includeContainingTypeMembers` flag and the optional predicate, and each yields one item per member.

| Provider | Matches | Item |
|---|---|---|
| `ForMethodsWithAttribute` | Method declarations | `(MethodModel Method, TypeModel ContainingType, SyntaxInfo Syntax, EquatableArray<AttributeModel> Attributes)` |
| `ForPropertiesWithAttribute` | Property declarations | `(PropertyModel Property, TypeModel ContainingType, SyntaxInfo Syntax, EquatableArray<AttributeModel> Attributes)` |
| `ForFieldsWithAttribute` | Field variable declarators | `(FieldModel Field, TypeModel ContainingType, SyntaxInfo Syntax, EquatableArray<AttributeModel> Attributes)` |

```csharp
var fields = context.SyntaxProvider.ForFieldsWithAttribute("Notify.NotifyAttribute", "NotifyGenerator.Fields");

var withSiblings = context.SyntaxProvider.ForFieldsWithAttribute(
    "Notify.NotifyAttribute",
    "NotifyGenerator.Fields",
    includeContainingTypeMembers: true);
```

`includeContainingTypeMembers` comes before `predicate`, so pass a predicate by name when you use either.

- **`ContainingType`** is a `TypeModel` captured without members by default, so the item changes with the member's own shape and not with its siblings. With `includeContainingTypeMembers: true` it carries `Fields`, `Properties`, `Methods`, `Events` and `MemberNames`, as `includeMembers` does for `ForTypesWithAttribute`. That ties the step's equality to every member signature edit of the containing type, so turn it on only when the generator reads sibling members, such as to check that a generated name is free.
- **`Syntax`** describes the member declaration, not the containing type: `IsPartial` is the member's, `AreContainingTypesPartial` covers the whole containing chain, and `Location` is the member's identifier.
- **Fields** are reported per declarator, so `[Mark] int a, b;` yields two items.
- **Partial methods and properties** yield one item, built from the definition part. When both parts carry the attribute, the implementation part is dropped. `Syntax` describes the declaration that carries the attribute.
- **Properties** exclude indexers and events. An attribute targeted at the backing field (`[field: Mark]`) is not on the property, so it does not match.
- **Methods** exclude local functions, lambdas, accessors and constructors.

Members of one type arrive as separate items. To generate one file per type, group the items by `ContainingType` after the per-item step, so the tracked step stays per-item.

To report a bad match, such as a member in a non-partial type, validate with [`PartialTypeValidation.ValidateContainingTypes`](/libraries/roslyn/diagnostics/#validating-members).

## Build properties

MSBuild properties reach a generator through the analyzer config as `build_property.<Name>`. Two extensions on `context.AnalyzerConfigOptionsProvider` read them as cacheable values.

```csharp
IncrementalValueProvider<string?> rootNamespace =
    context.AnalyzerConfigOptionsProvider.ForBuildProperty("RootNamespace");

IncrementalValueProvider<BuildProperties> settings =
    context.AnalyzerConfigOptionsProvider.ForBuildProperties("RootNamespace", "Configuration");
```

- Values are trimmed, and a missing, empty or whitespace value is `null`.
- Names are matched case-insensitively.
- `BuildProperties` is an equatable record. Read it with `TryGet(name, out value)`, which is `true` only for a requested name with a non-blank value, or with the indexer `settings["RootNamespace"]`, which returns `null` otherwise. `Items` holds the `BuildProperty(Name, Value)` entries.

**The consumer must expose the property.** The compiler only passes on properties the project lists, so tell users to add it, or ship it in your package's `.props`:

```xml
<ItemGroup>
  <CompilerVisibleProperty Include="RootNamespace" />
</ItemGroup>
```

## Additional files

`ForAdditionalFiles` reads additional files (such as `.json` or `.resx`) as one `Result<AdditionalFileModel>` per file.

```csharp
IncrementalValuesProvider<Result<AdditionalFileModel>> files = context.ForAdditionalFiles(
    static path => path.EndsWith(".txt", StringComparison.OrdinalIgnoreCase),
    Unreadable,
    "ConstantName");
```

| Parameter | Meaning |
|---|---|
| `pathPredicate` | Selects files by path. It runs before the text is read, so skipped files cost nothing. |
| `unreadable` | A `DiagnosticDescriptor` reported, located at the file, when a matching file's text is unavailable. The file path is message argument `{0}`. |
| `metadataNames` | The `build_metadata.AdditionalFiles.<Name>` values to read for each file. |

An `AdditionalFileModel` holds `Path`, `Content` and `Metadata`. Read a value with `TryGetMetadata(name, out value)` or the indexer `file["ConstantName"]`. As with build properties, values are trimmed, blank ones are `null`, and names are case-insensitive. A name that was not requested also reads as `null`.

Pass the results through `ReportDiagnostics` to report unreadable files and keep only the models:

```csharp
var valid = files.ReportDiagnostics(context, "MyGenerator.Files");
```

**The consumer must expose the metadata** with `CompilerVisibleItemMetadata`, and list the files as `AdditionalFiles`:

```xml
<ItemGroup>
  <AdditionalFiles Include="docs/*.txt" ConstantName="Welcome" />
  <CompilerVisibleItemMetadata Include="AdditionalFiles" MetadataName="ConstantName" />
</ItemGroup>
```

The library's `TextConstantsGenerator` sample combines both providers: it turns each `*.txt` additional file into a string constant on a `TextConstants` class, in the namespace given by the `RootNamespace` build property.

## Marker attributes

Generators usually ship their own marker attribute through post-initialization output, marked `[Embedded]` so it does not leak into consuming assemblies' public surface.

```csharp
context.RegisterPostInitializationOutput(static ctx =>
{
    ctx.AddEmbeddedAttributeDefinition();
    ctx.AddMarkerAttribute("SampleAttribute.g.cs", "Sample", "SampleAttribute", AttributeTargets.Class);
});
```

`AddEmbeddedAttributeDefinition` adds `Microsoft.CodeAnalysis.EmbeddedAttribute` (hint name `Microsoft.CodeAnalysis.EmbeddedAttribute.g.cs` unless you pass another).

On Roslyn 4.14 and later (`Microsoft.CodeAnalysis` 4.14+), the compiler provides its own instance `AddEmbeddedAttributeDefinition()`, which takes precedence over this extension method when you call `ctx.AddEmbeddedAttributeDefinition()`.

`AddMarkerAttribute` takes:

| Parameter | Meaning |
|---|---|
| `hintName` | Hint name of the generated file. |
| `@namespace` | Namespace of the attribute; must be a valid dotted namespace. |
| `attributeName` | Attribute class name; must be a valid identifier. |
| `targets` | `AttributeTargets`; must be a non-zero, defined combination. |
| `allowMultiple` | Defaults to `false`. |
| `inherited` | Defaults to `false`. |
| `properties` | Optional `(Type, Name)` pairs for settable properties. |

Property types must start with `global::` or be a C# keyword type (not `void`); anything else throws `ArgumentException`.

```csharp
ctx.AddMarkerAttribute(
    "RouteAttribute.g.cs",
    "My.Routing",
    "RouteAttribute",
    AttributeTargets.Class | AttributeTargets.Struct,
    allowMultiple: true,
    properties: [("string", "Path"), ("int?", "Order")]);
```

The generated marker is annotated with `[Microsoft.CodeAnalysis.EmbeddedAttribute]`, so call `AddEmbeddedAttributeDefinition` in the same callback to define that attribute.

## HintName

`HintName.For` builds a hint name for `AddSource` that is unique per type.

```csharp
string hint = HintName.For(type, "Sample");   // e.g. "App.Widget.Sample.g.cs"
```

The result is ``{Namespace.}{Outer+}*{Name}{`N if generic}.{suffix}.g.cs``. Nesting is joined with `+` so a nested `A.B+X` never collides with a type `X` in namespace `A.B`, and generic arity is appended so `Foo` and `Foo<T>` differ.

The suffix must be non-empty, must not end in `.cs`, must not start or end with `.` or contain `..`, and may contain only ASCII letters, digits, `.`, `_` and `-`; otherwise `ArgumentException`.

Roslyn compares hint names case-insensitively, so two types whose names differ only in case in one namespace (`Foo` and `foo`) collide by default. Pass `disambiguateCase: true` to insert an 8-character FNV-1a hash before the suffix:

```csharp
string hint = HintName.For(type, "Sample", disambiguateCase: true);   // e.g. "App.Foo.a1b2c3d4.Sample.g.cs"
```

The hash covers the case-sensitive stem (namespace, containing types and arity) and not the suffix. It is opt-in so existing generators keep their file names; turning it on renames every output file.
