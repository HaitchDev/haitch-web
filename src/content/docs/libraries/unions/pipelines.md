---
title: Pipelines
description: Map, Bind, Ensure, Tap, and Match methods across Result and Optional, sync and async.
sidebar:
  order: 5
---

`Result<T>` and `Optional<T>` expose a consistent, mirrored set of methods for composing operations. Result's cases are **Ok**/**Error**; Optional's are **Some**/**None**.

## Map / Bind

`Map` transforms the value; `Bind` chains an operation that itself returns a `Result` (or `Optional`).

```csharp
Result<string> result = GetNumber().Map(n => n.ToString());

Result<Order> result = GetUserId(request)
    .Bind(id => FindUser(id))
    .Bind(user => CreateOrder(user));
```

```csharp
Optional<string> nickname = GetUser(id)
    .Bind(user => Optional<string>.From(user.Nickname));
```

## MapError

`Result<T>` only — transforms the error, leaving Ok unchanged. `Optional<T>` has no error to map.

```csharp
Result<int> result = GetNumber()
    .MapError(e => e with { Description = $"Wrapped: {e.Description}" });
```

## Ensure

Turns Ok/Some into Error/None when a predicate fails. `Result<T>.Ensure` takes the error to use for the Error case; `Optional<T>.Ensure` just clears the value.

```csharp
Result<int> result = GetAge()
    .Ensure(age => age >= 18, new ValidationError("age.min", "Must be 18 or older."));

Optional<string> nickname = GetNickname()
    .Ensure(name => name.Length > 0);
```

## Tap / TapError / TapNone

Run a side effect without changing the value. `TapError` runs on Error; Optional's counterpart, `TapNone`, runs on empty.

```csharp
var result = GetUser(id)
    .Tap(user => logger.LogInformation("Found user {Id}", user.Id))
    .TapError(error => logger.LogWarning("Lookup failed: {Code}", error.Code));

var nickname = GetNickname()
    .Tap(name => logger.LogInformation("Nickname: {Name}", name))
    .TapNone(() => logger.LogInformation("No nickname set"));
```

## OrElse

Falls back to an alternative when Error/empty.

```csharp
Result<int> result = ParsePrimary(input)
    .OrElse(_ => ParseFallback(input));

Optional<string> nickname = GetPreferredNickname(user)
    .OrElse(() => GetDefaultNickname(user));
```

## Match

Exhaustively handle both cases in a single expression.

```csharp
string message = result.Match(
    onOk: value => $"Got {value}",
    onError: error => $"Failed: {error.Description}");

string label = optional.Match(
    onSome: value => value,
    onNone: () => "none");
```

## Conversions

| From | To | Method |
|---|---|---|
| `Result<T>` | `Optional<T>` | `ToOptional()` — the value when Ok, `None` when Error. |
| `Optional<T>` | `Result<T>` | `ToResult(error)` — the value when Some, `error` when empty. |
| `Result<T>` | `Result<Unit>` | `ToUnit()` — discards the value, keeps Ok/Error. |
| `Optional<T>` (`T` struct or class) | `T?` | `ToNullable()` — the value when Some, `null` when empty. |
| `Result<T>` / `Optional<T>` | `T` | `GetValueOrDefault(fallback)`. |

## Chaining example

```csharp
Result<OrderConfirmation> result = ParseOrderRequest(raw)
    .Ensure(r => r.Items.Count > 0, new ValidationError("order.empty", "Order has no items."))
    .Bind(r => ValidateInventory(r))
    .Bind(r => ChargePayment(r))
    .Map(receipt => new OrderConfirmation(receipt.Id))
    .TapError(e => logger.LogWarning("Order failed: {Code}", e.Code));
```

## Async

Every method above has an async form, following one rule: a method named with an `…Async` suffix takes async delegates (`Func<T, Task<...>>`); the same name without the suffix takes sync delegates. Both forms exist directly on `Result<T>`/`Optional<T>` and on `Task<Result<T>>`/`Task<Optional<T>>`, so a pipeline can chain straight off an unawaited task:

```csharp
Task<Result<Order>> result = GetUserIdAsync(request)
    .BindAsync(id => FindUserAsync(id))
    .BindAsync(user => CreateOrderAsync(user));
```

Sync and async steps mix freely in the same chain, since the `Task<...>` forms of the sync-named methods await the task first and then apply a sync delegate:

```csharp
Task<Result<string>> result = ParseAsync(input)
    .Map(n => n.ToString())        // sync delegate, chained straight off a Task
    .TapAsync(n => LogAsync(n));   // async delegate
```

`Match`/`MatchAsync` are also available on `Task<Result<T>>` and `Task<Optional<T>>`. There is no overload of `Tap`/`TapError`/`TapNone` on the `Task<...>` forms that takes a plain, synchronous `Action` — only the `…Async` forms — so an async lambda passed there can't silently become async void.
