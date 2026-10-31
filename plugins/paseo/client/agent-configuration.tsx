import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { Modal, ScrollView } from "@getpaseo/plugin/client/react-native";
import { SettingsSelect } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Switch, Text, View } from "react-native";
import { agentOptionsRpc, type AgentConfiguration } from "../shared/contracts";
import {
  FULL_ACCESS_MODE, RESTRICTED_MODE, fullAccessModeId, restrictedAccessModeId,
} from "../shared/permission-modes";
import { defaultProvider } from "../shared/work";

type Theme = PluginSurfaceProps["theme"];
type FeatureValue = string | boolean;
type AgentDefaults = {
  agent: string;
  thinkingOptionId: string;
  featureValues: Record<string, FeatureValue>;
  modeId: string;
};

type ProviderFeature = {
  id: string;
  label: string;
  description?: string;
  type: "toggle" | "select";
  value: boolean | string | null;
  options?: { id: string; label: string; description?: string; isDefault?: boolean }[];
};

export function AgentConfigFields({
  theme, hostId, projectId, agent, providerId, thinkingOptionId, featureValues, onAgentChange,
  onThinkingChange, onFeatureValuesChange, modeId, onModeChange, allowAutomatic, modelHint,
}: {
  theme: Theme;
  hostId: string;
  projectId?: string;
  agent: string;
  providerId?: string;
  thinkingOptionId: string;
  featureValues: Record<string, FeatureValue>;
  onAgentChange: (value: string) => void;
  onThinkingChange: (value: string) => void;
  onFeatureValuesChange: (value: Record<string, FeatureValue>) => void;
  modeId: string;
  onModeChange: (value: string) => void;
  allowAutomatic: boolean;
  modelHint?: string;
}) {
  const paseo = usePaseo();
  const fetchAgentOptions = useRpc(agentOptionsRpc);
  const catalog = useQuery({
    queryKey: ["clips-agent-catalog", hostId],
    queryFn: async () => (await paseo.providers.snapshot()).entries,
  });
  const entries = catalog.data ?? [];
  const modelOptions = entries
    .filter((entry) => entry.status === "ready" && entry.enabled !== false && (!providerId || entry.provider === providerId))
    .flatMap((entry) => (entry.models ?? [])
      .filter((model) => model.isSelectable !== false)
      .map((model) => ({
        value: providerId ? model.id : `${entry.provider}/${model.id}`,
        label: `${entry.label ?? entry.provider} · ${model.label ?? model.id}`,
      })));
  const scopedAgent = providerId && agent.startsWith(`${providerId}/`) ? agent.slice(providerId.length + 1) : agent;
  const effectiveAgent = providerId || agent || defaultProvider(entries);
  const activeThinking = thinkingOptionId || "";
  const optionsQuery = useQuery({
    queryKey: ["clips-agent-options", hostId, projectId ?? "default", effectiveAgent, activeThinking],
    queryFn: () => fetchAgentOptions({ projectId, provider: effectiveAgent!, thinkingOptionId: activeThinking || undefined }),
    enabled: Boolean(effectiveAgent),
  });
  const options = optionsQuery.data;
  const speedFeature = options?.speedFeature as ProviderFeature | null | undefined;
  const thinkingOptions = options?.thinkingOptions ?? [];
  const permissionModes = options?.permissionModes ?? [];
  const fullModeId = fullAccessModeId(permissionModes);
  const restrictedModeId = restrictedAccessModeId(permissionModes, options?.defaultModeId);
  const permissionModeOptions = [
    {
      value: FULL_ACCESS_MODE,
      label: "Full access",
      description: fullModeId
        ? permissionModes.find((mode) => mode.id === fullModeId)?.description
        : "This provider does not expose a full access mode.",
    },
    {
      value: RESTRICTED_MODE,
      label: "Restricted access",
      description: restrictedModeId
        ? "Uses " + (permissionModes.find((mode) => mode.id === restrictedModeId)?.label ?? restrictedModeId) + "."
        : "This provider does not expose a restricted mode.",
    },
    ...permissionModes
      .filter((mode) => mode.id !== fullModeId && mode.id !== restrictedModeId)
      .map((mode) => ({
        value: mode.id,
        label: mode.label,
        ...(mode.description ? { description: mode.description } : {}),
      })),
  ];
  const selectedMode = modeId === fullModeId ? FULL_ACCESS_MODE
    : modeId === restrictedModeId ? RESTRICTED_MODE : modeId;
  if (selectedMode && !permissionModeOptions.some((option) => option.value === selectedMode)) {
    permissionModeOptions.unshift({
      value: selectedMode,
      label: selectedMode === FULL_ACCESS_MODE ? "Full access (unavailable)" : selectedMode + " (unavailable)",
      description: options?.modeError ?? "This mode is not available for the selected provider.",
    });
  }
  const selectOptions = [
    ...(allowAutomatic ? [{ value: "", label: "Automatic" }] : []),
    ...modelOptions,
  ];
  const selectedModel = providerId ? scopedAgent : agent;
  if (selectedModel && !modelOptions.some((option) => option.value === selectedModel)) {
    selectOptions.push({ value: selectedModel, label: `${selectedModel} (currently unavailable)` });
  }
  const defaultThinking = options?.defaultThinkingOptionId ?? "";
  const selectedSpeed = speedFeature
    ? featureValues[speedFeature.id] ?? speedFeature.value ??
      speedFeature.options?.find((option) => option.isDefault)?.id ?? ""
    : "";

  return (
    <View style={{ gap: 10 }}>
      <SettingsSelect
         label={providerId ? "Default model" : "Paseo agent"}
         hint={modelHint ?? (providerId ? `Model saved for ${providerId}.` : "Provider and model used for this launch.")}
         value={selectedModel}
         options={selectOptions}
         onValueChange={(value) => {
           onAgentChange(providerId && value ? `${providerId}/${value}` : value);
          onThinkingChange("");
          onFeatureValuesChange({});
          onModeChange(FULL_ACCESS_MODE);
        }}
      />
      {catalog.isLoading ? <ActivityIndicator color={theme.colors.foregroundMuted} /> : null}
      {catalog.isError ? (
        <Text style={{ color: theme.colors.statusDanger, fontSize: 12 }}>
          Cannot read Paseo providers: {catalog.error instanceof Error ? catalog.error.message : String(catalog.error)}
        </Text>
      ) : null}
      {optionsQuery.isFetching ? <ActivityIndicator color={theme.colors.foregroundMuted} /> : null}
      {optionsQuery.isError ? (
        <Text style={{ color: theme.colors.statusDanger, fontSize: 12 }}>
          Cannot read options for {effectiveAgent}: {optionsQuery.error instanceof Error ? optionsQuery.error.message : String(optionsQuery.error)}
        </Text>
      ) : null}
      {thinkingOptions.length ? (
        <SettingsSelect
          label="Thinking"
          hint="Reasoning level for the selected model."
          value={activeThinking}
          options={[
            { value: "", label: `Paseo default${defaultThinking ? ` (${defaultThinking})` : ""}` },
            ...thinkingOptions.map((option) => ({
              value: option.id,
              label: option.label,
              ...(option.description ? { description: option.description } : {}),
            })),
          ]}
          onValueChange={onThinkingChange}
        />
      ) : null}
      <SettingsSelect
        label="Permission mode"
        hint="Full and restricted access resolve to modes published by the selected provider."
        value={selectedMode}
        options={permissionModeOptions}
        onValueChange={onModeChange}
      />
      {options?.modeError ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
          Paseo could not discover permission modes: {options.modeError}
        </Text>
      ) : null}
      {speedFeature?.type === "select" && speedFeature.options?.length ? (
        <SettingsSelect
          label={speedFeature.label}
          hint={speedFeature.description ?? "Provider speed setting for this model."}
          value={typeof selectedSpeed === "string" ? selectedSpeed : ""}
          options={speedFeature.options.map((option) => ({ value: option.id, label: option.label }))}
          onValueChange={(value) => onFeatureValuesChange({ ...featureValues, [speedFeature.id]: value })}
        />
      ) : null}
      {speedFeature?.type === "toggle" ? (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingVertical: 5 }}>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={{ color: theme.colors.foreground, fontSize: 14 }}>{speedFeature.label}</Text>
            {speedFeature.description ? (
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{speedFeature.description}</Text>
            ) : null}
          </View>
          <Switch
            value={typeof selectedSpeed === "boolean" ? selectedSpeed : speedFeature.value === true}
            onValueChange={(value) => onFeatureValuesChange({ ...featureValues, [speedFeature.id]: value })}
            trackColor={{ false: theme.colors.border, true: theme.colors.accent }}
          />
        </View>
      ) : null}
      {options?.featureError ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
          Paseo could not discover speed options: {options.featureError}
        </Text>
      ) : null}
      {!allowAutomatic && !effectiveAgent && !catalog.isLoading ? (
        <Text style={{ color: theme.colors.statusDanger, fontSize: 12 }}>No ready Paseo agent model is available.</Text>
      ) : null}
    </View>
  );
}

export function AgentLaunchDialog({
  open, workTitle, defaults, defaultsError, theme, hostId, projectId, busy, onOpenChange, onSubmit,
}: {
  open: boolean;
  workTitle: string;
  defaults: AgentDefaults;
  defaultsError?: string | null;
  theme: Theme;
  hostId: string;
  projectId?: string;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (config: AgentConfiguration) => void;
}) {
  const paseo = usePaseo();
  const catalog = useQuery({
    queryKey: ["clips-agent-catalog", hostId],
    queryFn: async () => (await paseo.providers.snapshot()).entries,
  });
  const fallbackAgent = defaultProvider(catalog.data ?? []) ?? "";
  const [agent, setAgent] = useState(defaults.agent || fallbackAgent);
  const [thinkingOptionId, setThinkingOptionId] = useState(defaults.thinkingOptionId);
  const [featureValues, setFeatureValues] = useState<Record<string, FeatureValue>>(defaults.featureValues);
  const [modeId, setModeId] = useState(defaults.modeId || FULL_ACCESS_MODE);

  useEffect(() => {
    if (!open) return;
    setAgent(defaults.agent || fallbackAgent);
    setThinkingOptionId(defaults.thinkingOptionId);
    setFeatureValues(defaults.featureValues);
    setModeId(defaults.modeId || FULL_ACCESS_MODE);
  }, [open, defaults.agent, defaults.thinkingOptionId, defaults.featureValues, defaults.modeId, fallbackAgent]);

  return (
    <Modal title="Configure agent" open={open} onOpenChange={onOpenChange}>
      <Modal.Content>
        <ScrollView style={{ maxHeight: 440 }} contentContainerStyle={{ gap: 12, paddingBottom: 4 }}>
          <Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>{workTitle}</Text>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>
            These choices apply to this new session. They do not change Lanes settings.
          </Text>
          {defaultsError ? <Text style={{ color: theme.colors.statusDanger, fontSize: 12 }}>{defaultsError}</Text> : null}
          <AgentConfigFields
            theme={theme}
            hostId={hostId}
            projectId={projectId}
            agent={agent}
            thinkingOptionId={thinkingOptionId}
            featureValues={featureValues}
            onAgentChange={setAgent}
            onThinkingChange={setThinkingOptionId}
            onFeatureValuesChange={setFeatureValues}
            modeId={modeId}
            onModeChange={setModeId}
            allowAutomatic={false}
          />
        </ScrollView>
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, paddingTop: 12 }}>
          <DialogButton label="Cancel" theme={theme} disabled={busy} onPress={() => onOpenChange(false)} subtle />
          <DialogButton label={busy ? "Starting…" : "Start agent"} theme={theme} disabled={busy || !agent}
            onPress={() => onSubmit({
              provider: agent,
              thinkingOptionId: thinkingOptionId || undefined,
              featureValues,
              modeId,
            })} />
        </View>
      </Modal.Content>
    </Modal>
  );
}

function DialogButton({ label, theme, disabled, onPress, subtle = false }: {
  label: string;
  theme: Theme;
  disabled: boolean;
  onPress: () => void;
  subtle?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => ({
      paddingVertical: 9,
      paddingHorizontal: 13,
      borderWidth: 1,
      borderRadius: 7,
      borderColor: subtle ? theme.colors.border : theme.colors.accent,
      backgroundColor: subtle ? "transparent" : theme.colors.accent,
      opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
    })}>
      <Text style={{ color: subtle ? theme.colors.foreground : theme.colors.accentForeground, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}
