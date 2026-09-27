---
title: ASP.NET Core
description: Mapping Result of T and Error to HTTP results and ProblemDetails.
sidebar:
  order: 6
---

`Haitch.Unions.AspNetCore` maps `Result<T>` to minimal API results, and `Error` to HTTP status codes and `ProblemDetails`.

## Installation

```sh
dotnet add package Haitch.Unions.AspNetCore
```

## ToHttpResult / ToHttpResultAsync

`Result<T>.ToHttpResult()` returns 200 OK with the value when Ok, otherwise the error's `ProblemDetails`. `Result<Unit>.ToHttpResult()` returns 204 No Content instead of 200 OK on Ok. Both have `Task<...>` async forms, `ToHttpResultAsync()`.

```csharp
app.MapGet("/orders/{id:int}", (int id, IOrderRepository repository) =>
    GetOrder(repository, id).ToHttpResult());

app.MapDelete("/orders/{id:int}", (int id, IOrderRepository repository) =>
    DeleteOrder(repository, id).ToHttpResult());

app.MapGet("/orders/{id:int}/async", (int id, IOrderRepository repository) =>
    GetOrderAsync(repository, id).ToHttpResultAsync());
```

## ToStatusCode

Maps an `Error` to an HTTP status code by its kind, unless the error implements `IHttpError` — then its `StatusCode` wins.

| Error kind | Status code |
|---|---|
| `NotFoundError` | 404 Not Found |
| `ValidationError` | 400 Bad Request |
| `ConflictError` | 409 Conflict |
| `UnauthorizedError` | 401 Unauthorized |
| `ForbiddenError` | 403 Forbidden |
| `UnexpectedError` | 500 Internal Server Error |
| A plain `Error`, or any other kind | 400 Bad Request |

## ToProblemDetails

Builds a `ProblemDetails` — or an `HttpValidationProblemDetails` populated from `Failures`, for a `ValidationError` — with `Status` from `ToStatusCode()`, `Detail` from `Description`, and the error's `Code` added to `Extensions["code"]`.

## IHttpError

Implement `IHttpError` on a custom error kind to choose its own status code instead of relying on the kind-based mapping:

```csharp
public record RateLimitedError(string Code, string Description) : Error(Code, Description), IHttpError
{
    public int StatusCode => StatusCodes.Status429TooManyRequests;
}
```
