---
title: Errors
description: The Error hierarchy, ValidationError.Merge, and combining results with merged errors.
sidebar:
  order: 4
---

Unlike a single `Error` record with an `ErrorType` enum, Haitch.Unions models each kind of failure as its own record type deriving from `Error`.

## Error

```csharp
public record Error(string Code, string Description)
```

| Property | Type | Description |
|---|---|---|
| `Code` | `string` | A stable, machine-readable identifier, e.g. `"user.not_found"`. |
| `Description` | `string` | A human-readable explanation. |

Both are required: the constructor throws `ArgumentNullException` if either is null.

## The six kinds

Each kind is a record deriving from `Error` — construct it directly, there are no `Error.NotFound(...)`-style factories.

| Type | Use case |
|---|---|
| `NotFoundError` | A requested resource does not exist. |
| `ValidationError` | The input was invalid. Carries `Failures`. |
| `ConflictError` | The operation conflicts with the current state. |
| `UnauthorizedError` | The caller is not authenticated. |
| `ForbiddenError` | The caller is not allowed to perform the operation. |
| `UnexpectedError` | An unexpected error occurred. Carries an optional `Exception`. |

```csharp
new NotFoundError("user.not_found", $"No user with id {id}.");
new ConflictError("user.duplicate", "A user with that email already exists.");
new UnauthorizedError("auth.missing", "No credentials provided.");
new ForbiddenError("auth.denied", "You do not have access.");
new UnexpectedError("op.failed", "Something went wrong.", exception);
```

Return a plain `Error` for a generic, uncategorised failure that doesn't fit one of the six kinds.

## ValidationError

```csharp
public record ValidationError(
    string Code,
    string Description,
    IReadOnlyDictionary<string, string[]>? Failures = null
) : Error(Code, Description)
```

`Failures` maps a field name to its failure messages; a null argument becomes an empty dictionary.

```csharp
var error = new ValidationError(
    "user.invalid",
    "One or more fields are invalid",
    new Dictionary<string, string[]> { ["email"] = ["Email is required."] });
```

### Merging validation errors

`ValidationError.Merge` combines several validation errors into one, joining `Failures` by field:

```csharp
var merged = ValidationError.Merge(emailError, nameError);

// Or with a custom code and description
var merged2 = ValidationError.Merge(
    "user.invalid",
    "One or more fields are invalid",
    emailError,
    nameError);
```

## Combine with merged errors

`Result.Combine` has an overload that merges every error instead of stopping at the first. `ValidationError.Merge(IReadOnlyList<Error>)` fits it as a method group: it returns the first non-validation error if any of the results failed with something other than a `ValidationError`, otherwise every validation error merged with the default code and description.

```csharp
Result<IReadOnlyList<Order>> orders = Result.Combine(results, ValidationError.Merge);
```

## Custom error kinds

`Error` is an open record, so you can add your own kinds alongside the six built in:

```csharp
public record RateLimitedError(string Code, string Description, TimeSpan RetryAfter)
    : Error(Code, Description);
```
