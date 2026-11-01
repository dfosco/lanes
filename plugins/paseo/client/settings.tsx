import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { usePaseo, useRpc, useSettings } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsInput, SettingsSection } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import {
  modelRoutingPolicyRpc, saveModelRoutingPolicyRpc, preferences,
  type AgentRole, type ModelRoutingPolicy,
} from "../shared/contracts";
import { agentRolesSettings, responsibilityType, type AgentRoleDefinition } from "../shared/agent-roles";
import { routingKeyForRole } from "../shared/model-routing";
import { AgentConfigFields } from "./agent-configuration";
import { AgentRolesSettings } from "./agent-roles";
import { LaneEnvironmentSettings } from "./lane-environment";
import { ResourceSettings } from "./resource-settings";
import { SortableOrderEditor } from "./sortable-order";

type Theme = PluginSurfaceProps["theme"];
type Section = "resources" | "routing" | "environment" | "agent-roles";

function Nav({ section, setSection, theme }: { section: Section; setSection: (section: Section) => void; theme: Theme }) {
  const items: [Section, string][] = [["environment", "Workspace mode"], ["agent-roles", "Agent roles"],
    ["routing", "Model Routing"], ["resources", "Resources"]];
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 14 }}>
    {items.map(([value, label]) => <Pressable key={value} accessibilityRole="button" onPress={() => setSection(value)}
      style={{ borderWidth: 1, borderColor: section === value ? theme.colors.accent : theme.colors.border,
        backgroundColor: section === value ? theme.colors.accent : "transparent", borderRadius: 7, paddingVertical: 7, paddingHorizontal: 10 }}>
      <Text style={{ color: section === value ? theme.colors.accentForeground : theme.colors.foreground, fontSize: 12 }}>{label}</Text>
    </Pressable>)}
  </View>;
}

function RoleLaunchOptions({ role, agent, thinkingOptionId, theme, hostId }: {
  role: AgentRole; agent: string; thinkingOptionId: string; theme: Theme; hostId: string;
}) {
  const settings = useSettings(preferences);
  const values = settings.status === "ready" ? settings.values : preferences.schema.parse({});
  const settingsRevision = settings.status === "ready" ? settings.revision : "";
  const rolePrefs = values.roles[role];
  const [featureValues, setFeatureValues] = useState<Record<string, string | boolean>>(rolePrefs.featureValues);
  const [modeId, setModeId] = useState<string>(rolePrefs.modeId);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setFeatureValues(rolePrefs.featureValues);
    setModeId(rolePrefs.modeId);
    setError(null);
  }, [role, settingsRevision]);
  const changed = JSON.stringify(featureValues) !== JSON.stringify(rolePrefs.featureValues) || modeId !== rolePrefs.modeId;
  const save = async () => {
    setSaving(true); setError(null);
    try {
      const saved = await settings.save({ ...values, roles: { ...values.roles,
        [role]: { ...rolePrefs, featureValues, modeId } } }, settingsRevision);
      if (!saved) { setError("Role options changed or could not be saved. Your edits are preserved; reload before retrying."); return; }
    } catch (saveError) {
      setError(`Role options save failed: ${saveError instanceof Error ? saveError.message : String(saveError)}`);
    } finally { setSaving(false); }
  };
  return <View style={{ gap: 7, paddingLeft: 10 }}>
    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Role permission and provider options, using the first ranked model: {agent}</Text>
    <AgentConfigFields theme={theme} hostId={hostId} agent={agent} thinkingOptionId={thinkingOptionId} featureValues={featureValues}
      modeId={modeId} onAgentChange={() => undefined} onThinkingChange={() => undefined}
      onFeatureValuesChange={setFeatureValues} onModeChange={setModeId} allowAutomatic={false}
      showModel={false} showThinking={false} />
    <SettingsAction label={`${role === "manager" ? "Planner" : "Worker"} options`} hint={error ?? "Permission mode and provider options are saved for new role launches."}
      actionLabel={saving ? "Saving…" : "Save role options"} disabled={saving || !changed}
      onPress={() => void save()} />
  </View>;
}

const emptyRoutingPolicy: ModelRoutingPolicy = {
  version: 1, providerOrder: [], modelOrder: { manager: [], dev: [] },
  reasoningEffortOrder: ["none", "off", "low", "medium", "high", "xhigh", "max", "ultra", "ultracode"],
  warningThresholds: [80, 90], handoffThreshold: 95,
};

/** One model-order editor per routing key: the Lane roles first, then every plugin role. */
function routingEntries(roles?: readonly Pick<AgentRoleDefinition, "id" | "name" | "type">[]): { key: string; label: string; role?: AgentRole }[] {
  const entries: { key: string; label: string; role?: AgentRole }[] = [
    { key: "manager", label: "Lane Manager", role: "manager" }, { key: "dev", label: "Lane Dev", role: "dev" },
  ];
  for (const role of roles ?? []) {
    const key = routingKeyForRole(role.id);
    if (!entries.some((entry) => entry.key === key)) entries.push({ key, label: `${responsibilityType(role)} · ${role.name}` });
  }
  return entries;
}

type RoutingDraft = {
  providerOrder: string; reasoningOrder: string; warnings: string; handoff: string;
  lists: Record<string, string>; efforts: Record<string, Record<string, string>>;
};
const emptyRoutingDraft: RoutingDraft = {
  providerOrder: "", reasoningOrder: "", warnings: "80, 90", handoff: "95",
  lists: {}, efforts: {},
};
const ownValue = <T,>(record: Record<string, T> | undefined, key: string): T | undefined =>
  record && Object.hasOwn(record, key) ? record[key] : undefined;
const splitList = (value: string | undefined) => (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
const draftFromPolicy = (policy: ModelRoutingPolicy): RoutingDraft => ({
  providerOrder: policy.providerOrder.join(", "), reasoningOrder: policy.reasoningEffortOrder.join(", "),
  warnings: policy.warningThresholds.join(", "), handoff: String(policy.handoffThreshold),
  lists: Object.fromEntries(Object.entries(policy.modelOrder).map(([key, models]) => [key, models.join(", ")])),
  efforts: policy.modelEffort ?? {},
});
/** The policy as saved: effort is kept only on ranked entries; an entry without one uses the provider/role default. */
function buildRoutingPolicy(draft: RoutingDraft, keys: readonly string[]) {
  const modelOrder = Object.fromEntries(keys.map((key) => [key, splitList(ownValue(draft.lists, key))]));
  const hasAnyEffort = keys.some((key) => Object.keys(ownValue(draft.efforts, key) ?? {}).length > 0);
  const modelEffort = Object.fromEntries(keys.map((key) => {
    const roleEfforts = ownValue(draft.efforts, key) ?? {};
    const efforts = Object.fromEntries((modelOrder[key] ?? []).filter((item) => Object.hasOwn(roleEfforts, item) && roleEfforts[item])
      .map((item) => [item, roleEfforts[item]!]));
    return [key, efforts];
  }));
  return {
    version: 1 as const, providerOrder: splitList(draft.providerOrder), modelOrder,
    ...(hasAnyEffort ? { modelEffort } : {}),
    reasoningEffortOrder: splitList(draft.reasoningOrder),
    warningThresholds: draft.warnings.split(",").map((item) => Number(item.trim())),
    handoffThreshold: Number(draft.handoff.trim()),
  };
}

function RoutingSettings({ theme, hostId }: { theme: Theme; hostId: string }) {
  const paseo = usePaseo();
  const readPolicy = useRpc(modelRoutingPolicyRpc);
  const writePolicy = useRpc(saveModelRoutingPolicyRpc);
  const policyQuery = useQuery({ queryKey: ["clips.model-routing-policy", hostId], queryFn: () => readPolicy({}) });
  const catalog = useQuery({ queryKey: ["clips.routing.providers", hostId], queryFn: async () => (await paseo.providers.snapshot()).entries });
  const roleSettings = useSettings(agentRolesSettings);
  const readyProviders = (catalog.data ?? []).filter((entry) => entry.status === "ready" && entry.enabled !== false);
  const entries = routingEntries(roleSettings?.status === "ready" && Array.isArray(roleSettings?.values?.roles) ? roleSettings.values.roles : []);
  const [draft, setDraft] = useState<RoutingDraft>(() => policyQuery.data ? draftFromPolicy(policyQuery.data) : emptyRoutingDraft);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const policy = policyQuery.data ?? emptyRoutingPolicy;
  useEffect(() => {
    if (policyQuery.data) setDraft(draftFromPolicy(policyQuery.data));
  }, [policyQuery.data]);
  // Keys saved in the policy for roles that no longer exist are kept, so saving never drops a ranking.
  const keys = [...new Set([...entries.map((entry) => entry.key), ...Object.keys(policy.modelOrder)])];
  const payload = { ...policy, ...buildRoutingPolicy(draft, keys) };
  const unchanged = { ...policy, ...buildRoutingPolicy(draftFromPolicy(policy), keys) };
  const changed = JSON.stringify(payload) !== JSON.stringify(unchanged);
  const setList = (key: string, value: string) => setDraft((current) => ({ ...current, lists: { ...current.lists, [key]: value } }));
  const setEffort = (key: string, value: Record<string, string>) => setDraft((current) => ({ ...current, efforts: { ...current.efforts, [key]: value } }));
  const save = async () => {
    setSaving(true); setError(null);
    try {
      await writePolicy(payload);
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
  return <SettingsSection title="Model Routing">
    <SettingsCard>
      <View style={{ padding: 8, gap: 10 }}>
        {policyQuery.isLoading || catalog.isLoading ? <ActivityIndicator color={theme.colors.foregroundMuted} /> : null}
        {policyQuery.isError ? <Text style={{ color: theme.colors.statusDanger }}>Routing policy unavailable: {String(policyQuery.error)}</Text> : null}
        {catalog.isError ? <Text style={{ color: theme.colors.statusDanger }}>Provider catalog unavailable: {String(catalog.error)}</Text> : null}
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>
          Each role has one ranked model order and optional per-model reasoning effort. Lane role permission modes and provider options appear under their ranking. Existing saved provider and role defaults remain launch fallbacks when a role order is empty.
        </Text>
        <SortableOrderEditor theme={theme} label="Provider order"
          hint={`Drag providers into priority order. Ready providers: ${[...providerNames.keys()].join(", ") || "none"}.`}
          value={draft.providerOrder} onChange={(value) => setDraft((current) => ({ ...current, providerOrder: value }))}
          placeholder="Add provider ID" options={providerOptions} selectLabel="Add provider" />
        {entries.map((entry) => {
          const firstRankedModel = splitList(ownValue(draft.lists, entry.key))[0] ?? "";
          return <View key={entry.key} style={{ gap: 8, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8, padding: 8 }}>
            <SortableOrderEditor theme={theme} label={`${entry.label} model order`}
              hint={`Drag to set model priority and choose each model's reasoning effort. Default effort uses the ${entry.role ? "role" : "provider model"} default.`}
              value={ownValue(draft.lists, entry.key) ?? ""} onChange={(value) => setList(entry.key, value)}
              placeholder="Add provider/model ID" options={modelOptions} selectLabel="Add model"
              efforts={ownValue(draft.efforts, entry.key) ?? {}} onEffortsChange={(value) => setEffort(entry.key, value)} effortOptions={effortChoices} />
            {entry.role ? firstRankedModel
              ? <RoleLaunchOptions role={entry.role} agent={firstRankedModel}
                thinkingOptionId={ownValue(ownValue(draft.efforts, entry.key), firstRankedModel) ?? ""}
                theme={theme} hostId={hostId} />
              : <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, paddingLeft: 10 }}>
                Add a ranked model to load this role’s permission and provider options. Existing saved defaults remain available when the order is empty.
              </Text> : null}
          </View>;
        })}
        <SortableOrderEditor theme={theme} label="Reasoning effort order"
          hint="Drag from lower to higher reasoning; each provider/model must support the chosen value."
          value={draft.reasoningOrder} onChange={(value) => setDraft((current) => ({ ...current, reasoningOrder: value }))}
          placeholder="Add effort ID" options={effortOptions} selectLabel="Add effort" />
        <SettingsInput label="Usage warning thresholds (%)" hint="Notify at each threshold when fresh host quota data is checked. Example: 80, 90."
          initialValue={draft.warnings} onChangeText={(value) => setDraft((current) => ({ ...current, warnings: value }))} placeholder="80, 90" />
        <SettingsInput label="Provider handoff threshold (%)" hint="At this usage level, route new work to the next eligible provider in the order."
          initialValue={draft.handoff} onChangeText={(value) => setDraft((current) => ({ ...current, handoff: value }))} placeholder="95" />
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
  const [section, setSection] = useState<Section>("routing");
  return <View style={{ padding: 12, gap: 8 }}>
    <Nav section={section} setSection={setSection} theme={theme} />
    {section === "resources" ? <ResourceSettings key={host.id} theme={theme} hostId={host.id} />
      : section === "environment" ? <LaneEnvironmentSettings key={host.id} theme={theme} hostId={host.id} />
        : section === "agent-roles" ? <AgentRolesSettings key={host.id} theme={theme} host={host} />
      : settings.status === "loading" ? <ActivityIndicator color={theme.colors.foregroundMuted} />
        : settings.status === "error" || settings.status === "invalid"
          ? <Text style={{ color: theme.colors.statusDanger }}>Lanes settings unavailable: {settings.error}</Text>
            : section === "routing" ? <RoutingSettings theme={theme} hostId={host.id} /> : null}
  </View>;
}
