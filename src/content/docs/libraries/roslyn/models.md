---
title: Models and EquatableArray
description: Value-equal models of types, members and attributes that keep incremental caching working.
sidebar:
  order: 2
---

An incremental generator only skips work when a pipeline step's output compares equal to the previous run. Roslyn symbols, syntax nodes and `Location` values do not compare by value, and holding one in a pipeline value defeats caching entirely. Haitch.Roslyn's models are plain records that capture what a generator needs and **never hold symbols, syntax or `Location`**.

## EquatableArray&lt;T&gt;

`EquatableArray<T>` is a value-equal array wrapper used for every collection inside a model. `T` must implement `IEquatable<T>?`, so nullable reference types are allowed and `EquatableArray<string?>` works.

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
| `AttributeModel` | An attribute's type, metadata name, constructor arguments and named arguments. `AttributeModel.From(AttributeData)` returns `null` for an unresolved attribute. See [Reading attribute arguments](#reading-attribute-arguments). |
| `ConstantValue` | A constant: null, primitive, string, enum, type or array. Built with `ForNull`, `ForPrimitive`, `ForString`, `ForEnum`, `ForType`, `ForArray`, and read with typed `TryGet...` accessors. |
| `WellKnownAttributes` | Ready-made `AttributeModel`s: `GeneratedCode(tool, version)` and `EditorBrowsableNever`. See [Attributes, new types and statements](/libraries/roslyn/generating-code/). |
| `TypeModel` | A class, record, struct, record struct, interface or C# 15 union declaration. |
| `NewTypeModel` | A brand-new, non-partial type to emit, as opposed to an existing one to extend. See [Attributes, new types and statements](/libraries/roslyn/generating-code/). |
| `ContainingTypeModel` | One enclosing type of a nested type. |
| `MethodModel`, `PropertyModel`, `FieldModel`, `EventModel`, `ParameterModel`, `TypeParameterModel` | Members and their parts. Each has a `From(...)` factory over the matching symbol. |
| `SyntaxInfo` | Syntax facts: `IsPartial`, `AreContainingTypesPartial` and a `LocationInfo?`. `SyntaxInfo.From(TypeDeclarationSyntax)`. |
| `BuildProperties` | A set of MSBuild properties read together. See [Build properties](/libraries/roslyn/pipeline/#build-properties). |
| `AdditionalFileModel` | An additional file's path, text and requested metadata. See [Additional files](/libraries/roslyn/pipeline/#additional-files). |

## TypeModel

```csharp
TypeModel model = TypeModel.From(typeSymbol);
TypeModel withMembers = TypeModel.From(typeSymbol, includeMembers: true);
```

`TypeModel` records the namespace (`null` for the global namespace), name, `Kind` (`TypeDeclarationKind`), accessibility, modifier flags (`IsStatic`, `IsAbstract`, `IsSealed`, `IsReadOnly`, `IsRefLikeType`, `IsFileLocal`), type parameters, containing types (outermost first), attributes, base types (see [below](#base-types-interfaces-and-events)), and the `Fields`, `Properties`, `Methods` and `Events` arrays and `MemberNames`.

**Members are captured only when `includeMembers: true`.** A model with members changes whenever any member is edited, so the member arrays are empty by default. Ask for members only when the generator really reads them.

`TypeModel.From` throws `ArgumentException` for enums, delegates, C# 15 extension blocks and other kinds it does not model. For an extension block, model the containing static class instead. Indexers are skipped when collecting members; calling `PropertyModel.From` on an indexer throws `ArgumentException`.

Both `TypeModel.From` and `MethodModel.From` take an optional trailing `CancellationToken`. It is checked per captured member, parameter and type parameter, and cancellation throws `OperationCanceledException`.

```csharp
TypeModel model = TypeModel.From(typeSymbol, includeMembers: true, cancellationToken);
```

### Member names

`TypeModel.MemberNames` is an `EquatableArray<string>` holding the distinct, ordinal-sorted name of every member the type declares, and it is empty unless `includeMembers` is `true`. Unlike the typed arrays it lists nested types, indexers, constructors, operators and compiler-made members, because a generated member can clash with any of them, such as a record's synthesized `ToString`. Accessors appear as `get_X` and `add_X`, an indexer appears as `this[]`, and an explicit interface implementation appears under its qualified name, such as `System.IDisposable.Dispose`.

```csharp
bool taken = type.MemberNames.Contains("ToString");
```

### Base types, interfaces and events

`BaseType`, `Interfaces` and `AllInterfaces` are always populated, whether or not `includeMembers` is set.

- **`BaseType`** is a `TypeRef?`: the base class, or `null` when the type has none beyond `object` or `System.ValueType`, and for interfaces. An implicit base is never recorded, so `null` means "no user-written base class".
- **`Interfaces`** lists the interfaces the type declares directly, in Roslyn's order.
- **`AllInterfaces`** lists every interface the type implements, including those inherited from its base class and base interfaces.

```csharp
if (!type.AllInterfaces.Any(i => i.FullyQualifiedName == "global::System.IDisposable"))
{
    // the generated partial declaration can add the interface itself
}
```

**Caching.** `AllInterfaces` feeds on the base types' own interface lists. Adding or removing an interface on a base type changes it, and so changes the model and invalidates caches built on it. That is correct (the answer to "does this type implement X" changed), but it means a model with `AllInterfaces` is not cached against edits to its base types.

`TypeModel.Events` holds `EventModel`s when `includeMembers` is `true`. An `EventModel` records `Name`, `Type`, `Accessibility`, `IsStatic` and `IsFieldLike`, plus `IsAbstract`, `IsVirtual`, `IsOverride`, `IsSealed`, `ExplicitInterface`, `ExplicitInterfaceMemberName` and `Attributes`. `IsFieldLike` is true for `event EventHandler E;` and false when the accessors are written out. `IsPartial` is true for a C# 14 partial event, which yields one `EventModel` built from the definition part; `IsFieldLike` is always false for it. For an event from metadata it is always false, because the two forms cannot be told apart there. `Name` is not unique when explicit implementations are present, so match on `ExplicitInterface` as well.

### Unions and closed types

A type is a union (`Kind == TypeDeclarationKind.Union`) when a declaring syntax uses the `union` keyword, or, for a type from metadata, when it carries `System.Runtime.CompilerServices.UnionAttribute`. Implementing `IUnion` alone does not make a struct a union. `UnionCaseTypes` lists the case types in declaration order and is empty for every other kind. A partial declaration of a union is written as `partial union`.

`IsClosed` is true for a `closed` class or record. It is read from the `closed` modifier in source, and for metadata types from the host compiler's `IsClosed` property when it has one, so it is `false` on a compiler that predates C# 15. A closed type also reports `IsAbstract`; a partial declaration echoes neither modifier.

### Members

- **`TypeParameterModel.Variance`** is `VarianceKind.In`, `Out` or `None`.
- **`FieldModel.IsVolatile`** is true for a `volatile` field.
- **`PropertyModel.ReturnRefKind`** is `None`, `Ref` or `RefReadOnly`, the same enum `MethodModel` uses.
- **`MethodModel.IsPartial`** is `true` for both the definition and the implementation part of a partial method; `IsPartialDefinition` is `true` only for the part without a body. The writer uses it to emit `partial`. It is a positional parameter, so a `MethodModel` built by hand must pass it.
- **Explicit interface implementations** are included in `Methods` and `Properties` when `includeMembers` is `true`. `Name` is the unqualified member name, and `ExplicitInterface` (a `TypeRef?`) and `ExplicitInterfaceMemberName` identify the interface member; both are `null` for an ordinary member. Because of that, `Name` is not unique: it can repeat across overloads, and an explicit implementation can share a name with a member of the type. Match on `ExplicitInterface` as well as `Name`. This also changes `MethodModel.From`: it used to return the qualified Roslyn name such as `System.IDisposable.Dispose`.

Two flags are worth knowing when you render a partial declaration: interfaces always report `IsAbstract` and structs always report `IsSealed`, even though neither keyword is ever written. The [typed writer](/libraries/roslyn/writing/) already accounts for this.

## Reading attribute arguments

An `AttributeModel` holds its arguments as `ConstantValue`s. Reading one without a cast goes through the typed accessors, which return `false` on a mismatch and never throw.

```csharp
AttributeModel? notify = item.Attributes.Find("Notify.NotifyAttribute");

if (notify is not null
    && notify.TryGetNamedArgument("Name", out var nameArgument)
    && nameArgument.TryGetString(out var name))
{
    // [Notify(Name = "Title")]
}

var raise = notify is not null
    && notify.TryGetNamedArgument("Raise", out var raiseArgument)
    && raiseArgument.TryGetBoolean(out var value)
    ? value
    : true;
```

**On `AttributeModel`:**

- `TryGetNamedArgument(string name, out ConstantValue value)` matches the name exactly, case-sensitively.
- `TryGetConstructorArgument(int index, out ConstantValue value)` reads by position. A `params` argument is one array value. An out-of-range index returns `false`.
- `MetadataName` is the attribute class's metadata name in the form `ForAttributeWithMetadataName` takes (`Ns.Outer+Inner`, ``Ns.Foo`1``). It is `null` on a hand-built model.
- `Find(fullyQualifiedMetadataName)` is an extension on `EquatableArray<AttributeModel>`. It returns the first attribute whose `MetadataName` equals the argument ordinally, or `null`. A hand-built model with a `null` `MetadataName` never matches.

**On `ConstantValue`:**

| Member | Succeeds when |
|---|---|
| `IsNull` | The constant is a null. |
| `TryGetString(out string)` | It is a string. |
| `TryGetBoolean`, `TryGetInt32`, `TryGetInt64`, `TryGetDouble` | It is a primitive of exactly that type. A `long` argument does not satisfy `TryGetInt32`. |
| `TryGetEnum<TEnum>(out TEnum)` | It is an enum constant with an integral underlying value. The underlying value is converted to `TEnum`; the enum's identity is not checked. |
| `TryGetType(out TypeRef)` | It is a `typeof(...)` constant. |
| `TryGetArray(out EquatableArray<ConstantValue>)` | It is an array. |
| `TryGetStringArray(out EquatableArray<string?>)` | It is an array whose elements are all strings or nulls. |

A `null` string argument is not a string: check `IsNull` for it, since `TryGetString` returns `false`.

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
