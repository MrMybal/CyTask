using CyTask.Api.Configuration;
using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.Extensions.Options;
using MimeKit;

namespace CyTask.Api.Security;
public interface IMfaMailer
{
    Task SendAsync(string recipient,string code,CancellationToken cancellationToken);
}
public sealed class SmtpMfaMailer(IOptions<CyTaskOptions> options) : IMfaMailer
{
    public async Task SendAsync(string recipient,string code,CancellationToken cancellationToken)
    {
        var value=options.Value;using var timeout=CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);timeout.CancelAfter(TimeSpan.FromSeconds(20));
        var message=new MimeMessage();message.From.Add(MailboxAddress.Parse(value.SmtpFrom!));message.To.Add(MailboxAddress.Parse(recipient));
        message.Subject=$"{value.MfaIssuer} — verification code";
        message.Body=new TextPart("plain"){Text=$"Your {value.MfaIssuer} verification code is: {code}\n\nThis code expires in 5 minutes and can only be used once. If you did not request it, ignore this email. Never share this code."};
        using var client=new SmtpClient{Timeout=20_000};
        await client.ConnectAsync(value.SmtpHost!,value.SmtpPort,value.SmtpSecurity=="SslOnConnect"?SecureSocketOptions.SslOnConnect:SecureSocketOptions.StartTls,timeout.Token);
        if(!string.IsNullOrEmpty(value.SmtpUsername))await client.AuthenticateAsync(value.SmtpUsername,value.SmtpPassword!,timeout.Token);
        await client.SendAsync(message,timeout.Token);await client.DisconnectAsync(true,timeout.Token);
    }
}
