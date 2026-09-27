---
title: Optional
description: API reference for Optional of T and the Optional static helpers.
sidebar:
  order: 3
---

## Optional&lt;T&gt;

Represents a value that is either Some, holding a `T`, or None.

### Creating optionals

```csharp
var some = Optional<string>.Some("hello");
var none = Optional<string>.None();

// From a possibly-null value
var maybe = Optional<string>.From(GetNickname()); // Some or None depending on null

// Or via the static Optional helpers
var some2 = Optional.Some("hello");
var none2 = Optional.None<string>();
var maybe2 = Optional.From(GetNickname());
```

### Implicit conversion

A value converts implicitly to an `Optional<T>`, `null` becoming None; the `None` marker struct also converts implicitly:

```csharp
Optional<string> Nickname(User user) => user.Nickname; // null becomes None

Optional<string> Empty() => None.Default;
```

### Properties and access

| Member | Type | Description |
|---|---|---|
| `IsSome` | `bool` | `true` if the optional holds a value. |
| `Value` | `object` | The value when Some, otherwise `None`. Prefer `TryGetValue` or `Match`. |
| `TryGetValue(out T value)` | `bool` | Outputs the value and returns `true` when Some. |
| `TryGetValue(out None none)` | `bool` | Outputs `None` and returns `true` when empty. |

---

## Optional static helpers

| Member | Description |
|---|---|
| `Optional.Some<T>(value)` | Creates an optional holding `value`. Throws `ArgumentNullException` if `value` is null. |
| `Optional.From<T>(value)` | Creates an optional from a nullable reference or nullable value type; `null` becomes None. |
| `Optional.None<T>()` | Creates an empty optional. |

---

## Equality

`Optional<T>` implements `IEquatable<Optional<T>>` and supports `==` / `!=`. Two optionals are equal if they are both empty, or both hold equal values.

## ToString

`Optional<T>.ToString()` returns `Some(value)` when Some, or `None` when empty.
