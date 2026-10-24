import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import {
  SettingsAction, SettingsCard, SettingsInput, SettingsSection, SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import {
  resourceManagerPreferences, resourceManagerSettings, resourceManagerStatusRpc,
  type ResourceManagerSettings, type ResourceManagerStatus,
} from "../shared/resource-manager";

type Theme = PluginSurfaceProps["theme"];
type NumericSetting = Exclude<keyof ResourceManagerSettings, "enabled">;
type Draft = {
  revision: string;
  values: ResourceManagerSettings;
  numbers: Partial<Record<NumericSetting, string>>;
};
type Field = { key: NumericSetting; label: string; hint?: string };

const thresholdFields: Field[] = [
  { key: "memoryWarningPercent", label: "Memory warning (%)" },
  { key: "memoryCriticalPercent", label: "Memory critical (%)" },
  { key: "memoryRecoveryPercent", label: "Memory recovery (%)" },
  { key: "cpuWarningPercent", label: "CPU warning (%)" },
  { key: "cpuCriticalPercent", label: "CPU critical (%)" },
  { key: "cpuRecoveryPercent", label: "CPU recovery (%)" },
];
const timingFields: Field[] = [
  { key: "sampleIntervalSeconds", label: "Sample interval (seconds)", hint: "5–300 seconds between observations." },
  { key: "consecutiveSamples", label: "Consecutive samples", hint: "2–20 matching observations before pressure changes." },
  { key: "notificationCooldownSeconds", label: "Notice cooldown (seconds)", hint: "30–3,600 seconds between repeated manager notices." },
  { key: "idleAgeSeconds", label: "Old idle age (seconds)", hint: "0–86,400 seconds before an idle developer is prioritized as old." },
];
const stateLabels: Record<ResourceManagerStatus["state"], string> = {
  starting: "Starting monitor",
  monitoring: "Monitoring host",
  awaiting_runtime: "Waiting for Paseo connection",
  disabled: "Disabled",
  error: "Monitor unavailable",
  stopped: "Monitor stopped",
};
const percent = (value: number | null | undefined) => value == null ? "Unknown" : `${Math.round(value * 100)}%`;
const bytes = (value: number) => `${(value / 1024 ** 3).toFixed(1)} GiB`;
const timestamp = (value: number) => new Date(value).toLocaleString();

function MonitorStatus({ status, theme }: { status: ResourceManagerStatus; theme: Theme }) {
  const snapshot = status.snapshot;
  const available = snapshot?.availableMemoryBytes;
  const total = snapshot?.totalMemoryBytes;
  return <View style={{ gap: 6 }}>
    <Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>{stateLabels[status.state]}</Text>
    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
      Pressure: {snapshot ? status.pressure : "Awaiting measurements"}{snapshot && status.reasons.length ? ` · ${status.reasons.map((reason) => reason === "cpu" ? "CPU" : "Memory").join(" and ")}` : ""}
    </Text>
    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
      Memory used: {percent(snapshot?.memoryUsedRatio)}
      {available != null && total != null ? ` · ${bytes(available)} available of ${bytes(total)}` : ""}
      {"\n"}CPU used: {percent(snapshot?.cpuUsedRatio)}
      {"\n"}{snapshot ? `Sampled: ${timestamp(snapshot.sampledAt)}` : "Waiting for the first resource sample."}
    </Text>
    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
      Managers notified this episode: {status.notifiedManagers} · Busy managers deferred: {status.deferredManagers}
      {"\n"}Last notice: {status.lastNoticeAt === null ? "None" : timestamp(status.lastNoticeAt)}
    </Text>
    {status.lastError ? <Text style={{ color: theme.colors.statusDanger, fontSize: 12 }}>{status.lastError}</Text> : null}
  </View>;
}

/** The monitor runs on the daemon; this view only observes it and edits host policy. */
export function ResourceSettings({ theme, hostId }: { theme: Theme; hostId: string }) {
  const settings = useSettings(resourceManagerPreferences);
  const fetchStatus = useRpc(resourceManagerStatusRpc);
  const status = useQuery({
    queryKey: ["clips.resource-manager.status", hostId],
    queryFn: () => fetchStatus({}),
    refetchInterval: 15_000,
    enabled: Boolean(hostId),
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showTiming, setShowTiming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reload = async () => {
    setSaving(true); setError(null);
    try {
      await settings.reload();
      setDraft(null);
    } catch (reloadError) {
      setError(`Could not reload resource settings: ${reloadError instanceof Error ? reloadError.message : String(reloadError)}`);
    } finally { setSaving(false); }
  };

  if (settings.status === "loading") return <ActivityIndicator color={theme.colors.foregroundMuted} />;
  if (settings.status !== "ready") {
    return <SettingsSection title="Resource manager"><SettingsCard>
      <Text style={{ color: theme.colors.statusDanger }}>Resource settings unavailable: {settings.error}</Text>
      {error ? <Text style={{ color: theme.colors.statusDanger }}>{error}</Text> : null}
      <SettingsAction label="Resource settings" actionLabel="Reload settings" disabled={saving} onPress={() => void reload()} />
    </SettingsCard></SettingsSection>;
  }

  const values = draft?.values ?? settings.values;
  const revision = draft?.revision ?? settings.revision;
  const stale = draft !== null && draft.revision !== settings.revision;
  const busy = saving || settings.saving;
  const candidate = { ...values };
  for (const [key, value] of Object.entries(draft?.numbers ?? {})) {
    candidate[key as NumericSetting] = value.trim() ? Number(value) : NaN;
  }
  const validation = resourceManagerSettings.safeParse(candidate);
  const validationErrors = new Map<string, string>();
  if (!validation.success) for (const issue of validation.error.issues) {
    const key = String(issue.path[0]);
    if (!validationErrors.has(key)) validationErrors.set(key, issue.message);
  }
  const changed = draft !== null && (!validation.success ||
    Object.keys(candidate).some((key) => candidate[key as keyof ResourceManagerSettings] !== settings.values[key as keyof ResourceManagerSettings]));

  const change = (key: NumericSetting, value: string) => {
    setError(null);
    setDraft((current) => ({
      ...(current ?? { values: settings.values, revision: settings.revision, numbers: {} }),
      numbers: { ...current?.numbers, [key]: value },
    }));
  };
  const save = async () => {
    if (!draft || stale || busy || !validation.success) return;
    setSaving(true); setError(null);
    try {
      const saved = await settings.save(validation.data, draft.revision);
      if (!saved) {
        setError("Could not save resource settings. Your edits are preserved. If settings changed elsewhere, discard these edits and reload before trying again.");
        return;
      }
      setDraft(null);
      void status.refetch();
    } catch (saveError) {
      setError(`Could not save resource settings: ${saveError instanceof Error ? saveError.message : String(saveError)}`);
    } finally { setSaving(false); }
  };
  const fields = (entries: Field[]) => entries.map((field) => <SettingsInput
    key={`${revision}:${field.key}`}
    label={field.label} hint={field.hint} error={validationErrors.get(field.key)}
    initialValue={draft?.numbers[field.key] ?? String(values[field.key])}
    onChangeText={(value) => change(field.key, value)} disabled={busy}
  />);

  return <View style={{ gap: 14 }}>
    <SettingsSection title="Resource manager">
      <SettingsCard>
        <SettingsSwitch label="Manage resource pressure" value={values.enabled} disabled={busy}
          hint="Ask Lane Managers to retire old idle developers first, then safely hand off current work when needed. Applies to this Paseo host."
          onValueChange={(enabled) => {
            setError(null);
            setDraft((current) => ({
              ...(current ?? { values: settings.values, revision: settings.revision, numbers: {} }),
              values: { ...(current?.values ?? settings.values), enabled },
            }));
          }} />
        {status.isLoading ? <ActivityIndicator color={theme.colors.foregroundMuted} /> : null}
        {status.isError ? <Text style={{ color: theme.colors.statusDanger, fontSize: 12 }}>
          Monitor status unavailable: {String(status.error)}
        </Text> : null}
        {status.data ? <MonitorStatus status={status.data} theme={theme} /> : null}
      </SettingsCard>
    </SettingsSection>
    <SettingsSection title="Pressure thresholds">
      <SettingsCard>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>
          Percent of host capacity in use. For each resource, recovery must be below warning, and warning below critical.
          Pressure must persist across consecutive samples before managers are notified.
        </Text>
        {fields(thresholdFields)}
        <SettingsAction label="Timing" actionLabel={showTiming ? "Hide timing" : "Show timing"}
          hint="Sampling, notice frequency, and which idle sessions are considered old."
          onPress={() => setShowTiming((shown) => !shown)} />
        {showTiming ? fields(timingFields) : null}
        {stale ? <Text style={{ color: theme.colors.statusDanger, fontSize: 12 }}>
          Host settings changed while you were editing. Your edits have not been saved. Discard them and reload to keep the newer host values.
        </Text> : null}
        {error || settings.saveError ? <Text style={{ color: theme.colors.statusDanger, fontSize: 12 }}>{error ?? settings.saveError}</Text> : null}
        <SettingsAction label="Resource policy" actionLabel={busy ? "Saving…" : "Save resource settings"}
          hint="Changes take effect on the host without restarting agents."
          disabled={busy || !changed || stale || !validation.success} onPress={() => void save()} />
        {draft ? <SettingsAction label="Unsaved changes" actionLabel="Discard edits and reload"
          disabled={busy} onPress={() => void reload()} /> : null}
      </SettingsCard>
    </SettingsSection>
  </View>;
}
