using System.Data.Common;
using System.Text.Json;
using Npgsql;

namespace CyTask.Api.Security;

/// <summary>Explicit content fields only: relational keys, permissions and indexed routing metadata remain queryable.</summary>
public static class EncryptedDatabase
{
    public static readonly (string Table, string Column, bool Json)[] Columns =
    [
        ("tasks", "title", false), ("tasks", "description", false), ("comments", "body", false),
        ("audit_events", "actor_name", false), ("audit_events", "summary", false),
        ("attachments", "file_name", false), ("external_references", "label", false), ("external_references", "web_url", false),
        ("task_checklist_items", "title", false), ("project_resources", "name", false), ("project_resources", "body", false),
        ("chat_channels", "topic", false), ("chat_messages", "body", false),
        ("task_plugin_data", "data", true), ("task_plugin_data_history", "data", true),
        ("cyannota_documents", "document", true), ("project_spaces", "body", true),
        ("content_plugin_data", "body", true), ("outbox_events", "payload", true),
        ("agent_members", "description", false), ("agent_notifications", "title", false), ("agent_notifications", "body", false)
    ];
    private static readonly HashSet<string> TextParameters = new(StringComparer.Ordinal)
        { "title", "description", "body", "summary", "actor_name", "file_name", "label", "web_url", "topic" };
    private const string EnvelopeProperty = "_cytask_encrypted";
    private const string Purpose = "database-content";

    public static string Encode(this DataEncryption encryption, string value, bool json) =>
        !encryption.Enabled ? value : json
            ? JsonSerializer.Serialize(new Dictionary<string, string> { [EnvelopeProperty] = encryption.ProtectText(value, Purpose) })
            : encryption.ProtectText(value, Purpose);

    public static string Decode(this DataEncryption encryption, string value)
    {
        // Startup verifies the database encryption state. Plaintext deployments
        // must preserve arbitrary user strings, including format-like prefixes.
        if (!encryption.Enabled) return value;
        if (value.StartsWith("{\"" + EnvelopeProperty + "\"", StringComparison.Ordinal))
        {
            using var document = JsonDocument.Parse(value);
            if (document.RootElement.EnumerateObject().Count() == 1 && document.RootElement.TryGetProperty(EnvelopeProperty, out var encrypted))
                return encryption.UnprotectText(encrypted.GetString()!, Purpose);
        }
        return encryption.UnprotectText(value, Purpose);
    }

    public static string ReadString(this DataEncryption encryption, DbDataReader reader, int index) => encryption.Decode(reader.GetString(index));

    private static void Prepare(NpgsqlCommand command, DataEncryption encryption)
    {
        if (!encryption.Enabled) return;
        foreach (NpgsqlParameter parameter in command.Parameters)
        {
            if (parameter.Value is not string value) continue;
            var name = parameter.ParameterName.TrimStart('@');
            var json = name is "data" or "document" or "payload" || name == "body" &&
                (command.CommandText.Contains("project_spaces", StringComparison.Ordinal) || command.CommandText.Contains("content_plugin_data", StringComparison.Ordinal));
            var resourceName = name == "name" && (command.CommandText.TrimStart().StartsWith("INSERT INTO project_resources", StringComparison.Ordinal)
                || command.CommandText.TrimStart().StartsWith("UPDATE project_resources", StringComparison.Ordinal));
            if (json || TextParameters.Contains(name) || resourceName) parameter.Value = encryption.Encode(value, json);
        }
    }
    public static Task<int> ExecuteProtectedNonQueryAsync(this NpgsqlCommand command, DataEncryption encryption, CancellationToken cancellationToken)
    { Prepare(command, encryption); return command.ExecuteNonQueryAsync(cancellationToken); }
}
