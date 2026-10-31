import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { usePaseo, useRpc, useSettings } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsInput, SettingsSection, SettingsSelect } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import {
  collaborationRpc, projectsRpc, roleModelDefaultsRpc, saveRoleModelDefaultsRpc,
  boardRpc, modelRoutingPolicyRpc, saveModelRoutingPolicyRpc, preferences,
  type AgentRole, type ModelRoutingPolicy, type Preferences,
} from "../shared/contracts";
import { FULL_ACCESS_MODE } from "../shared/permission-modes";
import { AgentConfigFields } from "./agent-configuration";
import { ResourceSettings } from "./resource-settings";
import { defaultProvider } from "../shared/work";

type Theme = PluginSurfaceProps["theme"];
type Section = "collaboration" | "resources" | "routing" | AgentRole;

function Nav({ section, setSection, theme }: { section: Section; setSection: (section: Section) => void; theme: Theme }) {
  const items: [Section, string][] = [["collaboration", "Collaboration"], ["manager", "Lane Manager"], ["dev", "Lane Dev"], ["routing", "Routing"], ["resources", "Resources"]];
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
      <View style={{ padding: 16, gap: 12 }}>
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
      </View>
    </SettingsCard>
  </SettingsSection>;
}

function RoleSettings({ role, theme, hostId }: { role: AgentRole; theme: Theme; hostId: string }) {
  const paseo = usePaseo();
  const settings = useSettings(preferences);
  const fetchDefaults = useRpc(roleModelDefaultsRpc);
  const saveDefaults = useRpc(saveRoleModelDefaultsRpc);
  const values = settings.status === "ready" ? settings.values : preferences.schema.parse({});
  const settingsRevision = settings.status === "ready" ? settings.revision : "";
  const rolePrefs = values.roles[role];
  const catalog = useQuery({ queryKey: ["clips.role-defaults.providers", hostId],
    queryFn: async () => (await paseo.providers.snapshot()).entries });
  const providerEntries = (catalog.data ?? []).filter((entry) => entry.status === "ready" && entry.enabled !== false);
  const [selectedProvider, setSelectedProvider] = useState("");
  const rememberedAgent = rolePrefs.provider || values.agent || defaultProvider(providerEntries) || "";
  const preferredProvider = selectedProvider || rememberedAgent.split("/")[0] || "";
  const providerId = providerEntries.some((entry) => entry.provider === preferredProvider)
    ? preferredProvider : providerEntries[0]?.provider || "";
  const query = useQuery({ queryKey: ["clips.role-defaults", role, providerId, rolePrefs.legacyModelMigrated],
    queryFn: () => fetchDefaults({ role, provider: providerId, legacyDisabled: rolePrefs.legacyModelMigrated }), enabled: Boolean(providerId) });
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
        await saveDefaults({ role, provider: providerId, model, reasoningEffort: effectiveThinking });
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
      <View style={{ padding: 16, gap: 16 }}>
      {catalog.isLoading || query.isLoading ? <ActivityIndicator color={theme.colors.foregroundMuted} /> : null}
      {catalog.isError ? <Text style={{ color: theme.colors.statusDanger }}>Paseo providers unavailable: {String(catalog.error)}</Text> : null}
      {providerEntries.length ? <SettingsSelect label="Provider" hint="Defaults are stored independently for each provider."
        value={providerId} options={providerEntries.map((entry) => ({ value: entry.provider, label: entry.label ?? entry.provider }))}
        onValueChange={(value) => { setSelectedProvider(value); setAgent(undefined); setThinking(undefined); setFeatureValues(undefined); setModeId(undefined); }} /> : null}
      {query.isError ? <Text style={{ color: theme.colors.statusDanger }}>Lanes defaults unavailable: {String(query.error)}</Text> : null}
      {initial ? <>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>
          Saved as this provider’s Lanes user default. A project-specific setting takes precedence. Changes apply to newly created sessions; running sessions keep their current configuration.
          {initial.source === "legacy" ? " Showing the previous single agent preference until you save this role." : ""}
        </Text>
        <AgentConfigFields theme={theme} hostId={hostId} agent={modelAgent} thinkingOptionId={effectiveThinking}
          providerId={providerId}
          featureValues={effectiveFeatures}
          modeId={effectiveMode}
          onAgentChange={(value) => { setAgent(value); setThinking(""); setFeatureValues({}); setModeId(FULL_ACCESS_MODE); }}
          onThinkingChange={setThinking} onFeatureValuesChange={setFeatureValues} onModeChange={setModeId}
          allowAutomatic modelHint="Automatic clears this provider’s user override. Project and legacy global defaults remain fallbacks." />
        <SettingsAction label="Lanes user model defaults" hint={error ?? (initial.source === "project"
          ? "The selected project's model setting currently overrides the user default."
          : `Current source: ${initial.source}. Existing sessions are not reconfigured.`)}
          actionLabel={saving ? "Saving…" : "Save provider defaults"}
          disabled={saving || (!changed && initial.source !== "user")} onPress={() => void save()} />
      </> : null}
      {!providerEntries.length && !catalog.isLoading && !catalog.isError
        ? <Text style={{ color: theme.colors.statusDanger }}>No ready Paseo provider is available.</Text> : null}
      </View>
    </SettingsCard>
  </SettingsSection>;
}

const emptyRoutingPolicy: ModelRoutingPolicy = {
  version: 1, providerOrder: [], modelOrder: { manager: [], dev: [] },
  reasoningEffortOrder: ["none", "off", "low", "medium", "high", "xhigh", "max", "ultra", "ultracode"],
  warningThresholds: [80, 90], handoffThreshold: 95,
};

function RoutingSettings({ theme, hostId }: { theme: Theme; hostId: string }) {
  const paseo = usePaseo();
  const readPolicy = useRpc(modelRoutingPolicyRpc);
  const writePolicy = useRpc(saveModelRoutingPolicyRpc);
  const policyQuery = useQuery({ queryKey: ["clips.model-routing-policy", hostId], queryFn: () => readPolicy({}) });
  const catalog = useQuery({ queryKey: ["clips.routing.providers", hostId], queryFn: async () => (await paseo.providers.snapshot()).entries });
  const readyProviders = (catalog.data ?? []).filter((entry) => entry.status === "ready" && entry.enabled !== false);
  const [providerOrder, setProviderOrder] = useState("");
  const [managerModels, setManagerModels] = useState("");
  const [devModels, setDevModels] = useState("");
  const [reasoningOrder, setReasoningOrder] = useState("");
  const [warnings, setWarnings] = useState("80, 90");
  const [handoff, setHandoff] = useState("95");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const policy = policyQuery.data ?? emptyRoutingPolicy;
  useEffect(() => {
    if (!policyQuery.data) return;
    setProviderOrder(policyQuery.data.providerOrder.join(", "));
    setManagerModels(policyQuery.data.modelOrder.manager.join(", "));
    setDevModels(policyQuery.data.modelOrder.dev.join(", "));
    setReasoningOrder(policyQuery.data.reasoningEffortOrder.join(", "));
    setWarnings(policyQuery.data.warningThresholds.join(", "));
    setHandoff(String(policyQuery.data.handoffThreshold));
  }, [policyQuery.data]);
  const order = providerOrder.split(",").map((item) => item.trim()).filter(Boolean);
  const warningThresholds = warnings.split(",").map((item) => Number(item.trim()));
  const handoffThreshold = Number(handoff.trim());
  const modelOrder = { manager: managerModels.split(",").map((item) => item.trim()).filter(Boolean),
    dev: devModels.split(",").map((item) => item.trim()).filter(Boolean) };
  const reasoningEffortOrder = reasoningOrder.split(",").map((item) => item.trim()).filter(Boolean);
  const changed = providerOrder !== policy.providerOrder.join(", ") || managerModels !== policy.modelOrder.manager.join(", ") ||
    devModels !== policy.modelOrder.dev.join(", ") || reasoningOrder !== policy.reasoningEffortOrder.join(", ") ||
    warnings !== policy.warningThresholds.join(", ") || handoff !== String(policy.handoffThreshold);
  const save = async () => {
    setSaving(true); setError(null);
    try {
      await writePolicy({ version: 1, providerOrder: order, modelOrder, reasoningEffortOrder, warningThresholds, handoffThreshold });
      await policyQuery.refetch();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally { setSaving(false); }
  };
  const providerNames = new Map(readyProviders.map((entry) => [entry.provider, entry.label ?? entry.provider]));
  return <SettingsSection title="Provider routing and handoff">
    <SettingsCard>
      <View style={{ padding: 16, gap: 14 }}>
        {policyQuery.isLoading || catalog.isLoading ? <ActivityIndicator color={theme.colors.foregroundMuted} /> : null}
        {policyQuery.isError ? <Text style={{ color: theme.colors.statusDanger }}>Routing policy unavailable: {String(policyQuery.error)}</Text> : null}
        {catalog.isError ? <Text style={{ color: theme.colors.statusDanger }}>Provider catalog unavailable: {String(catalog.error)}</Text> : null}
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>
          Provider-specific role defaults are configured on the Lane Manager and Lane Dev tabs. Set this order to make those defaults the normal route for new work; an empty provider order preserves the existing global/default launch choice. Provider order chooses the fallback tier, and the role's model order ranks models within a provider. Running agents are never changed here.
        </Text>
        <SettingsInput label="Provider order" hint={`Comma-separated Paseo provider IDs, highest priority first. Ready: ${[...providerNames.keys()].join(", ") || "none"}.`}
          key={`${policyQuery.dataUpdatedAt ?? "loading"}-providers`} initialValue={providerOrder} onChangeText={setProviderOrder} placeholder="codex, opencode, claude" />
        <SettingsInput label="Lane Manager model order" hint="Optional qualified provider/model IDs, highest priority first; per-provider defaults are used when empty."
          key={`${policyQuery.dataUpdatedAt ?? "loading"}-manager`} initialValue={managerModels} onChangeText={setManagerModels} placeholder="codex/gpt-6.1-sol, opencode/openai/gpt-6.1-sol" />
        <SettingsInput label="Lane Dev model order" hint="Optional qualified provider/model IDs, highest priority first; per-provider defaults are used when empty."
          key={`${policyQuery.dataUpdatedAt ?? "loading"}-dev`} initialValue={devModels} onChangeText={setDevModels} placeholder="codex/gpt-6-luna, opencode/openai/gpt-6-luna" />
        <SettingsInput label="Reasoning effort order" hint="Effort IDs ordered from lower to higher reasoning; each provider/model must support the chosen value."
          key={`${policyQuery.dataUpdatedAt ?? "loading"}-effort`} initialValue={reasoningOrder} onChangeText={setReasoningOrder} placeholder="low, medium, high, xhigh, max" />
        <SettingsInput label="Usage warning thresholds (%)" hint="Notify at each threshold when fresh host quota data is checked. Example: 80, 90."
          initialValue={warnings} onChangeText={setWarnings} placeholder="80, 90" />
        <SettingsInput label="Provider handoff threshold (%)" hint="At this usage level, route new work to the next eligible provider in the order."
          initialValue={handoff} onChangeText={setHandoff} placeholder="95" />
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>
          Warnings depend on fresh Paseo host quota reports and are surfaced at work/check boundaries. The plugin does not run an always-on usage monitor or mutate an active provider session; active work needs a checkpointed, quiescent continuation.
        </Text>
        <SettingsAction label="Persistent routing policy" hint={error ?? "Saved in user Lanes JSON configuration and readable by Lanes skills."}
          actionLabel={saving ? "Saving…" : "Save routing policy"} disabled={saving || !changed || policyQuery.isError || catalog.isError} onPress={() => void save()} />
      </View>
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
            : section === "routing" ? <RoutingSettings theme={theme} hostId={host.id} />
            : <RoleSettings key={section} role={section} theme={theme} hostId={host.id} />}
  </View>;
}
