---
title: Result types
description: API reference for Result, Result of T, and Result of T TError.
sidebar:
  order: 3
banner:
  content: Haitch.Results is deprecated. Use <a href="/libraries/unions/overview/">Haitch.Unions</a> instead.
---

## Result (non-generic)

Represents an operation that succeeds or fails with no success value.

### Creating results

```csharp
var success = Result.Success();
var failure = Result.Failure(Error.NotFound("item.missing", "Item not found."));

// Shorthand factory methods
var fail = Result.NotFound("item.missing", "Item not found.");
```

Shorthand factories exist for all error types: `Fail`, `Validation`, `NotFound`, `Conflict`, `Unauthorized`, `Forbidden`, `Unexpected`.

### Implicit conversion

An `Error` converts implicitly to a failed `Result`:

```csharp
Result DoWork()
{
    return Error.Validation("input.bad", "Invalid input."); // implicit failure
}
```

### Properties

| Property | Type | Description |
|---|---|---|
| `IsSuccess` | `bool` | `true` if the operation succeeded. |
| `IsFailure` | `bool` | `true` if the operation failed. |
| `Error` | `Error` | The error. Throws `InvalidOperationException` if `IsSuccess`. |

---

## Result&lt;TValue&gt;

Represents an operation that produces a `TValue` on success or an `Error` on failure.

### Creating results

```csharp
var success = Result<int>.Success(42);
var failure = Result<int>.NotFound("num.missing", "Number not found.");
```

### Implicit conversions

Both the value and an `Error` convert implicitly:

```csharp
Result<int> Parse(string s) =>
    int.TryParse(s, out var v) ? v : Error.Validation("parse.fail", "Not a number.");
```

### Properties

| Property | Type | Description |
|---|---|---|
| `IsSuccess` | `bool` | `true` if the operation succeeded. |
| `IsFailure` | `bool` | `true` if the operation failed. |
| `Value` | `TValue` | The success value. Throws `InvalidOperationException` if `IsFailure`. |
| `Error` | `Error` | The error. Throws `InvalidOperationException` if `IsSuccess`. |

---

## Result&lt;TValue, TError&gt;

Same shape as `Result<TValue>` but with a custom error type instead of the structured `Error` record.

### Creating results

```csharp
var success = Result<int, string>.Success(42);
var failure = Result<int, string>.Failure("something went wrong");
```

### Implicit conversions

```csharp
Result<int, string> Parse(string s) =>
    int.TryParse(s, out var v) ? v : "Not a number.";
```

### Properties

| Property | Type | Description |
|---|---|---|
| `IsSuccess` | `bool` | `true` if the operation succeeded. |
| `IsFailure` | `bool` | `true` if the operation failed. |
| `Value` | `TValue` | The success value. Throws if `IsFailure`. |
| `Error` | `TError` | The error. Throws if `IsSuccess`. |

---

## Equality

All three result types implement `IEquatable<T>` and support `==` / `!=`. Two results are equal if they are both successes with equal values, or both failures with equal errors.
