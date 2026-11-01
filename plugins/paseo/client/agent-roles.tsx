import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useSettings } from "@getpaseo/plugin/client";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { agentRoleDefinition, agentRolesSettings, builtInRoles, responsibilityType, type AgentRoleDefinition } from "../shared/agent-roles";

type Theme = PluginSurfaceProps["theme"];
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

/** Host-scoped, form-based editor. Exact provider/model IDs are only persisted in the settings document. */
export function AgentRolesSettings({ theme, host }: { theme: Theme; host: PluginSurfaceProps["host"] }) {
  const settings = useSettings(agentRolesSettings);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (settings.status !== "ready") return;
    const currentRoles = draft?.roles ?? settings.values.roles;
    if (!selectedId || !currentRoles.some((role) => role.id === selectedId)) {
      setSelectedId(currentRoles[0]?.id ?? "");
    }
  }, [settings.status, settings.status === "ready" ? settings.revision : "", selectedId, draft]);

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
    const result = agentRoleDefinition.safeParse({ id: newId.trim(), name: newName.trim(), type: "worker", description: "", revision: 1,
      instructions: "", skills: [] });
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
      Planner and worker describe responsibility only. They do not grant permissions or change how a session runs. Lane Manager is the planner; Lane Dev and UX Engineer are workers. Custom roles can choose either type. Model order and reasoning effort are set in Model Routing.
    </Text>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {roles.map((item) => <Button key={item.id} label={`${responsibilityType(item)} · ${item.name}`} theme={theme} subtle={item.id !== role?.id}
        onPress={() => setSelectedId(item.id)} />)}
    </View>
    <View style={{ gap: 9, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8, padding: 11 }}>
      <Text style={{ color: theme.colors.foreground, fontWeight: "700" }}>{role?.name ?? "Create a role"}</Text>
      {role ? <>
        <Field label="Role name" value={role.name} theme={theme} onChangeText={(name) => changeRole({ ...role, name })} />
        <View style={{ gap: 5 }}>
          <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "600" }}>Responsibility type</Text>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
            {builtInIds.has(role.id) ? `Fixed for this built-in role: ${responsibilityType(role)}.` : "Choose whether this custom role plans work or implements it."}
          </Text>
          {!builtInIds.has(role.id) ? <View style={{ flexDirection: "row", gap: 6 }}>
            {(["planner", "worker"] as const).map((type) => <Button key={type} label={type} theme={theme}
              subtle={responsibilityType(role) !== type} onPress={() => changeRole({ ...role, type })} />)}
          </View> : null}
        </View>
        <Field label="Description" value={role.description} theme={theme} onChangeText={(description) => changeRole({ ...role, description })} />
        <Field label="Instructions" value={role.instructions} theme={theme} multiline placeholder="Optional guidance added to the new session’s system prompt."
          onChangeText={(instructions) => changeRole({ ...role, instructions })} />
        <Field label="Skill references" value={role.skills.join(", ")} theme={theme} placeholder="lane-dev, design-engineer"
          onChangeText={(value) => changeRole({ ...role, skills: [...new Set(value.split(",").map((part) => part.trim()).filter(Boolean))] })} />
        {validation && !validation.success ? <Text style={{ color: theme.colors.statusDanger, fontSize: 12 }}>
          {validation.error.issues.map((issue) => issue.message).join(" ")}
        </Text> : null}
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
