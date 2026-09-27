---
title: Result
description: API reference for Result of T and the Result static helpers.
sidebar:
  order: 2
---

## Result&lt;T&gt;

Represents an operation that is either Ok, holding a `T`, or Error, holding an `Error`.

### Creating results

```csharp
var ok = Result<int>.Ok(42);
var error = Result<int>.Error(new ValidationError("num.invalid", "Not a number."));

// Or via the static Result helpers
var ok2 = Result.Ok(42);
var error2 = Result.Error<int>(new ValidationError("num.invalid", "Not a number."));
```

### Implicit conversion

A value, or an `Error` (or any of its subtypes), converts implicitly to a `Result<T>`:

```csharp
Result<int> Parse(string s) =>
    int.TryParse(s, out var v)
        ? v
        : new ValidationError("parse.failed", $"'{s}' is not a valid integer.");
```

### Properties and access

| Member | Type | Description |
|---|---|---|
| `IsOk` | `bool` | `true` if the result is Ok. |
| `Value` | `object` | The value when Ok, otherwise the `Error`. Prefer `TryGetValue` or `Match`. |
| `TryGetValue(out T value)` | `bool` | Outputs the value and returns `true` when Ok. |
| `TryGetValue(out Error error)` | `bool` | Outputs the error and returns `true` when Error. |

### Pattern matching

`Result<T>` is marked `[Union]` and implements `IUnion`, so C# pattern matching recognizes Ok and Error as its cases — a switch expression works alongside `Match`:

```csharp
string label = result.Match(
    onOk: value => $"Got {value}",
    onError: error => $"Failed: {error.Description}");

string label2 = result switch
{
    int value => $"Got {value}",
    Error error => $"Failed: {error.Description}",
};
```

A switch covering `T` and `Error` is exhaustive — no discard arm is needed, and the compiler warns (`CS8509`) if either is missing. A subtype arm, such as `NotFoundError`, can come before the general `Error` arm to handle it specially. A default `Result<T>` (e.g. `default(Result<T>)`) matches the `Error` arm, holding `Result.UninitializedError`.

`is` patterns work too:

```csharp
if (result is int value) { /* Ok, holding value */ }
if (result is Error error) { /* Error, holding error */ }
```

### No value: Result&lt;Unit&gt;

Haitch.Unions has no non-generic `Result` type. For an operation with nothing to return when Ok, use `Result<Unit>`:

```csharp
Result<Unit> Delete(int id) =>
    repository.Remove(id)
        ? Result.Ok()
        : new NotFoundError("item.not_found", $"Item {id} not found.");
```

`Result.Ok()` creates an Ok `Result<Unit>`. `Unit` is a zero-size `readonly record struct` with a single value, `Unit.Default`.

---

## Result static helpers

| Member | Description |
|---|---|
| `Result.Ok<T>(value)` / `Result.Ok()` | Creates an Ok result; the parameterless overload returns `Result<Unit>`. |
| `Result.Error<T>(error)` / `Result.Error(error)` | Creates an Error result; the single-argument overload returns `Result<Unit>`. |
| `Result.Try(Func<T>)` / `Result.Try(Action)` | Runs the delegate, turning a thrown exception into an `UnexpectedError`. An `OperationCanceledException` keeps propagating instead of being caught. |
| `Result.TryAsync(Func<Task<T>>)` / `Result.TryAsync(Func<Task>)` | Async forms of `Try`. |
| `Result.Combine(results)` | Combines results into one: every value when all are Ok, otherwise the first error. |
| `Result.Combine(results, mergeErrors)` | Same, but merges every error via `mergeErrors` instead of stopping at the first. See [merging validation errors](/libraries/unions/errors/#merging-validation-errors). |
| `Result.UninitializedError` | The error held by a default `Result<T>`. |

```csharp
Result<int> parsed = Result.Try(() => int.Parse(input));

Result<IReadOnlyList<int>> combined = Result.Combine(results);
```

### Default results

A parameterless `Result<T>` — `default(Result<T>)` or `new Result<T>()` — is Error, holding `Result.UninitializedError`:

```csharp
Result<int> uninitialized = default;
// uninitialized.IsOk is false
```

---

## Equality

`Result<T>` implements `IEquatable<Result<T>>` and supports `==` / `!=`. Two results are equal if they are both Ok with equal values, or both Error with equal errors.

## ToString

`Result<T>.ToString()` returns `Ok(value)` when Ok, or `Error(code)` when Error.
