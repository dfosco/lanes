import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsSection, SettingsSelect } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import {
  laneEnvironmentAssignManagerRpc, laneEnvironmentClearManagerRpc, laneEnvironmentContinueRpc, laneEnvironmentPreferences, laneEnvironmentSettings,
  laneEnvironmentStatusRpc, type LaneEnvironmentSettings,
} from "../shared/lane-environment";
import type { AgentInfo } from "../shared/work";
import { useRuntime } from "./runtime";

type Theme = PluginSurfaceProps["theme"];
type SettingsDraft = { revision: string; values: LaneEnvironmentSettings };
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const inputStyle = (theme: Theme) => ({ minHeight: 38, padding: 9, borderWidth: 1, borderColor: theme.colors.border,
  borderRadius: 6, color: theme.colors.foreground, backgroundColor: theme.colors.surface0, fontSize: 13 });

function Toggle({ label, hint, value, onValueChange, theme, disabled }: {
  label: string; hint: string; value: boolean; onValueChange: (value: boolean) => void; theme: Theme; disabled?: boolean;
}) {
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 5 }}>
    <View style={{ flex: 1, gap: 3 }}>
      <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>{label}</Text>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>{hint}</Text>
    </View>
    <Switch value={value} onValueChange={onValueChange} disabled={disabled}
      trackColor={{ false: theme.colors.border, true: theme.colors.accent }} />
  </View>;
}

function EnvironmentPreferences({ theme, hostId }: { theme: Theme; hostId: string }) {
  const settings = useSettings(laneEnvironmentPreferences);
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  if (settings.status === "loading") return <ActivityIndicator color={theme.colors.foregroundMuted} />;
  if (settings.status !== "ready") return <SettingsSection title="Lanes workspace defaults"><SettingsCard>
    <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger }}>Workspace settings unavailable on {hostId}: {settings.error}</Text>
    <SettingsAction label="Workspace settings" actionLabel="Reload settings" onPress={() => void settings.reload()} />
  </SettingsCard></SettingsSection>;

  const values = draft?.values ?? settings.values;
  const stale = Boolean(draft && draft.revision !== settings.revision);
  const update = (change: Partial<LaneEnvironmentSettings>) => {
    setError(null);
    setDraft((current) => ({ revision: current?.revision ?? settings.revision,
      values: { ...(current?.values ?? settings.values), ...change } }));
  };
  const save = async () => {
    if (!draft || stale || saving) return;
    setSaving(true); setError(null);
    try {
      const saved = await settings.save(draft.values, draft.revision);
      if (!saved) { setError("Workspace settings changed or could not be saved. Your edits are preserved; reload before retrying."); return; }
      await settings.reload(); setDraft(null);
    } catch (saveError) { setError(`Could not save workspace settings: ${message(saveError)}`); }
    finally { setSaving(false); }
  };

  return <SettingsSection title="Lanes workspace defaults"><SettingsCard>
    <Toggle label="Enable Lanes in new workspaces" hint="Applies only to workspaces created after this setting is enabled. Existing workspaces are not adopted."
      value={values.activateNewWorkspaces} disabled={saving} theme={theme}
      onValueChange={(activateNewWorkspaces) => update({ activateNewWorkspaces })} />
    <Toggle label="Assign the first agent as Lane Manager" hint="In an activated workspace, the first eligible agent receives the Lane Manager role at creation."
      value={values.firstAgentManager} disabled={saving} theme={theme}
      onValueChange={(firstAgentManager) => update({ firstAgentManager })} />
    <SettingsSelect label="Agent title style" value={values.titleMode} options={[
      { value: "emoji-topic", label: "Role emoji · topic" }, { value: "role-name", label: "Role name: topic" },
    ]} onValueChange={(titleMode) => update({ titleMode: titleMode as LaneEnvironmentSettings["titleMode"] })} />
    {values.titleMode === "emoji-topic" ? <View style={{ gap: 8 }}>
      {(["lane-manager", "lane-dev", "design-engineer"] as const).map((role) => <View key={role} style={{ gap: 3 }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>{role === "lane-manager" ? "Lane Manager emoji" : role === "lane-dev" ? "Lane Dev emoji" : "Design Engineer emoji"}</Text>
        <TextInput accessibilityLabel={`${role} emoji`} value={values.roleEmojis[role]} onChangeText={(value) => update({
          roleEmojis: { ...values.roleEmojis, [role]: value },
        })} style={inputStyle(theme)} />
      </View>)}
    </View> : null}
    {stale ? <Text accessibilityRole="alert" style={{ color: theme.colors.statusWarning, fontSize: 12 }}>
      Host settings changed while you were editing. Your draft is preserved and has not been saved.
    </Text> : null}
    {error || settings.saveError ? <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger, fontSize: 12 }}>{error ?? settings.saveError}</Text> : null}
    <View style={{ flexDirection: "row", gap: 7, flexWrap: "wrap" }}>
      <SettingsAction label="Workspace defaults" actionLabel={saving || settings.saving ? "Saving…" : "Save workspace defaults"}
        disabled={!draft || stale || saving || settings.saving} onPress={() => void save()} />
      {draft ? <SettingsAction label="Unsaved workspace defaults" actionLabel="Discard edits and reload" disabled={saving}
        onPress={() => { setDraft(null); setError(null); void settings.reload(); }} /> : null}
    </View>
  </SettingsCard></SettingsSection>;
}

/** Exact workspace controls are shared by the composer pill and the workspace panel/command center. */
export function LaneWorkspaceControls({ theme, hostId, workspaceId, agentId, compact = false }: {
  theme: Theme; hostId: string; workspaceId: string; agentId?: string; compact?: boolean;
}) {
  const settings = useSettings(laneEnvironmentPreferences);
  const runtime = useRuntime(hostId);
  const fetchStatus = useRpc(laneEnvironmentStatusRpc);
  const assignManager = useRpc(laneEnvironmentAssignManagerRpc);
  const clearManager = useRpc(laneEnvironmentClearManagerRpc);
  const continueManager = useRpc(laneEnvironmentContinueRpc);
  const cache = useQueryClient();
  const [selectedAgentId, setSelectedAgentId] = useState(agentId ?? "");
  const [checkpoint, setCheckpoint] = useState("");
  const [operationError, setOperationError] = useState<string | null>(null);
  const status = useQuery({ queryKey: ["clips.lane-environment.status", hostId, workspaceId],
    queryFn: () => fetchStatus({ workspaceId }), enabled: Boolean(hostId && workspaceId), refetchInterval: 10_000 });
  const workspaceAgents = (runtime.data?.agents ?? []).filter((agent) => agent.workspaceId === workspaceId && agent.status !== "closed");
  const selectedAgent = workspaceAgents.find((agent) => agent.id === (agentId ?? selectedAgentId));
  const currentManager = workspaceAgents.find((agent) => agent.id === status.data?.workspace.managerId);
  const environmentSettings = settings.status === "ready" ? laneEnvironmentSettings.parse(settings.values) : null;
  const workspaceEnabled = environmentSettings?.workspaces[workspaceId]?.enabled ?? status.data?.workspace.enabled ?? false;
  const saveWorkspaceEnabled = async (enabled: boolean) => {
    if (settings.status !== "ready") { setOperationError("Workspace settings are unavailable on this host."); return; }
    const current = laneEnvironmentSettings.parse(settings.values);
    const next = { ...current, workspaces: { ...current.workspaces, [workspaceId]: { enabled } } };
    const saved = await settings.save(next, settings.revision);
    if (!saved) { setOperationError("Workspace activation could not be saved. Reload settings and retry."); return; }
    setOperationError(null); await settings.reload(); await status.refetch();
  };
  const unsetOverride = async () => {
    if (settings.status !== "ready") return;
    const current = laneEnvironmentSettings.parse(settings.values);
    const workspaces = { ...current.workspaces }; delete workspaces[workspaceId];
    const saved = await settings.save({ ...current, workspaces }, settings.revision);
    if (!saved) { setOperationError("Could not remove the workspace override. Reload settings and retry."); return; }
    setOperationError(null); await settings.reload(); await status.refetch();
  };
  const assign = useMutation({
    mutationFn: (targetId: string) => assignManager({ workspaceId, agentId: targetId, expectedRevision: status.data?.storeRevision }),
    onSuccess: async (result) => {
      cache.setQueryData(["clips.lane-environment.status", hostId, workspaceId], {
        storeRevision: result.storeRevision, workspace: result.workspace,
      });
      setOperationError(result.assignmentApplied ? result.guidanceError ?? null : result.assignmentError ?? "Manager assignment was not applied.");
      await cache.invalidateQueries({ queryKey: ["clips-runtime", hostId] });
    },
    onError: async (error) => {
      setOperationError(`Manager assignment failed: ${message(error)}`);
      try { await status.refetch(); } catch { /* Keep the actionable mutation error visible. */ }
    },
  });
  const unassign = useMutation({
    mutationFn: (targetId: string) => clearManager({ workspaceId, agentId: targetId, expectedRevision: status.data?.storeRevision }),
    onSuccess: async (result) => {
      cache.setQueryData(["clips.lane-environment.status", hostId, workspaceId], {
        storeRevision: result.storeRevision, workspace: result.workspace,
      });
      setOperationError(result.assignmentApplied ? null : result.assignmentError ?? result.titleError ?? "Workspace planner was not cleared.");
      await cache.invalidateQueries({ queryKey: ["clips-runtime", hostId] });
    },
    onError: async (error) => {
      setOperationError(`Workspace planner could not be cleared: ${message(error)}`);
      try { await status.refetch(); } catch { /* Keep the actionable mutation error visible. */ }
    },
  });
  const continuation = useMutation({
    mutationFn: () => continueManager({ workspaceId, fromAgentId: status.data!.workspace.managerId!,
      expectedRevision: status.data?.storeRevision, checkpoint }),
    onSuccess: async (result) => {
      cache.setQueryData(["clips.lane-environment.status", hostId, workspaceId], {
        storeRevision: result.storeRevision, workspace: result.workspace,
      });
      setCheckpoint(""); setOperationError(result.titleApplied === true ? null : result.titleError ?? "Former-manager title was not confirmed.");
      await status.refetch(); await cache.invalidateQueries({ queryKey: ["clips-runtime", hostId] });
    },
    onError: (error) => setOperationError(`Manager continuation failed: ${message(error)}`),
  });
  const assignmentFeedback = assign.data;
  const continuationFeedback = continuation.data;
  const isLoading = status.isLoading || runtime.isLoading;

  if (compact) {
    // Workspace enablement and planner identity are separate canonical values and remain independently toggleable.
    const isManager = Boolean(agentId) && status.data?.workspace.managerId === agentId;
    const plannerBusy = assign.isPending || unassign.isPending || continuation.isPending ||
      status.data?.workspace.continuation?.status === "creating";
    const plannerDisabled = !agentId || !selectedAgent || settings.status !== "ready" || settings.saving ||
      !status.data || status.isLoading || runtime.isLoading || runtime.isError || plannerBusy || (!isManager && !workspaceEnabled);
    const toggleDisabled = settings.status !== "ready" || settings.saving;
    const titleWarning = assignmentFeedback?.assignmentApplied && assignmentFeedback.titleApplied === false;
    const note = operationError ?? (status.isError ? `Lanes status unavailable: ${message(status.error)}` : null)
      ?? (assignmentFeedback?.guidanceError ?? null)
      ?? (unassign.data?.titleError ?? null)
      ?? (titleWarning ? "Saved, but the agent title was not updated." : null);
    return <View style={{ gap: 10, padding: 12, width: 376, maxWidth: "100%" }}>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: workspaceEnabled, disabled: toggleDisabled }}
        accessibilityLabel="Enable lanes workspace" disabled={toggleDisabled}
        onPress={() => void saveWorkspaceEnabled(!workspaceEnabled)}
        style={{ flexDirection: "row", alignItems: "center", gap: 8, opacity: toggleDisabled ? 0.5 : 1 }}>
        <View style={{ width: 16, height: 16, borderRadius: 4, borderWidth: 1.5, alignItems: "center", justifyContent: "center",
          borderColor: workspaceEnabled ? theme.colors.accent : theme.colors.foregroundMuted,
          backgroundColor: workspaceEnabled ? theme.colors.accent : "transparent" }}>
          {workspaceEnabled ? <Text style={{ color: theme.colors.accentForeground, fontSize: 11, lineHeight: 13, fontWeight: "700" }}>✓</Text> : null}
        </View>
        <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>Enable lanes workspace</Text>
      </Pressable>
      <Pressable accessibilityRole="checkbox" accessibilityLabel="Make this agent the workspace planner"
        accessibilityState={{ checked: isManager, disabled: plannerDisabled }} disabled={plannerDisabled}
        onPress={() => {
          setOperationError(null);
          if (!agentId) return;
          if (isManager) unassign.mutate(agentId);
          else assign.mutate(agentId);
        }}
        style={{ flexDirection: "row", alignItems: "center", gap: 8, opacity: plannerDisabled ? 0.45 : 1 }}>
          <View style={{ width: 16, height: 16, borderRadius: 4, borderWidth: 1.5, alignItems: "center", justifyContent: "center",
            borderColor: isManager ? theme.colors.accent : theme.colors.foregroundMuted,
            backgroundColor: isManager ? theme.colors.accent : "transparent" }}>
            {isManager ? <Text style={{ color: theme.colors.accentForeground, fontSize: 11, lineHeight: 13, fontWeight: "700" }}>✓</Text> : null}
          </View>
          <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>
            {plannerBusy ? "Updating workspace planner…" : "Make this agent the workspace planner"}
          </Text>
      </Pressable>
      {note ? <Text accessibilityRole="alert" numberOfLines={2}
        style={{ fontSize: 12, lineHeight: 15, color: operationError || status.isError ? theme.colors.statusDanger : theme.colors.statusWarning }}>
        {note}
      </Text> : null}
    </View>;
  }

  return <SettingsSection title="Lanes workspace">
    <SettingsCard>
      <Text style={{ color: theme.colors.foreground, fontSize: 14, fontWeight: "700" }}>Workspace Lanes mode</Text>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Workspace {workspaceId} · host {hostId}</Text>
      {isLoading ? <ActivityIndicator color={theme.colors.foregroundMuted} /> : null}
      {status.isError ? <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger }}>Workspace status unavailable: {message(status.error)}</Text> : null}
      {runtime.isError ? <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger }}>
        Same-host agents unavailable: {message(runtime.error)}. Manager assignment is disabled.
      </Text> : null}
      {settings.status === "error" || settings.status === "invalid" ? <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger }}>
        Host settings unavailable: {settings.error}
      </Text> : null}
      <Toggle label="Enable Lanes in this workspace" hint={status.data?.workspace.enabledSource === "default"
        ? "Currently enabled by the new-workspace default. You can add an explicit workspace override." : "This override applies only to this workspace."}
        value={workspaceEnabled} theme={theme} disabled={settings.status !== "ready" || settings.saving}
        onValueChange={(enabled) => void saveWorkspaceEnabled(enabled)} />
      {environmentSettings && Boolean(environmentSettings.workspaces[workspaceId]) ? <View style={{ gap: 2 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Remove workspace override"
          onPress={() => void unsetOverride()} style={{ alignSelf: "flex-start", paddingVertical: 5 }}>
          <Text style={{ color: theme.colors.accent, fontSize: 12 }}>Remove workspace override</Text>
        </Pressable>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
          Removing the override restores this workspace’s recorded activation state; new-workspace defaults do not adopt existing workspaces.
        </Text>
      </View> : null}
      {status.data ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
        Activation: {status.data.workspace.enabled ? "On" : "Off"} · {status.data.workspace.enabledSource}
        {currentManager ? ` · Manager: ${currentManager.title || currentManager.id} (${currentManager.status})`
          : status.data.workspace.managerId ? ` · Manager session ${status.data.workspace.managerId} is not in the current host’s live list`
            : " · No manager assigned"}
      </Text> : null}
      {!agentId ? <SettingsSelect label="Agent in this workspace" value={selectedAgentId} options={[
        { value: "", label: workspaceAgents.length ? "Choose an agent" : "No agents in this workspace" },
        ...workspaceAgents.map((agent) => ({ value: agent.id, label: `${agent.title || "Untitled agent"} · ${agent.status}` })),
      ]} onValueChange={setSelectedAgentId} /> : <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
        Current session: {selectedAgent?.title || agentId}. A running session’s role guidance cannot be changed in place; choose a role when launching a session.
      </Text>}
      <SettingsAction label="Workspace manager" actionLabel={assign.isPending ? "Assigning…" : agentId ? "Make this agent Lane Manager" : "Make selected agent Lane Manager"}
        hint="Promotes the chosen session for this workspace. The verified public Paseo title update is reported below."
        disabled={!status.data?.workspace.enabled || !selectedAgent || runtime.isError || assign.isPending ||
          status.data.workspace.managerId === (agentId ?? selectedAgentId)}
        onPress={() => { setOperationError(null); assign.mutate(agentId ?? selectedAgentId); }} />
      {assignmentFeedback ? <View style={{ gap: 4 }}>
        <Text style={{ color: assignmentFeedback.assignmentApplied ? theme.colors.statusSuccess : theme.colors.statusWarning, fontSize: 12 }}>
          {assignmentFeedback.assignmentApplied ? "Manager assignment saved." : "Manager assignment was not saved."}
        </Text>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Lane Manager title: {assignmentFeedback.titleApplied === true ? "applied and verified" : assignmentFeedback.titleApplied === false ? "not applied" : "not confirmed"} · {assignmentFeedback.advisoryTitle}</Text>
        {assignmentFeedback.titleError ? <Text style={{ color: theme.colors.statusWarning, fontSize: 12 }}>{assignmentFeedback.titleError}</Text> : null}
        {assignmentFeedback.formerManagerTitleApplied !== null ? <Text style={{ color: assignmentFeedback.formerManagerTitleApplied ? theme.colors.foregroundMuted : theme.colors.statusWarning, fontSize: 12 }}>
          Former manager title: {assignmentFeedback.formerManagerTitleApplied ? "applied and verified" : "not applied or confirmed"} · {assignmentFeedback.formerManagerAdvisoryTitle}
        </Text> : null}
        {assignmentFeedback.formerManagerTitleError ? <Text style={{ color: theme.colors.statusWarning, fontSize: 12 }}>{assignmentFeedback.formerManagerTitleError}</Text> : null}
        {assignmentFeedback.assignmentError ? <Text style={{ color: theme.colors.statusDanger, fontSize: 12 }}>{assignmentFeedback.assignmentError}</Text> : null}
        {assignmentFeedback.guidanceError ? <Text accessibilityRole="alert" style={{ color: theme.colors.statusWarning, fontSize: 12 }}>{assignmentFeedback.guidanceError}</Text> : null}
      </View> : null}
      {currentManager && currentManager.status === "idle" && status.data?.workspace.managerId ? <View style={{ gap: 7 }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>Continue from a checkpoint</Text>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>
          Starts a new session in this workspace. It is not a transcript fork and uses the current manager’s provider/model.
        </Text>
        <TextInput accessibilityLabel="Manager continuation checkpoint" multiline value={checkpoint} onChangeText={setCheckpoint}
          placeholder="Paste the acknowledged handoff checkpoint" placeholderTextColor={theme.colors.foregroundMuted}
          style={{ ...inputStyle(theme), minHeight: 75, textAlignVertical: "top" }} />
        <SettingsAction label="Manager continuation" actionLabel={continuation.isPending ? "Continuing…" : "Start new manager session"}
          disabled={!workspaceEnabled || !checkpoint.trim() || continuation.isPending || assign.isPending}
          onPress={() => { setOperationError(null); continuation.mutate(); }} />
      </View> : null}
      {continuationFeedback ? <View style={{ gap: 4 }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>New manager session: {continuationFeedback.newAgentId}</Text>
        <Text style={{ color: continuationFeedback.titleApplied === true ? theme.colors.foregroundMuted : theme.colors.statusWarning, fontSize: 12 }}>
          Former-manager title: {continuationFeedback.titleApplied === true ? "applied and verified" : continuationFeedback.titleApplied === false ? "not applied" : "not confirmed"} · {continuationFeedback.advisoryTitle}
        </Text>
        {continuationFeedback.titleError ? <Text style={{ color: theme.colors.statusWarning, fontSize: 12 }}>{continuationFeedback.titleError}</Text> : null}
        {continuationFeedback.limitations.map((limitation, index) => <Text key={index} style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{limitation}</Text>)}
        {continuationFeedback.demotionNotice === "failed" ? <Text style={{ color: theme.colors.statusWarning, fontSize: 12 }}>The previous manager could not be notified to stop writing.</Text> : null}
      </View> : null}
      {operationError ? <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger, fontSize: 12 }}>{operationError}</Text> : null}
      <SettingsAction label="Refresh workspace state" actionLabel="Refresh status" onPress={() => {
        void status.refetch(); void runtime.refetch();
      }} />
    </SettingsCard>
  </SettingsSection>;
}

export function LaneEnvironmentSettings({ theme, hostId }: { theme: Theme; hostId: string }) {
  return <View style={{ gap: 12 }}><EnvironmentPreferences theme={theme} hostId={hostId} /></View>;
}

/** Popover content registered for one existing agent; it never falls through to another host. */
export function LaneComposerPopover({ theme, host, workspaceId, agentId, close }: {
  theme: Theme; host: PluginSurfaceProps["host"]; workspaceId: string; agentId: string; close(): void;
}) {
  return <LaneWorkspaceControls compact theme={theme} hostId={host.id} workspaceId={workspaceId} agentId={agentId} />;
}
