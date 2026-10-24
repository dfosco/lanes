import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsSection, SettingsSelect } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import {
  collaborationRpc, projectsRpc, roleModelDefaultsRpc, saveRoleModelDefaultsRpc,
  boardRpc, preferences, type AgentRole, type Preferences,
} from "../shared/contracts";
import { FULL_ACCESS_MODE } from "../shared/permission-modes";
import { AgentConfigFields } from "./agent-configuration";
import { ResourceSettings } from "./resource-settings";

type Theme = PluginSurfaceProps["theme"];
type Section = "collaboration" | "resources" | AgentRole;

function Nav({ section, setSection, theme }: { section: Section; setSection: (section: Section) => void; theme: Theme }) {
  const items: [Section, string][] = [["collaboration", "Collaboration"], ["manager", "Lane Manager"], ["dev", "Lane Dev"], ["resources", "Resources"]];
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 14 }}>
    {items.map(([value, label]) => <Pressable key={value} accessibilityRole="button" onPress={() => setSection(value)}
      style={{ borderWidth: 1, borderColor: section === value ? theme.colors.accent : theme.colors.border,
        backgroundColor: section === value ? theme.colors.accent : "transparent", borderRadius: 7, paddingVertical: 7, paddingHorizontal: 10 }}>
      <Text style={{ color: section === value ? theme.colors.accentForeground : theme.colors.foreground, fontSize: 12 }}>{label}</Text>
    </Pressable>)}
  </View>;
}

function CollaborationSettings({ theme }: { theme: Theme }) {
  const fetchProjects = useRpc(projectsRpc);
  const fetchBoard = useRpc(boardRpc);
  const update = useRpc(collaborationRpc);
  const cache = useQueryClient();
  const projects = useQuery({ queryKey: ["clips.settings.projects"], queryFn: () => fetchProjects({}) });
  const [projectId, setProjectId] = useState("");
  const selected = projects.data?.projects.find((project) => project.projectId === projectId) ?? projects.data?.projects[0];
  const board = useQuery({ queryKey: ["clips.settings.collaboration", selected?.projectId],
    queryFn: () => fetchBoard({ projectId: selected!.projectId }), enabled: Boolean(selected) });
  const mutation = useMutation({ mutationFn: (input: { projectId: string; enabled: boolean }) => update(input),
    onSuccess: async (result, input) => { await cache.invalidateQueries({ queryKey: ["clips.board"] });
      cache.setQueryData(["clips.settings.collaboration", input.projectId], result); } });
  const capability = board.data?.collaboration;
  const savingThisProject = mutation.isPending && mutation.variables?.projectId === selected?.projectId;
  const errorThisProject = mutation.isError && mutation.variables?.projectId === selected?.projectId;
  return <SettingsSection title="Project collaboration">
    <SettingsCard>
      {projects.isLoading ? <ActivityIndicator color={theme.colors.foregroundMuted} /> : null}
      {projects.isError ? <Text style={{ color: theme.colors.statusDanger }}>Projects unavailable: {String(projects.error)}</Text> : null}
      {selected ? <>
        <SettingsSelect label="Project" hint="Collaboration is stored in the selected project’s Lanes configuration."
          value={selected.projectId} options={(projects.data?.projects ?? []).map((p) => ({ value: p.projectId, label: p.label }))}
          onValueChange={setProjectId} />
        {board.isLoading ? <ActivityIndicator color={theme.colors.foregroundMuted} /> : null}
        {board.isError ? <Text style={{ color: theme.colors.statusDanger }}>Collaboration state unavailable: {String(board.error)}</Text> : null}
        {capability ? <SettingsAction label="GitHub collaboration" hint={capability.error ??
          `Project setting · ${capability.state}${capability.scope ? ` · ${capability.scope}` : ""}`}
          actionLabel={savingThisProject ? "Saving…" : capability.enabled === null ? "Unavailable" : capability.enabled ? "Disable" : "Enable"}
          disabled={savingThisProject || capability.enabled === null || capability.state === "invalid"}
          onPress={() => mutation.mutate({ projectId: selected.projectId, enabled: !capability.enabled })} /> : null}
        {errorThisProject ? <Text style={{ color: theme.colors.statusDanger }}>Could not update project collaboration: {String(mutation.error)}</Text> : null}
      </> : null}
    </SettingsCard>
  </SettingsSection>;
}

function RoleSettings({ role, theme, hostId }: { role: AgentRole; theme: Theme; hostId: string }) {
  const settings = useSettings(preferences);
  const fetchDefaults = useRpc(roleModelDefaultsRpc);
  const saveDefaults = useRpc(saveRoleModelDefaultsRpc);
  const values = settings.status === "ready" ? settings.values : preferences.schema.parse({});
  const settingsRevision = settings.status === "ready" ? settings.revision : "";
  const rolePrefs = values.roles[role];
  const query = useQuery({ queryKey: ["clips.role-defaults", role, rolePrefs.legacyModelMigrated],
    queryFn: () => fetchDefaults({ role, legacyDisabled: rolePrefs.legacyModelMigrated }) });
  const initial = query.data;
  const [agent, setAgent] = useState<string | undefined>(undefined);
  const [thinking, setThinking] = useState<string | undefined>(undefined);
  const [featureValues, setFeatureValues] = useState<Record<string, string | boolean> | undefined>(undefined);
  const [modeId, setModeId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const modelAgent = agent ?? initial?.agent ?? "";
  const effectiveThinking = thinking ?? initial?.reasoningEffort ?? "";
  const effectiveFeatures = featureValues ?? rolePrefs.featureValues;
  const effectiveMode = modeId ?? rolePrefs.modeId;
  const changed = Boolean(initial && (modelAgent !== (initial.agent ?? "") || effectiveThinking !== initial.reasoningEffort ||
    JSON.stringify(effectiveFeatures) !== JSON.stringify(rolePrefs.featureValues) || effectiveMode !== rolePrefs.modeId));
  const save = async () => {
    if (!initial) return;
    setSaving(true); setError(null);
    const legacyDisabledPrefs: Preferences = { ...values, roles: { ...values.roles,
      [role]: { ...rolePrefs, legacyModelMigrated: true, featureValues: effectiveFeatures, modeId: effectiveMode } } };
    try {
      const savedMarker = await settings.save(legacyDisabledPrefs, settingsRevision);
      if (!savedMarker) {
        setError(`Could not record that ${role} legacy defaults were retired. No canonical model keys were changed.`);
        return;
      }
      const model = (agent ?? modelAgent).includes("/") ? (agent ?? modelAgent).slice((agent ?? modelAgent).indexOf("/") + 1) : (agent ?? modelAgent);
      try {
        await saveDefaults({ role, model, reasoningEffort: effectiveThinking });
      } catch (writeError) {
        setError(`Legacy fallback is disabled. ${writeError instanceof Error ? writeError.message : String(writeError)}`);
        return;
      }
      await query.refetch();
      setAgent(undefined); setThinking(undefined); setFeatureValues(undefined); setModeId(undefined);
    } catch (saveError) {
      setError(`Role preference marker save failed: ${saveError instanceof Error ? saveError.message : String(saveError)}. Canonical model keys were not changed.`);
    } finally { setSaving(false); }
  };
  return <SettingsSection title={role === "manager" ? "Lane Manager defaults" : "Lane Dev defaults"}>
    <SettingsCard>
      {query.isLoading ? <ActivityIndicator color={theme.colors.foregroundMuted} /> : null}
      {query.isError ? <Text style={{ color: theme.colors.statusDanger }}>Lanes defaults unavailable: {String(query.error)}</Text> : null}
      {initial ? <>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>
          Saved to Lanes user configuration. A project-specific model or reasoning effort overrides this value. Changes apply to newly created sessions; running sessions keep their current configuration.
          {initial.source === "legacy" ? " Showing the previous single agent preference until you save this role." : ""}
        </Text>
        <AgentConfigFields theme={theme} hostId={hostId} agent={modelAgent} thinkingOptionId={effectiveThinking}
          featureValues={effectiveFeatures}
          modeId={effectiveMode}
          onAgentChange={(value) => { setAgent(value); setThinking(""); setFeatureValues({}); setModeId(FULL_ACCESS_MODE); }}
          onThinkingChange={setThinking} onFeatureValuesChange={setFeatureValues} onModeChange={setModeId}
          allowAutomatic modelHint="Automatic clears the Lanes user override. Project configuration still takes precedence." />
        <SettingsAction label="Lanes user model defaults" hint={error ?? (initial.source === "project"
          ? "The selected project's model setting currently overrides the user default."
          : `Current source: ${initial.source}. Existing sessions are not reconfigured.`)}
          actionLabel={saving ? "Saving…" : "Save role defaults"} disabled={saving || !changed} onPress={() => void save()} />
      </> : null}
    </SettingsCard>
  </SettingsSection>;
}

export function SettingsScreen({ theme, host }: PluginSurfaceProps) {
  const settings = useSettings(preferences);
  const [section, setSection] = useState<Section>("collaboration");
  return <View style={{ padding: 12, gap: 8 }}>
    <Text style={{ color: theme.colors.foreground, fontSize: 20, fontWeight: "700" }}>Lanes settings</Text>
    <Nav section={section} setSection={setSection} theme={theme} />
    {section === "resources" ? <ResourceSettings key={host.id} theme={theme} hostId={host.id} />
      : settings.status === "loading" ? <ActivityIndicator color={theme.colors.foregroundMuted} />
        : settings.status === "error" || settings.status === "invalid"
          ? <Text style={{ color: theme.colors.statusDanger }}>Lanes settings unavailable: {settings.error}</Text>
          : section === "collaboration" ? <CollaborationSettings theme={theme} />
            : <RoleSettings key={section} role={section} theme={theme} hostId={host.id} />}
  </View>;
}
