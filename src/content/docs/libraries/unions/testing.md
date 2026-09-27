---
title: Testing with TUnit
description: TUnit assertions for Result of T and Optional of T.
sidebar:
  order: 7
---

`Haitch.Unions.TUnit.Assertions` provides assertions for `Result<T>` and `Optional<T>`, including their `Task<...>` forms.

## Installation

```sh
dotnet add package Haitch.Unions.TUnit.Assertions
```

## Result assertions

```csharp
await result.AssertOk();
await result.AssertOk(expectedValue);

await result.AssertError();
await result.AssertError(expectedError);
```

### Per-kind helpers

Each of the six error kinds has a helper that asserts the result is Error and returns the typed error for further assertions:

```csharp
ValidationError error = await result.AssertValidation();
await Assert.That(error.Failures).ContainsKey("email");
```

| Helper | Returns |
|---|---|
| `AssertNotFound()` | `NotFoundError` |
| `AssertValidation()` | `ValidationError` |
| `AssertConflict()` | `ConflictError` |
| `AssertUnauthorized()` | `UnauthorizedError` |
| `AssertForbidden()` | `ForbiddenError` |
| `AssertUnexpected()` | `UnexpectedError` |

### Custom error kinds

For a custom error kind, or any kind without a dedicated helper, use the general `AssertError<TError>()`. It's declared alongside `T` in the same extension block as the `Result<T>` it applies to, so both type arguments are given explicitly at the call site:

```csharp
var error = await result.AssertError<int, ValidationError>();
```

## Optional assertions

```csharp
await optional.AssertSome();
await optional.AssertSome(expectedValue);

await optional.AssertNone();
```

## Task forms

Every assertion above also works directly on `Task<Result<T>>` and `Task<Optional<T>>`, awaiting the task first:

```csharp
await GetUserAsync(id).AssertOk();

var error = await GetUserAsync(id).AssertNotFound();
```
