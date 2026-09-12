using Mnemo.Host.Backup;

namespace Mnemo.Host.Tests.Backup;

public sealed class ProfileRestoreGrantsTests
{
    [Fact]
    public void TryConsume_AcceptsAGrantOnce()
    {
        var grants = new ProfileRestoreGrants(new TestTimeProvider());
        var path = Path.GetFullPath("profile.mnemo-backup");

        var token = grants.Issue(path);

        Assert.True(grants.TryConsume(token, out var consumed));
        Assert.Equal(path, consumed);
        Assert.False(grants.TryConsume(token, out _));
    }

    [Fact]
    public void TryConsume_RejectsAnExpiredGrant()
    {
        var time = new TestTimeProvider();
        var grants = new ProfileRestoreGrants(time);
        var token = grants.Issue("profile.mnemo-backup");
        time.Advance(TimeSpan.FromMinutes(10));

        Assert.False(grants.TryConsume(token, out _));
    }

    private sealed class TestTimeProvider : TimeProvider
    {
        private DateTimeOffset _utcNow = new(2026, 9, 12, 12, 0, 0, TimeSpan.Zero);

        public override DateTimeOffset GetUtcNow() => _utcNow;

        public void Advance(TimeSpan duration) => _utcNow += duration;
    }
}
