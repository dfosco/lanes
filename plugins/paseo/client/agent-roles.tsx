import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { SettingsSelect } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Switch, Text, TextInput, View } from "react-native";
import {
  agentRoleDefinition, agentRolesSettings, builtInRoles, roleCatalogRpc,
  type AgentRoleDefinition, type RoleCandidate,
} from "../shared/agent-roles";
import type { output as ZodOutput } from "zod";
import { modelDisplayName, providerDisplayName } from "./catalog-labels";

type Theme = PluginSurfaceProps["theme"];
type Catalog = ZodOutput<typeof roleCatalogRpc.output>;
type Draft = { revision: string; roles: AgentRoleDefinition[] };

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
const inputStyle = (theme: Theme) => ({
  minHeight: 38, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1,
  borderColor: theme.colors.border, borderRadius: 6, color: theme.colors.foreground,
  backgroundColor: theme.colors.surface0, fontSize: 13,
});

function Button({ label, onPress, theme, disabled = false, subtle = false }: {
  label: string; onPress: () => void; theme: Theme; disabled?: boolean; subtle?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
    style={({ pressed }) => ({ paddingHorizontal: 10, paddingVertical: 7, borderWidth: 1,
      borderColor: subtle ? theme.colors.border : theme.colors.accent, borderRadius: 6,
      backgroundColor: subtle ? "transparent" : theme.colors.accent, opacity: disabled ? 0.45 : pressed ? 0.7 : 1 })}>
    <Text style={{ color: subtle ? theme.colors.foreground : theme.colors.accentForeground, fontSize: 12 }}>{label}</Text>
  </Pressable>;
}

function Field({ label, value, onChangeText, theme, multiline = false, placeholder }: {
  label: string; value: string; onChangeText: (value: string) => void; theme: Theme; multiline?: boolean; placeholder?: string;
}) {
  return <View style={{ gap: 4 }}>
    <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "600" }}>{label}</Text>
    <TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} multiline={multiline}
      placeholder={placeholder} placeholderTextColor={theme.colors.foregroundMuted}
      style={{ ...inputStyle(theme), ...(multiline ? { minHeight: 76, textAlignVertical: "top" as const } : {}) }} />
  </View>;
}

function RoleCandidates({ role, catalog, theme, onChange }: {
  role: AgentRoleDefinition; catalog: Catalog | undefined; theme: Theme; onChange: (role: AgentRoleDefinition) => void;
}) {
  const [agent, setAgent] = useState("");
  const [thinking, setThinking] = useState("");
  const [modeId, setModeId] = useState("");
  const [metered, setMetered] = useState(false);
  const modelOptions = useMemo(() => (catalog?.providers ?? []).flatMap((provider, providerIndex) => provider.models.map((model, modelIndex) => {
    const providerName = providerDisplayName(provider.label, provider.provider, providerIndex);
    const modelName = modelDisplayName(model.label, model.id, provider.provider, modelIndex);
    return { value: model.agent, label: `${providerName} · ${modelName}` };
  })), [catalog]);
  const selectedProvider = catalog?.providers.find((provider) => provider.models.some((model) => model.agent === agent));
  const selectedModel = selectedProvider?.models.find((model) => model.agent === agent);
  const savedCandidateLabel = (candidate: RoleCandidate, index: number) => {
    const option = modelOptions.find((entry) => entry.value === candidate.agent);
    return option?.label ?? (catalog ? `Unavailable saved model ${index + 1}` : `Saved launch choice ${index + 1}`);
  };
  const shift = (index: number, direction: -1 | 1) => {
    const destination = index + direction;
    if (destination < 0 || destination >= role.candidates.length) return;
    const candidates = [...role.candidates];
    [candidates[index], candidates[destination]] = [candidates[destination], candidates[index]];
    onChange({ ...role, candidates });
  };
  const add = () => {
    if (!agent || role.candidates.some((candidate) => candidate.agent === agent) || role.candidates.length >= 12) return;
    const candidate: RoleCandidate = {
      agent,
      ...(thinking ? { thinkingOptionId: thinking } : {}),
      ...(modeId ? { modeId } : selectedProvider?.defaultModeId ? { modeId: selectedProvider.defaultModeId } : {}),
      ...(metered ? { metered: true } : {}),
    };
    onChange({ ...role, candidates: [...role.candidates, candidate] });
    setAgent(""); setThinking(""); setModeId(""); setMetered(false);
  };
  return <View style={{ gap: 9 }}>
    <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>Ordered launch choices</Text>
    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>
      The host checks these choices in order. Provider and model names come from this host’s live catalog.
    </Text>
    {role.candidates.map((candidate, index) => {
      const available = modelOptions.some((option) => option.value === candidate.agent);
      const stale = Boolean(catalog && !available);
      return <View key={`${candidate.agent}:${index}`} style={{ borderWidth: 1, borderColor: theme.colors.border,
        borderRadius: 7, padding: 9, gap: 7 }}>
        <Text accessibilityLabel={stale ? `Unavailable launch choice ${index + 1}` : `Launch choice ${index + 1}`}
          style={{ color: stale ? theme.colors.statusWarning : theme.colors.foreground, flex: 1, fontSize: 13 }}>
          {index + 1}. {savedCandidateLabel(candidate, index)}{candidate.metered ? " · paid route" : ""}{stale ? " · no longer offered by this host" : ""}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          <Button label={`Move choice ${index + 1} up`} theme={theme} subtle disabled={index === 0}
            onPress={() => shift(index, -1)} />
          <Button label={`Move choice ${index + 1} down`} theme={theme} subtle disabled={index === role.candidates.length - 1}
            onPress={() => shift(index, 1)} />
          <Button label={`Remove choice ${index + 1}`} theme={theme} subtle onPress={() => onChange({
            ...role, candidates: role.candidates.filter((_, at) => at !== index),
          })} />
        </View>
      </View>;
    })}
    {!catalog ? null : catalog.providers.length === 0 ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
      This host has no ready providers with selectable models. Saved choices are preserved.
    </Text> : <>
      <SettingsSelect label="Available model" value={agent} options={[{ value: "", label: "Choose a model" }, ...modelOptions]}
        onValueChange={(value) => { setAgent(value); setThinking(""); setModeId(""); }} />
      {selectedModel?.thinkingOptions.length ? <SettingsSelect label="Reasoning level" value={thinking}
        options={[{ value: "", label: `Provider default${selectedModel.defaultThinkingOptionId ? ` · ${selectedModel.defaultThinkingOptionId}` : ""}` },
          ...selectedModel.thinkingOptions.map((option) => ({ value: option.id, label: option.label }))]}
        onValueChange={setThinking} /> : null}
      {selectedProvider?.modes.length ? <SettingsSelect label="Permission mode" value={modeId || selectedProvider.defaultModeId || ""}
        options={selectedProvider.modes.map((mode) => ({ value: mode.id, label: mode.label }))} onValueChange={setModeId} /> : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Switch value={metered} onValueChange={setMetered} trackColor={{ false: theme.colors.border, true: theme.colors.accent }} />
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, flex: 1 }}>Mark as paid/metered (requires approval for fallback)</Text>
      </View>
      <View style={{ alignSelf: "flex-start" }}><Button label="Add launch choice" theme={theme}
        disabled={!agent || role.candidates.some((candidate) => candidate.agent === agent) || role.candidates.length >= 12}
        onPress={add} /></View>
    </>}
  </View>;
}

/** Host-scoped, form-based editor. Exact provider/model IDs are only persisted in the settings document. */
export function AgentRolesSettings({ theme, host }: { theme: Theme; host: PluginSurfaceProps["host"] }) {
  const settings = useSettings(agentRolesSettings);
  const fetchCatalog = useRpc(roleCatalogRpc);
  const catalogQuery = useQuery({
    queryKey: ["clips.agent-roles.catalog", host.id],
    queryFn: () => fetchCatalog({}),
    enabled: Boolean(host.id),
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (settings.status !== "ready") return;
    if (!selectedId || !settings.values.roles.some((role) => role.id === selectedId)) {
      setSelectedId(settings.values.roles[0]?.id ?? "");
    }
  }, [settings.status, settings.status === "ready" ? settings.revision : "", selectedId]);

  if (settings.status === "loading") return <ActivityIndicator color={theme.colors.foregroundMuted} />;
  if (settings.status !== "ready") return <View style={{ gap: 8 }}>
    <Text style={{ color: theme.colors.statusDanger }}>Role settings unavailable: {settings.error}</Text>
    <Button label="Reload role settings" theme={theme} onPress={() => void settings.reload()} />
  </View>;

  const roles = draft?.roles ?? settings.values.roles;
  const role = roles.find((item) => item.id === selectedId) ?? roles[0];
  const stale = Boolean(draft && draft.revision !== settings.revision);
  const changeRole = (next: AgentRoleDefinition) => {
    setError(null);
    setDraft((current) => ({ revision: current?.revision ?? settings.revision,
      roles: (current?.roles ?? settings.values.roles).map((item) => item.id === next.id ? next : item) }));
  };
  const changeRoles = (next: AgentRoleDefinition[]) => {
    setError(null);
    setDraft((current) => ({ revision: current?.revision ?? settings.revision, roles: next }));
  };
  const validation = role ? agentRoleDefinition.safeParse(role) : null;
  const collectionValid = roles.every((item) => agentRoleDefinition.safeParse(item).success) &&
    new Set(roles.map((item) => item.id)).size === roles.length &&
    new Set(roles.map((item) => item.name.toLocaleLowerCase())).size === roles.length;
  const create = () => {
    const result = agentRoleDefinition.safeParse({ id: newId.trim(), name: newName.trim(), description: "", revision: 1,
      instructions: "", skills: [], candidates: [], quota: {} });
    if (!result.success) { setError(result.error.issues.map((issue) => issue.message).join(" ")); return; }
    if (roles.some((item) => item.id === result.data.id || item.name.toLocaleLowerCase() === result.data.name.toLocaleLowerCase())) {
      setError("Role IDs and names must be unique."); return;
    }
    changeRoles([...roles, result.data]); setSelectedId(result.data.id); setNewId(""); setNewName("");
  };
  const save = async () => {
    if (!draft || stale || saving || !collectionValid) return;
    setSaving(true); setError(null);
    try {
      const rolesToSave = draft.roles.map((next) => {
        const prior = settings.values.roles.find((item) => item.id === next.id);
        if (!prior) return { ...next, revision: 1 };
        const sameContent = JSON.stringify({ ...prior, revision: 0 }) === JSON.stringify({ ...next, revision: 0 });
        return { ...next, revision: sameContent ? prior.revision : prior.revision + 1 };
      });
      const saved = await settings.save({ ...settings.values, roles: rolesToSave }, draft.revision);
      if (!saved) { setError("Role settings changed or could not be saved. Your edits are preserved; reload before retrying."); return; }
      await settings.reload(); setDraft(null);
    } catch (saveError) { setError(`Could not save roles: ${errorMessage(saveError)}`); }
    finally { setSaving(false); }
  };
  const reset = () => {
    setDraft(null); setError(null); void settings.reload();
  };
  const builtInIds = new Set(["lane-manager", "lane-dev", "design-engineer", "deep-reasoning", "fast-implementation"]);

  return <View style={{ gap: 12 }}>
    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>
      Lanes roles are host-scoped launch guidance, not Paseo profiles. Running sessions are not changed. Saved launch choices stay in order and are checked against the selected host when used.
    </Text>
    {catalogQuery.isLoading ? <View accessibilityLabel="Loading provider catalog"><ActivityIndicator color={theme.colors.foregroundMuted} />
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Loading this host’s available models…</Text></View> : null}
    {catalogQuery.isError ? <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger, fontSize: 12 }}>
      Provider catalog unavailable: {errorMessage(catalogQuery.error)}. Existing choices are preserved; no replacement was selected.
    </Text> : null}
    {catalogQuery.data && catalogQuery.data.providers.length === 0 ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
      No providers are currently ready on this host.
    </Text> : null}
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {roles.map((item) => <Button key={item.id} label={item.name} theme={theme} subtle={item.id !== role?.id}
        onPress={() => setSelectedId(item.id)} />)}
    </View>
    <View style={{ gap: 9, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8, padding: 11 }}>
      <Text style={{ color: theme.colors.foreground, fontWeight: "700" }}>{role?.name ?? "Create a role"}</Text>
      {role ? <>
        <Field label="Role name" value={role.name} theme={theme} onChangeText={(name) => changeRole({ ...role, name })} />
        <Field label="Description" value={role.description} theme={theme} onChangeText={(description) => changeRole({ ...role, description })} />
        <Field label="Instructions" value={role.instructions} theme={theme} multiline placeholder="Optional guidance added to the new session’s system prompt."
          onChangeText={(instructions) => changeRole({ ...role, instructions })} />
        <Field label="Skill references" value={role.skills.join(", ")} theme={theme} placeholder="lane-dev, design-engineer"
          onChangeText={(value) => changeRole({ ...role, skills: [...new Set(value.split(",").map((part) => part.trim()).filter(Boolean))] })} />
        <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>Fallback policy</Text>
        <SettingsSelect label="Maximum usage before skipping" value={String(role.quota.maxUsagePct)} options={
          [...new Set([50, 70, 80, 90, 95, role.quota.maxUsagePct])].sort((a, b) => a - b).map((value) => ({ value: String(value), label: `${value}%` }))
        } onValueChange={(value) => changeRole({ ...role, quota: { ...role.quota, maxUsagePct: Number(value) } })} />
        <SettingsSelect label="Maximum quota reading age" value={String(role.quota.maxAgeMinutes)} options={
          [...new Set([15, 30, 60, 120, 240, role.quota.maxAgeMinutes])].sort((a, b) => a - b).map((value) => ({ value: String(value), label: `${value} minutes` }))
        } onValueChange={(value) => changeRole({ ...role, quota: { ...role.quota, maxAgeMinutes: Number(value) } })} />
        <SettingsSelect label="When quota is unknown" value={role.quota.whenUnknown} options={[
          { value: "allow", label: "Allow this candidate" }, { value: "skip", label: "Skip this candidate" },
        ]} onValueChange={(value) => changeRole({ ...role, quota: { ...role.quota, whenUnknown: value as "allow" | "skip" } })} />
        {validation && !validation.success ? <Text style={{ color: theme.colors.statusDanger, fontSize: 12 }}>
          {validation.error.issues.map((issue) => issue.message).join(" ")}
        </Text> : null}
        <RoleCandidates key={role.id} role={role} catalog={catalogQuery.data} theme={theme} onChange={changeRole} />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7 }}>
          <Button label="Remove role" theme={theme} subtle onPress={() => {
            const remaining = roles.filter((item) => item.id !== role.id); changeRoles(remaining); setSelectedId(remaining[0]?.id ?? "");
          }} />
          {builtInIds.has(role.id) ? <Button label="Restore built-in role" theme={theme} subtle onPress={() => {
            void (async () => {
              const builtIn = builtInRoles().find((item) => item.id === role.id);
              if (builtIn) changeRole(builtIn);
            })();
          }} /> : null}
        </View>
      </> : <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Create a role to configure launch guidance.</Text>}
    </View>
    <View style={{ gap: 8, borderTopWidth: 1, borderColor: theme.colors.border, paddingTop: 10 }}>
      <Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>Create role</Text>
      {builtInRoles().filter((builtIn) => !roles.some((item) => item.id === builtIn.id)).map((builtIn) => <Button
        key={builtIn.id} label={`Restore ${builtIn.name}`} theme={theme} subtle onPress={() => {
          changeRoles([...roles, builtIn]); setSelectedId(builtIn.id);
        }} />)}
      <Field label="Role ID" value={newId} theme={theme} placeholder="for example, qa-reviewer" onChangeText={setNewId} />
      <Field label="New role name" value={newName} theme={theme} placeholder="QA Reviewer" onChangeText={setNewName} />
      <View style={{ alignSelf: "flex-start" }}><Button label="Create role" theme={theme} onPress={create} /></View>
    </View>
    {stale ? <Text accessibilityRole="alert" style={{ color: theme.colors.statusWarning, fontSize: 12 }}>
      Role settings changed on this host while you were editing. Your draft is preserved and has not been saved.
    </Text> : null}
    {error || settings.saveError ? <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger, fontSize: 12 }}>{error ?? settings.saveError}</Text> : null}
    <View style={{ flexDirection: "row", gap: 7, flexWrap: "wrap" }}>
      <Button label={saving || settings.saving ? "Saving roles…" : "Save roles"} theme={theme}
        disabled={!draft || stale || !collectionValid || saving || settings.saving} onPress={() => void save()} />
      {draft ? <Button label="Discard edits and reload" theme={theme} subtle disabled={saving} onPress={reset} /> : null}
      {!collectionValid ? <Text style={{ color: theme.colors.statusDanger, fontSize: 12 }}>Fix invalid or duplicate roles before saving.</Text> : null}
    </View>
  </View>;
}
