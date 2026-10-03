---
title: Attributes, new types and statements
description: Rendering attributes, emitting brand-new types, and writing statements inside method bodies.
sidebar:
  order: 5.5
---

These parts of the [typed scoped writer](/libraries/roslyn/writing/) arrived in 0.2.0. They cover attributes on generated code, new non-partial types, and control flow inside bodies.

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

`FileScope`, `NamespaceScope` and `TypeScope` have `Attribute(AttributeModel)`. It writes the attribute on its own line directly above the **next** type (or, on a `TypeScope`, the next member) the scope writes, and returns the scope so calls chain. Call it again to stack attributes. The next declaration adds no blank line of its own, so the attribute stays attached to it.

```csharp
using var file = writer.File();

file.Attribute(WellKnownAttributes.GeneratedCode("MyGenerator", "1.0.0"))
    .Attribute(WellKnownAttributes.EditorBrowsableNever);

using var type = file.NewType(model);
```

While an attribute is pending, `FileScope.Using` and `FileScope.Namespace` throw `InvalidOperationException`, and writing a type with containing types through `FileScope.Type` or `NamespaceScope.Type` throws `ArgumentException`, because the attribute would land on the outermost containing type. On `TypeScope`, if the member after `Attribute()` is rejected, the attribute already written stays in the output.

## New types

`TypeModel` describes an existing type to extend with a partial declaration. `NewTypeModel` describes a brand-new, non-partial type.

```csharp
var model = new NewTypeModel("Cache", TypeDeclarationKind.Class, Accessibility.Internal)
{
    IsSealed = true,
    TypeParameters = [ /* TypeParameterModel values */ ],
    BaseTypes = [ /* base class first, then interfaces */ ],
};
```

`Name`, `Kind` and `Accessibility` are positional. The rest are init properties: `IsStatic`, `IsAbstract`, `IsSealed`, `IsReadOnly`, `IsRefLikeType`, `IsPartial`, `IsFileLocal`, `TypeParameters` and `BaseTypes`. `Accessibility.NotApplicable` writes no accessibility, or `file` when `IsFileLocal` is set.

There are two ways to write one:

- `writer.WriteNewTypeDeclaration(model)` writes the header and opens a block, returning a `SourceWriter.BlockScope`. Use it with a plain `SourceWriter`.
- `NewType(model)` on `FileScope`, `NamespaceScope` and `TypeScope` writes the type, opens its block, and returns a `TypeScope` that takes members like any other.

```csharp
using var ns = file.Namespace("App");
using var cache = ns.NewType(model);

cache.Field(entriesField);
```

### Rejected combinations

Illegal combinations throw `ArgumentException` before anything is written. Every `NewType` and `WriteNewTypeDeclaration` call checks these:

- The name must be a valid identifier (a leading `@` is allowed).
- File-local cannot be combined with an accessibility.
- `static` requires a plain class, and excludes `abstract`, `sealed` and base types.
- `abstract` and `sealed` cannot be combined.
- Only classes and record classes can be `static`, `abstract` or `sealed`.
- Only structs and record structs can be `readonly` or `ref`, and a record struct cannot be `ref`.
- A base class is allowed only on a class or record class, must be listed first, and must be the only one; everything else must be an interface.

Top-level and nested types differ beyond that:

| | Top level (`FileScope`, `NamespaceScope`) | Nested (`TypeScope`) |
|---|---|---|
| `private`, `protected`, `protected internal`, `private protected` | Rejected (CS1527) | Allowed, except protected in any form inside a struct (CS0666) or a static class (CS1057) |
| File-local | Allowed | Rejected (CS9054) |

### Not supported

- Primary constructors and positional records.
- Type-parameter variance (`in`/`out`).
- Explicit interface members.

Instance members in a new static class are not rejected; CS0708 is the caller's error.

## Statements

`BodyScope`, `IfScope` and `TryScope` expose statement scopes. Each opens a braced body and returns a scope you dispose with `using`. Every scope also has `Line` and `Block`, and `IfScope` and `TryScope` also carry the same statement members, so nesting works from any of them.

| Method | Writes | Returns |
|---|---|---|
| `If(condition)` | `if (condition)` | `IfScope` |
| `ElseIf(condition)` | `else if (condition)` | `IfScope` |
| `Else()` | `else` | `BodyScope` |
| `ForEach(type, identifier, collection)` | `foreach (type identifier in collection)` | `BodyScope` |
| `For(initializer, condition, iterator)` | `for (initializer; condition; iterator)`; any part may be empty | `BodyScope` |
| `While(condition)` | `while (condition)` | `BodyScope` |
| `Using(resource)` | `using (resource)`; a using declaration is a plain `Line` | `BodyScope` |
| `Try()` | `try` | `TryScope` |
| `Catch(type = null, identifier = null, filter = null)` | `catch`, `catch (type)`, `catch (type identifier)`, optionally `when (filter)` | `TryScope` |
| `Finally()` | `finally` | `BodyScope` |
| `Switch(expression)` | `switch (expression)` | `SwitchScope` |
| `Case(params string[] labels)` | One `case label:` line per label | `BodyScope` |
| `Default()` | `default:` | `BodyScope` |

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

`ElseIf` and `Else` close the branch they are called on, and `Catch` and `Finally` close the block they are called on. Chaining a branch twice throws `InvalidOperationException`. So does a second `Default()` on one switch, and a `Catch` after an unfiltered general `catch`. Disposing a chained scope is a no-op, so the `using` pattern above still works.

`Case` labels are written verbatim between `case ` and `:`, so a pattern such as `int i when i > 0` works and `_` gives the discard pattern. Do not include `case` or the colon. `Switch` exposes only `Case` and `Default`, so a statement directly inside a switch does not compile.

```csharp
using var sw = body.Switch("kind");

using (var one = sw.Case("Kind.A", "Kind.B"))
{
    one.Line("return 1;");
}

using var other = sw.Default();
other.Line("return 0;");
```

### Errors the writer does not catch

A `ref struct` cannot track these without allocation, so they stay the caller's job. Each produces output that is wrong or does not compile, and none throws.

- **Writing to a parent scope while a child is open.** The text lands inside the child's block.
- **Disposing a copied scope twice.** The block closes twice.
- **`ElseIf`, `Else`, `Catch`, `Finally`, `Case` or `Default` while a nested block is open.** It closes the innermost brace first and misnests the output. Dispose nested scopes before chaining. For `Case` and `Default`, dispose the previous section first.
- **A `try` with neither `Catch` nor `Finally`.** It renders a lone `try` block (CS1524).
- **Catch ordering.** A more-derived exception type after a less-derived one does not compile (CS0160). An unused catch identifier compiles with warning CS0168.
- **Switch fall-through.** Write each section's `break;` or `return`. A section that can fall through gives CS0163, or CS8070 for the last section.
- **A dangling `Attribute()`.** An attribute with no following type or member is left in the output and does not compile. Nothing checks at `Dispose`.

Writing through a scope after chaining it lands in the newest open branch, so write each branch's content before opening the next.
