---
title: Models and EquatableArray
description: Value-equal models of types, members and attributes that keep incremental caching working.
sidebar:
  order: 2
---

An incremental generator only skips work when a pipeline step's output compares equal to the previous run. Roslyn symbols, syntax nodes and `Location` values do not compare by value, and holding one in a pipeline value defeats caching entirely. Haitch.Roslyn's models are plain records that capture what a generator needs and **never hold symbols, syntax or `Location`**.

## EquatableArray&lt;T&gt;

`EquatableArray<T>` is a value-equal array wrapper used for every collection inside a model. `T` must implement `IEquatable<T>`.

```csharp
using Haitch.Roslyn.Types;

EquatableArray<string> names = new[] { "a", "b" }.ToEquatableArray();

var count = names.Count;                 // 2
var first = names[0];                    // "a"
var isEmpty = names.IsEmpty;             // false
ReadOnlySpan<string> span = names.AsSpan();

var equal = names == new[] { "a", "b" }.ToEquatableArray(); // true, element-wise
```

`ToEquatableArray()` is available on `T[]`, `ImmutableArray<T>`, `IEnumerable<T>` and `EquatableArray<T>` itself. The last is the identity: it returns the same array instead of boxing and copying through the `IEnumerable<T>` overload. `default(EquatableArray<T>)` is a valid empty array, equal to any other empty one.

`EquatableArray<T>` implements `IReadOnlyList<T>`, so it can be passed to any API that takes one. It is also a collection-expression target (it carries a `[CollectionBuilder]` attribute), so a literal list needs no helper call:

```csharp
EquatableArray<string> names = ["a", "b"];
EquatableArray<string> none = [];                  // default
EquatableArray<string> more = [.. names, "c"];
```

An empty collection expression yields `default`.

## The model types

| Model | Captures |
|---|---|
| `TypeRef` | A type reference: fully qualified name, nullable annotation, special type, type kind, value-type flag. `TypeRef.From(ITypeSymbol)`. |
| `AttributeModel` | An attribute's type, constructor arguments and named arguments. `AttributeModel.From(AttributeData)` returns `null` for an unresolved attribute. |
| `ConstantValue` | A constant: null, primitive, string, enum, type or array. Built with `ForNull`, `ForPrimitive`, `ForString`, `ForEnum`, `ForType`, `ForArray`. |
| `WellKnownAttributes` | Ready-made `AttributeModel`s: `GeneratedCode(tool, version)` and `EditorBrowsableNever`. See [Attributes, new types and statements](/libraries/roslyn/generating-code/). |
| `TypeModel` | A class, record, struct, record struct, interface or C# 15 union declaration. |
| `NewTypeModel` | A brand-new, non-partial type to emit, as opposed to an existing one to extend. See [Attributes, new types and statements](/libraries/roslyn/generating-code/). |
| `ContainingTypeModel` | One enclosing type of a nested type. |
| `MethodModel`, `PropertyModel`, `FieldModel`, `ParameterModel`, `TypeParameterModel` | Members and their parts. Each has a `From(...)` factory over the matching symbol. |
| `SyntaxInfo` | Syntax facts: `IsPartial`, `AreContainingTypesPartial` and a `LocationInfo?`. `SyntaxInfo.From(TypeDeclarationSyntax)`. |

## TypeModel

```csharp
TypeModel model = TypeModel.From(typeSymbol);
TypeModel withMembers = TypeModel.From(typeSymbol, includeMembers: true);
```

`TypeModel` records the namespace (`null` for the global namespace), name, `Kind` (`TypeDeclarationKind`), accessibility, modifier flags (`IsStatic`, `IsAbstract`, `IsSealed`, `IsReadOnly`, `IsRefLikeType`, `IsFileLocal`), type parameters, containing types (outermost first), attributes, and the `Fields`, `Properties` and `Methods` arrays.

**Members are captured only when `includeMembers: true`.** A model with members changes whenever any member is edited, so the member arrays are empty by default. Ask for members only when the generator really reads them.

`TypeModel.From` throws `ArgumentException` for enums, delegates, C# 15 extension blocks and other kinds it does not model. For an extension block, model the containing static class instead. Indexers are skipped when collecting members; calling `PropertyModel.From` on an indexer throws `ArgumentException`.

Both `TypeModel.From` and `MethodModel.From` take an optional trailing `CancellationToken`. It is checked per captured member, parameter and type parameter, and cancellation throws `OperationCanceledException`.

```csharp
TypeModel model = TypeModel.From(typeSymbol, includeMembers: true, cancellationToken);
```

### Unions and closed types

A type is a union (`Kind == TypeDeclarationKind.Union`) when a declaring syntax uses the `union` keyword, or, for a type from metadata, when it carries `System.Runtime.CompilerServices.UnionAttribute`. Implementing `IUnion` alone does not make a struct a union. `UnionCaseTypes` lists the case types in declaration order and is empty for every other kind. A partial declaration of a union is written as `partial union`.

`IsClosed` is true for a `closed` class or record. It is read from the `closed` modifier in source, and for metadata types from the host compiler's `IsClosed` property when it has one, so it is `false` on a compiler that predates C# 15. A closed type also reports `IsAbstract`; a partial declaration echoes neither modifier.

### Members

- **`TypeParameterModel.Variance`** is `VarianceKind.In`, `Out` or `None`.
- **`FieldModel.IsVolatile`** is true for a `volatile` field.
- **`PropertyModel.ReturnRefKind`** is `None`, `Ref` or `RefReadOnly`, the same enum `MethodModel` uses.
- **Explicit interface implementations** are included in `Methods` and `Properties` when `includeMembers` is `true`. `Name` is the unqualified member name, and `ExplicitInterface` (a `TypeRef?`) and `ExplicitInterfaceMemberName` identify the interface member; both are `null` for an ordinary member. Because of that, `Name` is not unique: it can repeat across overloads, and an explicit implementation can share a name with a member of the type. Match on `ExplicitInterface` as well as `Name`. This also changes `MethodModel.From`: it used to return the qualified Roslyn name such as `System.IDisposable.Dispose`.

Two flags are worth knowing when you render a partial declaration: interfaces always report `IsAbstract` and structs always report `IsSealed`, even though neither keyword is ever written. The [typed writer](/libraries/roslyn/writing/) already accounts for this.

## Constructing models by hand

The models are ordinary records, so a generator can build one directly, for example for a method it wants to emit. This is also how the [walkthrough](/libraries/roslyn/walkthrough/) declares a `ToString` override.

```csharp
var stringType = new TypeRef(
    "string",
    NullableAnnotation.NotAnnotated,
    SpecialType.System_String,
    TypeKind.Class,
    IsValueType: false);
```

## Keep models cache-safe

- Put only models, `EquatableArray<T>` and primitives in pipeline values.
- Use `EquatableArray<T>`, not `T[]`, `List<T>` or `ImmutableArray<T>`.
- Pull `DiagnosticDescriptor` values out into `static readonly` fields. They have no value equality and must not travel through the pipeline.

The [testing package](/libraries/roslyn/testing/) can check all of this for you with `AssertCacheable` and `CachingHazardWalker`.
