---
title: Error model
description: The Error record and ErrorType enum.
sidebar:
  order: 2
---

## ErrorType

An enum that categorises errors.

| Member | Use case |
|---|---|
| `Failure` | Default / generic failure. |
| `Validation` | Input or state failed validation. |
| `NotFound` | A requested resource does not exist. |
| `Conflict` | Duplicate, concurrency violation, or state conflict. |
| `Unauthorized` | Missing or invalid authentication. |
| `Forbidden` | Authenticated but insufficient permissions. |
| `Unexpected` | Unhandled or unexpected scenario. |

## Error

A record with three positional properties and optional metadata.

```csharp
public record Error(string Code, string Message, ErrorType Type = ErrorType.Failure)
```

| Property | Type | Description |
|---|---|---|
| `Code` | `string` | Machine-readable identifier, e.g. `"user.not_found"`. |
| `Message` | `string` | Human-readable description. |
| `Type` | `ErrorType` | Category. Defaults to `Failure`. |
| `Metadata` | `IReadOnlyDictionary<string, object?>?` | Optional key-value data. Set via `with` expressions. |

### Factory methods

Each `ErrorType` has a corresponding static factory:

```csharp
Error.Failure("op.failed", "Something went wrong.");
Error.Validation("email.invalid", "Email format is invalid.");
Error.NotFound("order.not_found", "Order does not exist.");
Error.Conflict("user.duplicate", "A user with that email already exists.");
Error.Unauthorized("auth.missing", "No credentials provided.");
Error.Forbidden("auth.denied", "You do not have access.");
Error.Unexpected("unhandled", "An unexpected error occurred.");
```

### Metadata

Attach arbitrary data using `with`:

```csharp
var error = Error.Validation("field.required", "Name is required.")
    with { Metadata = new Dictionary<string, object?> { ["field"] = "name" } };
```
