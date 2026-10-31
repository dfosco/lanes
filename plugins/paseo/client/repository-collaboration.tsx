import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { collaborationRpc, type CollaborationCapability } from "../shared/contracts";

export function RepositoryCollaboration({ hostId, projectId, projectLabel, capability, theme }: {
  hostId: string; projectId: string; projectLabel: string;
  capability: CollaborationCapability; theme: PluginSurfaceProps["theme"];
}) {
  const update = useRpc(collaborationRpc);
  const cache = useQueryClient();
  const [open, setOpen] = useState(false);
  const mutation = useMutation({
    mutationFn: (input: { projectId: string; enabled: boolean; hostId: string }) =>
      update({ projectId: input.projectId, enabled: input.enabled }),
    onSuccess: (result, input) => {
      cache.setQueryData(["clips.board", input.hostId, input.projectId], result);
      void cache.invalidateQueries({ queryKey: ["clips.board", input.hostId, input.projectId] });
    },
  });
  const unavailable = capability.enabled === null || capability.state === "invalid";
  return <View style={{ gap: 8 }}>
    <Pressable accessibilityRole="button" accessibilityLabel="Repository collaboration"
      accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={{ alignSelf: "flex-start", paddingVertical: 6 }}>
      <Text style={{ color: theme.colors.accent, fontSize: 12 }}>Repository collaboration · {capability.state}</Text>
    </Pressable>
    {open ? <View style={{ padding: 14, gap: 10, borderWidth: 1, borderRadius: 10,
      borderColor: theme.colors.border, backgroundColor: theme.colors.surface1 }}>
      <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>GitHub collaboration · {projectLabel}</Text>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>
        Uses this repository’s Git origin. Enabling does not publish now; later Lanes changes may sync automatically.
      </Text>
      {capability.error ? <Text style={{ color: theme.colors.statusDanger, fontSize: 12 }}>{capability.error}</Text> : null}
      {mutation.isError ? <Text style={{ color: theme.colors.statusDanger, fontSize: 12 }}>
        Could not update repository collaboration: {mutation.error instanceof Error ? mutation.error.message : String(mutation.error)}
      </Text> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={unavailable ? "Collaboration unavailable" : capability.enabled ? "Disable GitHub collaboration" : "Enable GitHub collaboration"}
        disabled={unavailable || mutation.isPending} onPress={() => mutation.mutate({ hostId, projectId, enabled: !capability.enabled })}
        style={{ alignSelf: "flex-start", paddingVertical: 7, paddingHorizontal: 10, borderWidth: 1,
          borderColor: theme.colors.border, borderRadius: 7, opacity: unavailable || mutation.isPending ? 0.5 : 1 }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>{mutation.isPending ? "Saving…" : unavailable ? "Unavailable" : capability.enabled ? "Disable" : "Enable"}</Text>
      </Pressable>
    </View> : null}
  </View>;
}
