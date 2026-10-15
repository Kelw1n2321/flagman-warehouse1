using Microsoft.Extensions.Configuration;
using Flagman.Api.Services;

namespace Flagman.Tests;

public class AdminDirectoryTests
{
    [Fact]
    public void Parses_ids_with_optional_names_and_skips_duplicates()
    {
        var list = AdminDirectory.Parse(" 1001:Иван Петров, 1002 ;; 1001:Дубль\n7Q-X ");
        Assert.Equal(["1001", "1002", "7Q-X"], list.Select(a => a.Id));
        Assert.Equal("Иван Петров", list[0].Name);
        Assert.Equal("Администратор", list[1].Name);
    }

    [Theory]
    [InlineData("1001", "Иван")]
    [InlineData(" 1002 ", "Администратор")]
    public void Finds_admin_by_exact_id(string input, string name) =>
        Assert.Equal(name, new AdminDirectory("1001:Иван,1002").Find(input)?.Name);

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("100")]
    [InlineData("10011")]
    [InlineData("Иван")]
    public void Rejects_unknown_or_empty_id(string? input) =>
        Assert.Null(new AdminDirectory("1001:Иван,1002").Find(input));

    [Fact]
    public void Empty_configuration_allows_nobody()
    {
        var dir = new AdminDirectory((string?)null);
        Assert.False(dir.IsConfigured);
        Assert.Null(dir.Find("anything"));
    }

    [Theory]
    [InlineData("Auth__AdminIds=Max-7381:Максим")]
    [InlineData("\"Max-7381:Максим\"")]
    [InlineData("  Max-7381 : Максим  ")]
    public void Tolerates_pasted_key_and_quotes(string raw)
    {
        var a = Assert.Single(AdminDirectory.Parse(raw));
        Assert.Equal(("Max-7381", "Максим"), (a.Id, a.Name));
    }

    [Theory]
    [InlineData("Auth:AdminIds")]
    [InlineData("Auth_AdminIds")]
    [InlineData("ADMIN_IDS")]
    [InlineData("auth:adminids ")]
    public void Reads_common_variable_names(string key)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection([new(key, "Max-7381")]).Build();
        Assert.NotNull(new AdminDirectory(config).Find("Max-7381"));
    }

    [Fact]
    public void Hashed_ids_match_only_the_original()
    {
        var dir = new AdminDirectory(null, AdminDirectory.HashId("FLG-TEST-0001", 1000) + ":Максим");
        Assert.True(dir.IsConfigured);
        Assert.Equal("Максим", dir.Find(" FLG-TEST-0001 ")?.Name);
        Assert.Equal("Максим", dir.Find("FLG-TEST-0001")?.Name); // повторно - из кэша
        Assert.Null(dir.Find("FLG-TEST-0002"));
        Assert.Null(dir.Find(""));
    }

    [Fact]
    public void Parses_role_suffix_and_defaults_to_manager()
    {
        var dir = new AdminDirectory("1001:Иван, 1002:Анна:waiter, 1003:ООО Фермер:supplier, 1004:waiter");
        Assert.Equal(("Иван", Roles.Manager), (dir.Find("1001")!.Name, dir.Find("1001")!.Role));
        Assert.Equal(("Анна", Roles.Waiter), (dir.Find("1002")!.Name, dir.Find("1002")!.Role));
        Assert.Equal(("ООО Фермер", Roles.Supplier), (dir.Find("1003")!.Name, dir.Find("1003")!.Role));
        Assert.Equal(("Официант", Roles.Waiter), (dir.Find("1004")!.Name, dir.Find("1004")!.Role));
    }

    [Fact]
    public void Unknown_role_skips_entry_instead_of_giving_manager_rights()
    {
        var dir = new AdminDirectory("1001:Иван:admin, 1002:Анна");
        Assert.Null(dir.Find("1001"));
        Assert.NotNull(dir.Find("1002"));
    }

    [Fact]
    public void Hashed_entry_carries_role_and_stable_key_without_id()
    {
        var dir = new AdminDirectory(null, AdminDirectory.HashId("Supplier-1", 1000) + ":ООО Фермер:supplier");
        var a = dir.Find("Supplier-1")!;
        Assert.Equal(Roles.Supplier, a.Role);
        Assert.DoesNotContain("Supplier-1", a.Key);
        Assert.Equal(a.Key, dir.Accounts.Single().Key);
        var plain = new AdminDirectory("abc:Х:supplier").Find("abc")!;
        Assert.DoesNotContain("abc", plain.Key[2..]);
    }
}
