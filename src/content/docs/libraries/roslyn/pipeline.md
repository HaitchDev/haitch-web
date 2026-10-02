---
title: Pipeline helpers
description: ForTypesWithAttribute, marker attributes and hint names.
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

The second argument is the tracking name given to the step, which the [testing helpers](/libraries/roslyn/testing/) use to look it up.

Each item holds:

- `Type`: the `TypeModel`, without members.
- `Syntax`: the `SyntaxInfo`, with the partial flags and a `LocationInfo?` for reporting diagnostics.
- `Attributes`: every application of the attribute on the type.

**One item per type.** A partial type marked on several declarations still yields a single item, and `Attributes` carries the applications from all parts. This is done without `Collect()`, so unrelated edits still leave the step cached.

The provider does not report diagnostics for a bad match, such as a non-partial type. That is your decision; see [Diagnostics](/libraries/roslyn/diagnostics/).

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

Roslyn compares hint names case-insensitively, so two types whose names differ only in case in one namespace still collide. `HintName` does not disambiguate that.
