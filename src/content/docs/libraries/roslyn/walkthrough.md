---
title: Walkthrough
description: A complete generator built with Haitch.Roslyn, from marker attribute to cacheability test.
sidebar:
  order: 7
---

This generator gives every type marked `[Sample]` a `TypeName` constant and a `ToString` override, in a generated partial declaration. A marked type that is not partial, or that already declares those members, reports a diagnostic instead. It is the sample the library's own tests run.

## The generator

```csharp
internal sealed class SampleGenerator : IIncrementalGenerator
{
    public const string MarkerMetadataName = "Sample.SampleAttribute";
    public const string ModelStepName = "SampleGenerator.Types";
    public const string ValidatedStepName = "SampleGenerator.Validated";

    public static readonly DiagnosticDescriptor NotPartial = Describe("SAMPLE001", "'{0}' must be partial");
    public static readonly DiagnosticDescriptor StaticType = Describe("SAMPLE002", "'{0}' must not be static");
    public static readonly DiagnosticDescriptor MemberConflict = Describe("SAMPLE005", "'{0}' already declares '{1}'");

    private static readonly PartialTypeDiagnostics Diagnostics = new(
        NotPartial,
        Describe("SAMPLE003", "Containing type of '{0}' must be partial"),
        Describe("SAMPLE004", "'{0}' must not be file-local"));

    private static DiagnosticDescriptor Describe(string id, string message) =>
        new(id, "Invalid [Sample] type", message, "Sample", DiagnosticSeverity.Error, isEnabledByDefault: true);

    public void Initialize(IncrementalGeneratorInitializationContext context)
    {
        context.RegisterPostInitializationOutput(static ctx =>
        {
            ctx.AddEmbeddedAttributeDefinition();
            ctx.AddMarkerAttribute("SampleAttribute.g.cs", "Sample", "SampleAttribute", AttributeTargets.Class);
        });

        var types = context.SyntaxProvider.ForTypesWithAttribute(MarkerMetadataName, ModelStepName,
            includeMembers: true);

        var valid = types
            .Select(static (item, _) => ValidateSample(item.Type, item.Syntax))
            .ReportDiagnostics(context, ValidatedStepName);

        context.RegisterSourceOutput(valid,
            static (spc, type) => spc.AddSource(HintName.For(type, "Sample"), Render(type)));
    }
}
```

Step by step:

1. **Marker attribute.** Post-initialization output adds the embedded-attribute definition and the `[Sample]` marker, so consumers need no reference to define it. See [Pipeline helpers](/libraries/roslyn/pipeline/).
2. **Find the types.** `ForTypesWithAttribute` yields one `(Type, Syntax, Attributes)` item per marked type, even when it is split across partial declarations.
3. **Validate.** Each item becomes a `Result<TypeModel>`. `ReportDiagnostics` reports the failures and passes on only the valid `TypeModel`s. See [Diagnostics](/libraries/roslyn/diagnostics/).
4. **Generate.** The output step names its file with `HintName.For`, so same-named types in different namespaces or nesting never collide.

## Validation

```csharp
private static Result<TypeModel> ValidateSample(TypeModel type, SyntaxInfo syntax)
{
    var result = PartialTypeValidation.Validate(type, syntax, Diagnostics);

    if (!result.IsSuccess)
    {
        return result;
    }

    // A static class cannot hold the instance ToString override.
    if (type.IsStatic)
    {
        return Result<TypeModel>.Failure(new DiagnosticInfo(StaticType, syntax.Location, type.Name));
    }

    // Members are present because the pipeline asked for them with includeMembers: true.
    foreach (var method in type.Methods)
    {
        if (method.Name == "ToString" && method.Parameters.IsEmpty)
        {
            return Result<TypeModel>.Failure(
                new DiagnosticInfo(MemberConflict, syntax.Location, type.Name, "ToString"));
        }
    }

    return result;
}
```

## Rendering

The output is built from models with the [typed scoped writer](/libraries/roslyn/writing/). `TypeRef`, `FieldModel` and `MethodModel` are constructed by hand.

```csharp
private static readonly TypeRef StringType = new(
    "string",
    NullableAnnotation.NotAnnotated,
    SpecialType.System_String,
    TypeKind.Class,
    IsValueType: false);

private static readonly MethodModel ToStringMethod = new(
    "ToString",
    MethodKind.Ordinary,
    StringType,
    ReturnRefKind.None,
    Accessibility.Public,
    IsStatic: false,
    IsAbstract: false,
    IsVirtual: false,
    IsOverride: true,
    IsSealed: false,
    IsAsync: false,
    IsExtern: false,
    IsExtensionMethod: false,
    IsPartialDefinition: false,
    IsPartial: false,
    IsReadOnly: false,
    ExplicitInterface: null,
    ExplicitInterfaceMemberName: null,
    TypeParameters: default,
    Parameters: default,
    Attributes: default);

private static string Render(TypeModel type)
{
    var writer = new SourceWriter();

    using (var file = writer.File())
    {
        if (type.Namespace is { } @namespace)
        {
            using var ns = file.Namespace(@namespace);
            WriteType(ns.Type(type), type);
        }
        else
        {
            WriteType(file.Type(type), type);
        }
    }

    return writer.ToString();
}

private static void WriteType(TypeScope scope, TypeModel type)
{
    using (scope)
    {
        scope.Field(
            new FieldModel(
                "TypeName",
                StringType,
                Accessibility.Public,
                IsStatic: false,
                IsReadOnly: false,
                IsConst: true,
                IsRequired: false,
                ConstantValue.ForString(type.Name),
                Attributes: default));

        using var body = scope.Method(ToStringMethod);
        body.Line("return TypeName;");
    }
}
```

For a `[Sample] public partial class Widget` in namespace `App`, the generated file declares a `public const string TypeName = "Widget";` and a `ToString` override that returns it, inside `namespace App` and `partial class Widget`.

## Member conflicts

A user-declared `ToString` or `TypeName` would make the generated output fail to compile, so the sample reports `SAMPLE005` for them. That check needs the type's members, which is why the pipeline passes `includeMembers: true`. The cost is that the item then changes on every member edit, so downstream steps recompute; leave it off when the generator never reads members. The code above shows only the `ToString` check; the full sample also checks `TypeName` as a field, property or method. A nested type or event of that name is still unguarded, because `TypeModel` does not model them.

## Testing it

```csharp
var result = GeneratorHarness.Run(new SampleGenerator(), [source]);

await Assert.That(result.Sources.Keys).Contains(HintName.For(widgetModel, "Sample"));
```

And the cacheability check over the two named steps:

```csharp
GeneratorHarness.AssertCacheable(
    new SampleGenerator(),
    [source],
    SampleGenerator.ModelStepName,
    SampleGenerator.ValidatedStepName);
```

See [Testing generators](/libraries/roslyn/testing/).
