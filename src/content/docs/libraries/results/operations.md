---
title: Operations
description: Match, Map, Bind, Tap, and Ensure methods on Result types.
sidebar:
  order: 4
---

All result types expose a consistent set of methods for composing operations. The signatures below use `Result<T>` — `Result` and `Result<T, TError>` follow the same pattern.

## Match

Exhaustively handle both outcomes in a single expression.

```csharp
Result<int> result = GetValue();

string output = result.Match(
    onSuccess: value => $"Got {value}",
    onFailure: error => $"Failed: {error.Message}"
);
```

## Map / MapError

`Map` transforms the success value. `MapError` transforms the error. Neither affects the other path.

```csharp
Result<string> result = GetNumber().Map(n => n.ToString());

Result<int> result = GetNumber()
    .MapError(e => e with { Message = $"Wrapped: {e.Message}" });
```

## Bind

Chain an operation that itself returns a `Result`. This is how you compose multiple fallible operations.

```csharp
Result<Order> result = GetUserId(request)
    .Bind(id => FindUser(id))
    .Bind(user => CreateOrder(user));
```

The non-generic `Result` also has a `Bind<TOut>` overload to chain into a `Result<TOut>`:

```csharp
Result<int> result = Validate(input).Bind(() => Parse(input));
```

## Tap / TapError

Execute a side effect without changing the result. Useful for logging.

```csharp
var result = GetUser(id)
    .Tap(user => logger.LogInformation("Found user {Id}", user.Id))
    .TapError(error => logger.LogWarning("Lookup failed: {Code}", error.Code));
```

## Ensure

Convert a success to a failure if a predicate is not met.

```csharp
Result<int> result = GetAge()
    .Ensure(age => age >= 18, Error.Validation("age.min", "Must be 18 or older."));
```

## Chaining example

These methods compose into pipelines:

```csharp
Result<OrderConfirmation> result = ParseOrderRequest(raw)
    .Ensure(r => r.Items.Count > 0, Error.Validation("order.empty", "Order has no items."))
    .Bind(r => ValidateInventory(r))
    .Bind(r => ChargePayment(r))
    .Map(receipt => new OrderConfirmation(receipt.Id))
    .TapError(e => logger.LogWarning("Order failed: {Code}", e.Code));
```

## Async

Each of the methods above also have async variants.

For example:

```csharp
Result<Task<Order>> result = GetUserIdAsync(request)
    .BindAsync(async id => await FindUserAsync(id))
    .BindAsync(async user => await CreateOrderAsync(user));
```