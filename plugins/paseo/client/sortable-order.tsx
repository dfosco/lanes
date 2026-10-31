import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Modal, ScrollView, TextInput } from "@getpaseo/plugin/client/react-native";
import { PanResponder, Pressable, Text, View } from "react-native";
import { useMemo, useRef, useState, type ReactNode } from "react";

type Theme = PluginSurfaceProps["theme"];
const ROW_HEIGHT = 44;
const ROW_GAP = 5;

export function moveOrderedItem<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

function parseValues(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export type OrderOption = { value: string; label: string };

/**
 * With `options` (the live host catalog) new entries are chosen from a dropdown that hides entries
 * already ranked. Without them the editor keeps the free-text input, so saved IDs can still be
 * added when the catalog is loading or unavailable.
 *
 * With `effortOptions` and `onEffortsChange` every row also carries a reasoning effort: the row shows
 * two inline dropdowns, [model] [reasoning effort], and `efforts` maps each ranked item to its effort.
 */
export function SortableOrderEditor({
  label, hint, value, placeholder, theme, onChange, options, selectLabel = "Add",
  efforts = {}, onEffortsChange, effortOptions,
}: {
  label: string;
  hint: string;
  value: string;
  placeholder: string;
  theme: Theme;
  onChange: (value: string) => void;
  options?: readonly OrderOption[];
  selectLabel?: string;
  efforts?: Record<string, string>;
  onEffortsChange?: (efforts: Record<string, string>) => void;
  effortOptions?: (item: string) => readonly OrderOption[];
}) {
  const items = parseValues(value);
  const available = options?.filter((option) => !items.includes(option.value));
  const [newValue, setNewValue] = useState("");
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const pairs = effortOptions && onEffortsChange ? { effortOptions, onEffortsChange } : null;

  const commit = (next: string[]) => onChange(next.join(", "));
  const add = () => {
    const additions = [...new Set(parseValues(newValue))].filter((item) => !items.includes(item));
    if (!additions.length) return;
    commit([...items, ...additions]);
    setNewValue("");
  };
  const without = (item: string) => {
    const { [item]: _removed, ...rest } = efforts;
    return rest;
  };
  const remove = (index: number) => {
    const item = items[index]!;
    commit(items.filter((_, itemIndex) => itemIndex !== index));
    if (pairs && item in efforts) pairs.onEffortsChange(without(item));
  };
  const setEffort = (item: string, effort: string) => {
    if (pairs) pairs.onEffortsChange(effort ? { ...efforts, [item]: effort } : without(item));
  };
  // Swapping the model keeps the row's position and its effort when the new model also offers it.
  const swapModel = (index: number, next: string) => {
    const previous = items[index]!;
    if (!pairs || !next || next === previous || items.includes(next)) return;
    const effort = efforts[previous] ?? "";
    const kept = effort && pairs.effortOptions(next).some((option) => option.value === effort) ? effort : "";
    commit(items.map((item, itemIndex) => itemIndex === index ? next : item));
    pairs.onEffortsChange(kept ? { ...without(previous), [next]: kept } : without(previous));
  };
  const optionLabel = (item: string) => options?.find((option) => option.value === item)?.label ?? item;

  return <View style={{ gap: 7 }}>
    <View style={{ gap: 3 }}>
      <Text style={{ color: theme.colors.foreground, fontSize: 14 }}>{label}</Text>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 16 }}>{hint}</Text>
    </View>
    <View style={{ gap: ROW_GAP }}>
      {items.map((item, index) => <SortableOrderRow key={`${item}-${items.slice(0, index).filter((value) => value === item).length}`} item={item} index={index} count={items.length}
        theme={theme} onMove={(from: number, to: number) => commit(moveOrderedItem(itemsRef.current, from, to))}
        onRemove={() => remove(index)}>
        {pairs ? <>
          <CompactSelect label={`Model for ${item}`} flex={3} theme={theme} value={item} disabled={!options}
            options={[{ value: item, label: optionLabel(item) }, ...(available ?? [])]}
            onValueChange={(next) => swapModel(index, next)} />
          <EffortSelect item={item} effort={efforts[item] ?? ""} choices={pairs.effortOptions(item)} theme={theme}
            onValueChange={(effort) => setEffort(item, effort)} />
        </> : undefined}
      </SortableOrderRow>)}
      {!items.length ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, paddingVertical: 5 }}>No order set.</Text> : null}
    </View>
    {available ? <CompactSelect label={selectLabel} flex={1} theme={theme} value="" options={available}
      placeholder={available.length ? `+ ${selectLabel}` : "Everything available is already ranked"} disabled={!available.length}
      onValueChange={(next) => { if (next && !items.includes(next)) commit([...items, next]); }} /> : <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <TextInput accessibilityLabel={`Add to ${label}`} value={newValue} onChangeText={setNewValue} placeholder={placeholder}
        placeholderTextColor={theme.colors.foregroundMuted}
        onSubmitEditing={add}
        style={{ flex: 1, minWidth: 0, color: theme.colors.foreground, backgroundColor: "transparent",
          borderColor: theme.colors.border, borderWidth: 1, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8 }} />
      <Pressable accessibilityRole="button" accessibilityLabel={`Add ${label}`} disabled={!parseValues(newValue).length}
        onPress={add} style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: 7, paddingHorizontal: 12, paddingVertical: 8,
          opacity: parseValues(newValue).length ? 1 : 0.5 }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>Add</Text>
      </Pressable>
    </View>}
  </View>;
}

/** "Default" means the entry sets no effort, so the role/provider default applies at launch. */
function EffortSelect({ item, effort, choices, theme, onValueChange }: {
  item: string; effort: string; choices: readonly OrderOption[]; theme: Theme; onValueChange: (effort: string) => void;
}) {
  const options = [{ value: "", label: "Default effort" }, ...choices.filter((choice) => choice.value),
    // A saved effort the model no longer offers stays visible so it is not dropped silently.
    ...(effort && !choices.some((choice) => choice.value === effort) ? [{ value: effort, label: `${effort} (unavailable)` }] : [])];
  return <CompactSelect label={`Reasoning effort for ${item}`} flex={2} theme={theme} value={effort}
    options={options} disabled={options.length < 2} onValueChange={onValueChange} />;
}

const SEARCH_THRESHOLD = 8;
const LIST_MAX_HEIGHT = 320;

/** Compact dropdown: a one-line trigger that opens the choices in a host modal. Long lists scroll in a capped area under a name filter. */
function CompactSelect({ label, value, options, onValueChange, theme, disabled = false, flex, placeholder }: {
  label: string;
  value: string;
  options: readonly OrderOption[];
  onValueChange: (value: string) => void;
  theme: Theme;
  disabled?: boolean;
  flex: number;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const text = options.find((option) => option.value === value)?.label ?? placeholder ?? (value || options[0]?.label || "");
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = options.filter((option) => tokens.every((token) => `${option.label} ${option.value}`.toLowerCase().includes(token)));
  const close = () => { setOpen(false); setQuery(""); };
  return <View style={{ flex, minWidth: 0 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${text}`} accessibilityState={{ disabled, expanded: open }}
      disabled={disabled} onPress={() => setOpen(true)}
      style={{ flexDirection: "row", alignItems: "center", gap: 4, height: 32, paddingHorizontal: 8, borderWidth: 1,
        borderColor: theme.colors.border, borderRadius: 6, opacity: disabled ? 0.55 : 1 }}>
      <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: theme.colors.foreground, fontSize: 12 }}>{text}</Text>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10 }}>▾</Text>
    </Pressable>
    {open ? <Modal title={label} open onOpenChange={(next) => { if (!next) close(); else setOpen(true); }}>
      <Modal.Content scrollable={false}>
        <View style={{ gap: 8 }}>
          {options.length > SEARCH_THRESHOLD ? <TextInput accessibilityLabel={`Search ${label}`} value={query} onChangeText={setQuery}
            placeholder="Search by name" placeholderTextColor={theme.colors.foregroundMuted} autoFocus
            style={{ color: theme.colors.foreground, backgroundColor: "transparent", borderColor: theme.colors.border,
              borderWidth: 1, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8 }} /> : null}
          <ScrollView style={{ maxHeight: LIST_MAX_HEIGHT }} keyboardShouldPersistTaps="handled">
            <View style={{ gap: 4 }}>
              {shown.map((option) => <Pressable key={option.value} accessibilityRole="button" accessibilityLabel={option.label}
                accessibilityState={{ selected: option.value === value }}
                onPress={() => { close(); if (option.value !== value) onValueChange(option.value); }}
                style={{ paddingHorizontal: 10, paddingVertical: 9, borderWidth: 1, borderRadius: 6,
                  borderColor: option.value === value ? theme.colors.accent : theme.colors.border }}>
                <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>{option.value === value ? "✓ " : ""}{option.label}</Text>
              </Pressable>)}
              {!shown.length ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, paddingVertical: 6 }}>No matches</Text> : null}
            </View>
          </ScrollView>
        </View>
      </Modal.Content>
    </Modal> : null}
  </View>;
}

function SortableOrderRow({ item, index, count, theme, onMove, onRemove, children }: {
  item: string;
  index: number;
  count: number;
  theme: Theme;
  onMove: (from: number, to: number) => void;
  onRemove: () => void;
  children?: ReactNode;
}) {
  const dragStart = useRef(0);
  const currentIndex = useRef(index);
  const indexRef = useRef(index);
  const countRef = useRef(count);
  const moveRef = useRef(onMove);
  const [dragging, setDragging] = useState(false);
  indexRef.current = index;
  countRef.current = count;
  moveRef.current = onMove;
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      dragStart.current = indexRef.current;
      currentIndex.current = indexRef.current;
      setDragging(true);
    },
    onPanResponderMove: (_event, gesture) => {
      const nextIndex = Math.max(0, Math.min(countRef.current - 1, dragStart.current + Math.round(gesture.dy / (ROW_HEIGHT + ROW_GAP))));
      if (nextIndex !== currentIndex.current) {
        moveRef.current(currentIndex.current, nextIndex);
        currentIndex.current = nextIndex;
      }
    },
    onPanResponderRelease: () => setDragging(false),
    onPanResponderTerminate: () => setDragging(false),
    onPanResponderTerminationRequest: () => false,
  }), []);

  return <View style={{ height: ROW_HEIGHT, flexDirection: "row", alignItems: "center", gap: 8,
    borderWidth: 1, borderColor: dragging ? theme.colors.accent : theme.colors.border, borderRadius: 7, paddingHorizontal: 9, paddingVertical: 4 }}>
    <View {...pan.panHandlers} accessibilityRole="button" accessibilityLabel={`Reorder ${item}`}
      accessibilityHint={`Drag to change priority. Position ${index + 1} of ${count}.`}
      style={{ paddingHorizontal: 4, paddingVertical: 5 }}>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 17 }}>⠿</Text>
    </View>
    {children ?? <Text numberOfLines={1} style={{ color: theme.colors.foreground, flex: 1, fontSize: 13 }}>{item}</Text>}
    <Pressable accessibilityRole="button" accessibilityLabel={`Move ${item} up`} disabled={index === 0}
      onPress={() => onMove(index, index - 1)} style={{ padding: 4, opacity: index === 0 ? 0.3 : 1 }}>
      <Text style={{ color: theme.colors.foregroundMuted }}>↑</Text>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={`Move ${item} down`} disabled={index === count - 1}
      onPress={() => onMove(index, index + 1)} style={{ padding: 4, opacity: index === count - 1 ? 0.3 : 1 }}>
      <Text style={{ color: theme.colors.foregroundMuted }}>↓</Text>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${item}`} onPress={onRemove}
      style={{ paddingHorizontal: 6, paddingVertical: 4 }}>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 16 }}>×</Text>
    </Pressable>
  </View>;
}
