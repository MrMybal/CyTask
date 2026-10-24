namespace CyTask.Api.LocalSync;

// All local stores use the same gate so a sync capture/merge cannot replace
// a mutation that arrived between capturing and restoring the workspace.
public sealed class LocalStateClock
{
    public object Gate { get; } = new();
    public long Version { get; private set; }

    public void Changed()
    {
        lock (Gate) Version++;
    }
}
