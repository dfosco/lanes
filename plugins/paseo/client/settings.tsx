import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { usePaseo, useRpc, useSettings } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsInput, SettingsSection, SettingsSelect } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import {
  roleModelDefaultsRpc, saveRoleModelDefaultsRpc,
  modelRoutingPolicyRpc, saveModelRoutingPolicyRpc, preferences,
  type AgentRole, type ModelRoutingPolicy, type Preferences,
} from "../shared/contracts";
import { FULL_ACCESS_MODE } from "../shared/permission-modes";
import { AgentConfigFields } from "./agent-configuration";
import { AgentRolesSettings } from "./agent-roles";
import { LaneEnvironmentSettings } from "./lane-environment";
import { ResourceSettings } from "./resource-settings";
import { SortableOrderEditor } from "./sortable-order";
import { defaultProvider } from "../shared/work";

type Theme = PluginSurfaceProps["theme"];
type Section = "resources" | "routing" | "environment" | "agent-roles" | AgentRole;

function Nav({ section, setSection, theme }: { section: Section; setSection: (section: Section) => void; theme: Theme }) {
  const items: [Section, string][] = [["environment", "Workspace mode"], ["agent-roles", "Agent roles"],
    ["manager", "Lane Manager"], ["dev", "Lane Dev"], ["routing", "Routing"], ["resources", "Resources"]];
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 14 }}>
    {items.map(([value, label]) => <Pressable key={value} accessibilityRole="button" onPress={() => setSection(value)}
      style={{ borderWidth: 1, borderColor: section === value ? theme.colors.accent : theme.colors.border,
        backgroundColor: section === value ? theme.colors.accent : "transparent", borderRadius: 7, paddingVertical: 7, paddingHorizontal: 10 }}>
      <Text style={{ color: section === value ? theme.colors.accentForeground : theme.colors.foreground, fontSize: 12 }}>{label}</Text>
    </Pressable>)}
  </View>;
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
      <View style={{ padding: 8, gap: 10 }}>
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
  const [managerEfforts, setManagerEfforts] = useState<Record<string, string>>({});
  const [devEfforts, setDevEfforts] = useState<Record<string, string>>({});
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
    setManagerEfforts(policyQuery.data.modelEffort?.manager ?? {});
    setDevEfforts(policyQuery.data.modelEffort?.dev ?? {});
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
  // Only efforts on ranked entries are meaningful; an entry without one uses the provider/role default.
  const rankedEfforts = (efforts: Record<string, string>, ranked: string[]) =>
    Object.fromEntries(ranked.filter((item) => efforts[item]).map((item) => [item, efforts[item]!]));
  const modelEffort = { manager: rankedEfforts(managerEfforts, modelOrder.manager), dev: rankedEfforts(devEfforts, modelOrder.dev) };
  const savedEffort = { manager: rankedEfforts(policy.modelEffort?.manager ?? {}, policy.modelOrder.manager),
    dev: rankedEfforts(policy.modelEffort?.dev ?? {}, policy.modelOrder.dev) };
  const hasEfforts = Object.keys(modelEffort.manager).length > 0 || Object.keys(modelEffort.dev).length > 0;
  const changed = providerOrder !== policy.providerOrder.join(", ") || managerModels !== policy.modelOrder.manager.join(", ") ||
    devModels !== policy.modelOrder.dev.join(", ") || reasoningOrder !== policy.reasoningEffortOrder.join(", ") ||
    warnings !== policy.warningThresholds.join(", ") || handoff !== String(policy.handoffThreshold) ||
    JSON.stringify(modelOrder.manager.map((item) => modelEffort.manager[item] ?? "")) !== JSON.stringify(policy.modelOrder.manager.map((item) => savedEffort.manager[item] ?? "")) ||
    JSON.stringify(modelOrder.dev.map((item) => modelEffort.dev[item] ?? "")) !== JSON.stringify(policy.modelOrder.dev.map((item) => savedEffort.dev[item] ?? ""));
  const save = async () => {
    setSaving(true); setError(null);
    try {
      await writePolicy({ version: 1, providerOrder: order, modelOrder, ...(hasEfforts ? { modelEffort } : {}),
        reasoningEffortOrder, warningThresholds, handoffThreshold });
      await policyQuery.refetch();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally { setSaving(false); }
  };
  const providerNames = new Map(readyProviders.map((entry) => [entry.provider, entry.label ?? entry.provider]));
  // Dropdown choices come from the live host catalog (every ready provider, including antigravity).
  // While it is loading or unavailable the editors fall back to free-text entry.
  const catalogReady = Boolean(catalog.data) && !catalog.isError && readyProviders.length > 0;
  const providerOptions = catalogReady ? readyProviders.map((entry) => ({ value: entry.provider, label: entry.label ?? entry.provider })) : undefined;
  const modelOptions = catalogReady ? readyProviders.flatMap((entry) => (entry.models ?? []).filter((model) => model.isSelectable !== false)
    .map((model) => ({ value: `${entry.provider}/${model.id}`, label: `${entry.label ?? entry.provider} · ${model.label ?? model.id}` }))) : undefined;
  // Each ranked model offers only the reasoning levels the host reports for it (none for e.g. antigravity).
  const modelEfforts = new Map<string, { value: string; label: string }[]>(readyProviders.flatMap((entry) => (entry.models ?? []).map((model) =>
    [`${entry.provider}/${model.id}`, (model.thinkingOptions ?? []).map((option) => ({ value: option.id, label: option.label ?? option.id }))] as [string, { value: string; label: string }[]])));
  const effortChoices = catalogReady ? (item: string) => modelEfforts.get(item) ?? [] : undefined;
  const effortOptions = catalogReady ? [...new Set([...emptyRoutingPolicy.reasoningEffortOrder,
    ...readyProviders.flatMap((entry) => (entry.models ?? []).flatMap((model) => (model.thinkingOptions ?? []).map((option) => option.id)))])]
    .map((id) => ({ value: id, label: id })) : undefined;
  return <SettingsSection title="Provider routing and handoff">
    <SettingsCard>
      <View style={{ padding: 8, gap: 10 }}>
        {policyQuery.isLoading || catalog.isLoading ? <ActivityIndicator color={theme.colors.foregroundMuted} /> : null}
        {policyQuery.isError ? <Text style={{ color: theme.colors.statusDanger }}>Routing policy unavailable: {String(policyQuery.error)}</Text> : null}
        {catalog.isError ? <Text style={{ color: theme.colors.statusDanger }}>Provider catalog unavailable: {String(catalog.error)}</Text> : null}
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>
          Provider-specific role defaults are configured on the Lane Manager and Lane Dev tabs. Set this order to make those defaults the normal route for new work; an empty provider order preserves the existing global/default launch choice. Provider order chooses the fallback tier, and the role's model order ranks models within a provider. Running agents are never changed here.
        </Text>
        <SortableOrderEditor theme={theme} label="Provider order"
          hint={`Drag providers into priority order. Ready providers: ${[...providerNames.keys()].join(", ") || "none"}.`}
          value={providerOrder} onChange={setProviderOrder} placeholder="Add provider ID"
          options={providerOptions} selectLabel="Add provider" />
        <SortableOrderEditor theme={theme} label="Lane Manager model order"
          hint="Drag to set model priority and choose each model's reasoning effort. Default effort uses the provider/role default."
          value={managerModels} onChange={setManagerModels} placeholder="Add provider/model ID"
          options={modelOptions} selectLabel="Add model"
          efforts={managerEfforts} onEffortsChange={setManagerEfforts} effortOptions={effortChoices} />
        <SortableOrderEditor theme={theme} label="Lane Dev model order"
          hint="Drag to set model priority and choose each model's reasoning effort. Default effort uses the provider/role default."
          value={devModels} onChange={setDevModels} placeholder="Add provider/model ID"
          options={modelOptions} selectLabel="Add model"
          efforts={devEfforts} onEffortsChange={setDevEfforts} effortOptions={effortChoices} />
        <SortableOrderEditor theme={theme} label="Reasoning effort order"
          hint="Drag from lower to higher reasoning; each provider/model must support the chosen value."
          value={reasoningOrder} onChange={setReasoningOrder} placeholder="Add effort ID"
          options={effortOptions} selectLabel="Add effort" />
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
  const [section, setSection] = useState<Section>("manager");
  return <View style={{ padding: 12, gap: 8 }}>
    <Nav section={section} setSection={setSection} theme={theme} />
    {section === "resources" ? <ResourceSettings key={host.id} theme={theme} hostId={host.id} />
      : section === "environment" ? <LaneEnvironmentSettings key={host.id} theme={theme} hostId={host.id} />
        : section === "agent-roles" ? <AgentRolesSettings key={host.id} theme={theme} host={host} />
      : settings.status === "loading" ? <ActivityIndicator color={theme.colors.foregroundMuted} />
        : settings.status === "error" || settings.status === "invalid"
          ? <Text style={{ color: theme.colors.statusDanger }}>Lanes settings unavailable: {settings.error}</Text>
            : section === "routing" ? <RoutingSettings theme={theme} hostId={host.id} />
            : <RoleSettings key={section} role={section} theme={theme} hostId={host.id} />}
  </View>;
}
