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
}
