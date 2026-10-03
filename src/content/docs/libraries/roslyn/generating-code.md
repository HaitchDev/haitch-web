---
title: Attributes, new types and statements
description: Rendering attributes, emitting brand-new types, writing statements inside method bodies, and the writer's guards.
sidebar:
  order: 5.5
---

These parts of the [typed scoped writer](/libraries/roslyn/writing/) arrived in 0.2.0 and were extended in 0.3.0. They cover attributes on generated code, new non-partial types, and control flow inside bodies. 0.3.0 adds [C# 15 support](#c-15-support) and [writer guards](#writer-guards).

## Attributes

An `AttributeModel` renders as one `[global::...(...)]` line. The attribute type is always written fully qualified, so a consumer's own type of the same name cannot take its place.

```csharp
writer.WriteAttribute(attribute);                     // one line
writer.WriteAttributes(type.Attributes);              // one line per entry, in order
```

`WriteAttributes` renders every attribute before writing the first line, so a failure leaves the writer untouched. Both throw `ArgumentException` when an argument is an error constant, again before writing anything.

Arguments render so that the output compiles under `#nullable enable`:

| Constant | Renders as |
|---|---|
| Enum with a known member | The member name: `global::System.AttributeTargets.Class`. Without a member name it is a cast of the underlying value. |
| Array with a known element type | A typed array: `new string[] { "a", "b" }`; empty is `new string[] { }`. |
| `byte`, `sbyte`, `short`, `ushort` | A cast: `(byte)1`. |
| Typed null | `default(T)`. `(T)null` would warn with CS8600 under `#nullable enable`. |
| Type | `typeof(T)`, with a trailing `?` stripped from reference types (CS8639). |

### WellKnownAttributes

`WellKnownAttributes` holds ready-made models for attributes generators routinely put on generated code.

```csharp
WellKnownAttributes.GeneratedCode("MyGenerator", "1.0.0");   // [global::System.CodeDom.Compiler.GeneratedCodeAttribute("MyGenerator", "1.0.0")]
WellKnownAttributes.EditorBrowsableNever;                    // [global::System.ComponentModel.EditorBrowsableAttribute(global::System.ComponentModel.EditorBrowsableState.Never)]
```

### Attribute() on scopes

`FileScope`, `NamespaceScope` and `TypeScope` have `Attribute(AttributeModel)`. It buffers the attribute and returns the scope so calls chain. Call it again to stack attributes. The buffered attributes are written on their own lines directly above the **next** type (or, on a `TypeScope`, the next member) the scope accepts, with no blank line between.

```csharp
using var file = writer.File();

file.Attribute(WellKnownAttributes.GeneratedCode("MyGenerator", "1.0.0"))
    .Attribute(WellKnownAttributes.EditorBrowsableNever);

using var type = file.NewType(model);
```

While an attribute is pending, `FileScope.Using` and `FileScope.Namespace` throw `InvalidOperationException`, and writing a type with containing types through `FileScope.Type` or `NamespaceScope.Type` throws `ArgumentException`, because the attribute would land on the outermost containing type.

If the next type or member is rejected, the pending attributes are discarded with it and nothing is written. Call `Attribute` again before retrying. An attribute with no type or member after it is recorded as an error when the scope is disposed; see [Writer guards](#writer-guards).

## New types

`TypeModel` describes an existing type to extend with a partial declaration. `NewTypeModel` describes a brand-new, non-partial type.

```csharp
var model = new NewTypeModel("Cache", TypeDeclarationKind.Class, Accessibility.Internal)
{
    IsSealed = true,
    BaseTypes = new[] { baseClassRef, interfaceRef }.ToEquatableArray(),   // base class first, then interfaces
};
```

`Name`, `Kind` and `Accessibility` are positional. The rest are init properties: `IsStatic`, `IsAbstract`, `IsSealed`, `IsReadOnly`, `IsRefLikeType`, `IsPartial`, `IsFileLocal`, `TypeParameters` (`EquatableArray<TypeParameterModel>`), `BaseTypes` (`EquatableArray<TypeRef>`) and, since 0.3.0, `IsClosed`, `UnionCaseTypes` and `PrimaryConstructorParameters`. `Accessibility.NotApplicable` writes no accessibility, or `file` when `IsFileLocal` is set.

There are three ways to write one:

- `writer.WriteNewTypeDeclaration(model)` writes the header and always opens a block, returning a `SourceWriter.BlockScope`. Use it with a plain `SourceWriter`.
- `writer.WriteBodylessNewTypeDeclaration(model)` writes a complete positional record ending in `;` and opens nothing. See [Primary constructors](#primary-constructors-and-positional-records).
- `NewType(model)` on `FileScope`, `NamespaceScope` and `TypeScope` writes the type, opens its block, and returns a `TypeScope` that takes members like any other.

```csharp
using var ns = file.Namespace("App");
using var cache = ns.NewType(model);

cache.Field(entriesField);
```

### Rejected combinations

Illegal combinations throw `ArgumentException` before anything is written. Every `NewType`, `WriteNewTypeDeclaration` and `WriteBodylessNewTypeDeclaration` call checks these:

- The name must be a valid identifier (a leading `@` is allowed).
- File-local cannot be combined with an accessibility.
- `static` requires a plain class, and excludes `abstract`, `sealed` and base types.
- `abstract` and `sealed` cannot be combined.
- Only classes and record classes can be `static`, `abstract` or `sealed`.
- Only structs and record structs can be `readonly` or `ref`, and a record struct cannot be `ref`.
- A base class is allowed only on a class or record class, must be listed first, and must be the only one; everything else must be an interface.
- A variant type parameter on anything but an interface.
- The `closed`, union and primary-constructor rules described below.

Top-level and nested types differ beyond that:

| | Top level (`FileScope`, `NamespaceScope`) | Nested (`TypeScope`) |
|---|---|---|
| `private`, `protected`, `protected internal`, `private protected` | Rejected (CS1527) | Allowed, except protected in any form inside a struct (CS0666) or a static class (CS1057) |
| File-local | Allowed | Rejected (CS9054) |

### Type-parameter variance

`TypeParameterModel.Variance` is a Roslyn `VarianceKind`. `In` and `Out` render as `in ` and `out ` before the parameter name. Only an interface can have a variant type parameter: on a class, struct, record or union, and on a method, it throws `ArgumentException`. `TypeParameterModel.From` reads the variance from the symbol.

```csharp
// public interface IProducer<out T>
var t = new TypeParameterModel(
    "T",
    ConstraintTypes: default,
    HasReferenceTypeConstraint: false,
    ReferenceTypeConstraintNullableAnnotation: NullableAnnotation.None,
    HasValueTypeConstraint: false,
    HasUnmanagedTypeConstraint: false,
    HasNotNullConstraint: false,
    HasConstructorConstraint: false)
{
    Variance = VarianceKind.Out,
};

var producer = new NewTypeModel("IProducer", TypeDeclarationKind.Interface, Accessibility.Public)
{
    TypeParameters = new[] { t }.ToEquatableArray(),
};
```

### Primary constructors and positional records

Set `PrimaryConstructorParameters` (`EquatableArray<ParameterModel>?`) to write a parameter list after the type name and type parameters. `null` writes no list and an empty array writes `()`. It works on classes, structs and records, and throws `ArgumentException` on an interface, a static class or a union.

`WriteNewTypeDeclaration` always opens a body, so a positional record comes out as `record Person(string Name) { }` with the braces on their own lines. For the `;` form, call `WriteBodylessNewTypeDeclaration`:

```csharp
var name = new ParameterModel(
    "Name", stringType, RefKind.None, ScopedKind.None,
    IsParams: false, DefaultValue: null, IsDefaultLiteral: false, Attributes: default);

var person = new NewTypeModel("Person", TypeDeclarationKind.RecordClass, Accessibility.Public)
{
    PrimaryConstructorParameters = new[] { name }.ToEquatableArray(),
};

writer.WriteBodylessNewTypeDeclaration(person);   // public record Person(string Name);
```

It throws `ArgumentException` before writing anything unless the kind is a record class or record struct with non-null `PrimaryConstructorParameters`, or the model is otherwise illegal. Nothing is opened, so no members can follow; use `WriteNewTypeDeclaration` when the type needs a body.

### Not supported

- Explicit interface members on a new type.

Instance members in a new static class are not rejected; CS0708 is the caller's error.

## C# 15 support

0.3.0 is built against the C# 15 release candidate, so the behaviour described here may change before .NET 11 ships. The C# 15 behaviour is tested in a separate test project on Roslyn 5.9 with `LanguageVersion.Preview`. The library itself still targets Roslyn 4.12 or later: unions and closed types are detected from syntax and metadata, not from newer Roslyn APIs. The [models page](/libraries/roslyn/models/#unions-and-closed-types) describes detection.

### Unions

Set `Kind` to `TypeDeclarationKind.Union` and list the case types, fully qualified, in `UnionCaseTypes`. The type is written with the case list after the name and then a body:

```csharp
var pet = new NewTypeModel("Pet", TypeDeclarationKind.Union, Accessibility.Public)
{
    UnionCaseTypes = new[] { "global::Cat", "global::Dog" }.ToEquatableArray(),
};

using (writer.WriteNewTypeDeclaration(pet)) { }
// public union Pet(global::Cat, global::Dog)
// {
// }
```

The case list may be empty only for a partial part (`IsPartial = true`), which writes `public partial union Pet`. A union cannot be `ref`, a case type cannot be blank, and `UnionCaseTypes` on any other kind throws `ArgumentException`. A union modelled by `TypeModel` is written by `WriteTypeDeclaration` as `partial union`, not `partial struct`.

### Closed types

`IsClosed = true` writes `closed` on a class or record class (`public closed record Shape`). It throws `ArgumentException` on any other kind and cannot be combined with `abstract`, `sealed` or `static`. A partial declaration of an existing closed type does not echo `closed`.

### Extension blocks

`TypeModel.From` throws `ArgumentException` for a C# 15 extension block. Model the containing static class instead; extension indexers are filtered out of its members.

### Labeled loops and jumps

`ForEach`, `For`, `While` and `Switch` take an optional trailing `label`, written as `label:` on its own line directly above the statement. `Break` and `Continue` take an optional label and are available on `BodyScope`, `IfScope` and `TryScope`.

```csharp
using var outer = body.For("int i = 0", "i < 3", "i++", label: "outer");
using var inner = outer.ForEach("int", "x", "xs", label: "inner");

using (var skip = inner.If("x == i"))
{
    skip.Continue("outer");
}

inner.Break("inner");
```

A label must be an identifier that is not an unescaped keyword; `@name` is accepted. These throw `ArgumentException`: a label that is already open, a `Break` or `Continue` naming a label that is not an open loop or switch, and a `Continue` naming a switch. The writer follows blocks only. A jump across a lambda, local function or `finally` boundary is accepted and left to the compiler (CS0159, CS0157).

## Statements

`BodyScope`, `IfScope` and `TryScope` expose statement scopes. Each opens a braced body and returns a scope you dispose with `using`. Every scope also has `Line` and `Block`, and `IfScope` and `TryScope` also carry the same statement members, so nesting works from any of them.

| Method | Writes | Returns |
|---|---|---|
| `If(condition)` | `if (condition)` | `IfScope` |
| `ElseIf(condition)` | `else if (condition)` | `IfScope` |
| `Else()` | `else` | `BodyScope` |
| `ForEach(type, identifier, collection, label = null)` | `foreach (type identifier in collection)` | `BodyScope` |
| `For(initializer, condition, iterator, label = null)` | `for (initializer; condition; iterator)`; any part may be empty | `BodyScope` |
| `While(condition, label = null)` | `while (condition)` | `BodyScope` |
| `Using(resource)` | `using (resource)`; a using declaration is a plain `Line` | `BodyScope` |
| `Try()` | `try` | `TryScope` |
| `Catch(type = null, identifier = null, filter = null)` | `catch`, `catch (type)`, `catch (type identifier)`, optionally `when (filter)` | `TryScope` |
| `Finally()` | `finally` | `BodyScope` |
| `Switch(expression, label = null)` | `switch (expression)` | `SwitchScope` |
| `Case(params string[] labels)` | One `case label:` line per label | `BodyScope` |
| `Default()` | `default:` | `BodyScope` |
| `Break(label = null)`, `Continue(label = null)` | `break;` / `continue;`, or with a label | The scope it is called on |
| `Return(expression = null)`, `Throw(expression = null)` | `return;` / `throw;`, or with an expression | `BodyScope` |
| `GotoCase(label)` | `goto case label;` | `BodyScope` |

Blank required arguments throw `ArgumentException`. The `ForEach` identifier is written verbatim, not validated or escaped. Switch expressions are not supported.

```csharp
using (var body = type.Method(processMethod))
{
    using (var loop = body.ForEach("var", "item", "items"))
    {
        using var check = loop.If("item is null");
        check.Line("continue;");

        using var otherwise = check.ElseIf("item.IsEmpty");
        otherwise.Line("continue;");
    }

    using var attempt = body.Try();
    attempt.Line("Run();");

    using var failed = attempt.Catch("InvalidOperationException", "ex");
    failed.Line("Log(ex);");

    using var cleanup = failed.Finally();
    cleanup.Line("Release();");
}
```

`ElseIf` and `Else` close the branch they are called on, and `Catch` and `Finally` close the block they are called on. Chaining a branch twice throws `InvalidOperationException`. So does a second `Default()` on one switch, a `Catch` after an unfiltered general `catch`, and a `Catch` whose type text repeats an earlier unfiltered catch. Disposing a chained scope is a no-op, so the `using` pattern above still works.

`Case` labels are written verbatim between `case ` and `:`, so a pattern such as `int i when i > 0` works and `_` gives the discard pattern. Do not include `case` or the colon. `Switch` exposes only `Case` and `Default`, so a statement directly inside a switch does not compile. Each section must end in a jump:

```csharp
using var sw = body.Switch("kind");

using (var one = sw.Case("Kind.A", "Kind.B"))
{
    one.Return("1");
}

using var other = sw.Default();
other.Return("0");
```

## Writer guards

Since 0.3.0 the writer detects misuse that 0.2.0 left to the compiler. The checks are always on, not debug-only. See also [Source writing](/libraries/roslyn/writing/#guards).

These throw `InvalidOperationException` from the call, with a message naming the scope:

- **Writing to a parent scope while a child is open**, on every scope type.
- **`ElseIf`, `Else`, `Catch`, `Finally`, `Case` or `Default` while a nested block is open.** Dispose nested scopes before chaining.
- **Using a scope after its block closed**, for example through a copy disposed earlier. A stale copy cannot write into a sibling block that opened at the same depth.
- **A switch section that falls through.** `Case` or `Default` throws if the previous section does not end in a jump. A section ends in a jump when its last statement is written with `Break`, `Continue`, `Return`, `Throw` or `GotoCase`, or when a `Line` ends in `break`, `continue`, `return`, `throw` or `goto`. Trailing blank lines and comments are ignored.
- **A repeated `catch` type, or a `catch` after a general `catch`.**

`Dispose` never throws, because throwing there would mask an exception already in flight. A problem found while closing is recorded on the writer, and `ToString()` or `ToSourceText()` throws it:

- A `try` with neither `Catch` nor `Finally`.
- A last switch section that does not end in a jump.
- An `Attribute()` with no following type or member.

After any scope exception, treat the output as unusable, because the unwinding disposals may record further errors.

Disposing a copy of a scope after the original, or disposing twice, is a no-op, and disposing a scope closes any blocks still open inside it.

### Errors the writer does not catch

These still produce wrong or uncompilable output without throwing.

- **Catch ordering by type hierarchy.** A more-derived exception type after a less-derived one does not compile (CS0160). `Catch` takes text, not symbols, so only an exactly repeated type is caught. An unused catch identifier compiles with warning CS0168.
- **Jumps across lambda, local-function or `finally` boundaries.** See [Labeled loops and jumps](#labeled-loops-and-jumps).
- **Text passed to `Line` and `Block`**, which is written as given.

Writing through a scope after chaining it lands in the newest open branch, so write each branch's content before opening the next.
