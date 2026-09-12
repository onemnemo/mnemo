namespace Mnemo.Core.Services;

public sealed class ProfileBackupException : Exception
{
    public ProfileBackupException(string code, string message)
        : base(message)
    {
        Code = code;
    }

    public ProfileBackupException(string code, string message, Exception innerException)
        : base(message, innerException)
    {
        Code = code;
    }

    public string Code { get; }
}
