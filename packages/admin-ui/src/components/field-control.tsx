import type { AdminFieldMeta } from "@/features/meta/_types";
import { Input, ListBox, Select, TextArea } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { fetchOptions, listKeys } from "@/features/list/_api";
import { modelKeyOf } from "@/features/models/_lib/model";
import { widgetByName } from "@/lib/widgets";
import type { FormValue } from "@/features/form/_lib/values";

interface FieldControlProps {
  readonly field: AdminFieldMeta;
  readonly value: FormValue;
  readonly onChange: (value: FormValue) => void;
  readonly disabled?: boolean;
}

/** Renders the HeroUI control that matches a field's widget. */
export function FieldControl({
  field,
  value,
  onChange,
  disabled = false,
}: FieldControlProps): React.ReactElement {
  // A custom widget wins over the built-in control, and a name nobody registered falls through, so
  // a renamed widget degrades to the default instead of blanking the field.
  const Custom = field.customWidget === undefined ? undefined : widgetByName(field.customWidget);
  if (Custom !== undefined) {
    return <Custom field={field} value={value} onChange={onChange} disabled={disabled} />;
  }

  const text = typeof value === "string" ? value : "";

  switch (field.widget) {
    case "checkbox":
      return (
        <input
          type="checkbox"
          className="size-4 accent-[var(--color-accent)]"
          checked={value === true}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
      );
    case "textarea":
    case "json":
      return (
        <TextArea
          rows={field.widget === "json" ? 8 : 5}
          spellCheck={field.widget === "json" ? false : undefined}
          value={text}
          disabled={disabled}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)}
        />
      );
    case "select":
      return (
        <Select
          aria-label={field.label}
          isDisabled={disabled}
          selectedKey={text.length === 0 ? null : text}
          onSelectionChange={(key) => onChange(key === null ? "" : String(key))}
        >
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              <ListBox.Item id="" textValue="—">
                —
                <ListBox.ItemIndicator />
              </ListBox.Item>
              {(field.choices ?? []).map((choice) => (
                <ListBox.Item key={choice} id={choice} textValue={choice}>
                  {choice}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      );
    case "datetime":
      return (
        <Input
          type="datetime-local"
          value={text}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case "date":
      return (
        <Input
          type="date"
          value={text}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case "number":
      return (
        <Input
          type="number"
          step={field.scale === undefined ? 1 : 1 / 10 ** field.scale}
          value={text}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case "email":
      return (
        <Input
          type="email"
          value={text}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case "url":
      return (
        <Input
          type="url"
          value={text}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case "relation":
      return <RelationPicker field={field} value={text} onChange={onChange} disabled={disabled} />;
    case "multiRelation":
      return <p className="text-xs text-neutral-500">Many-to-many editing arrives in M5.</p>;
    case "file":
    case "image":
      return (
        <Input
          placeholder="R2 object key"
          value={text}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    default:
      return (
        <Input
          value={text}
          maxLength={field.maxLength}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      );
  }
}

const EMPTY_OPTIONS: readonly { id: string; label: string }[] = [];

/**
 * Searchable select for a foreign key.
 *
 * Options come from the target model's `/options` endpoint, which uses its FTS index when it has one
 * and a bounded `LIKE` prefix otherwise, so the picker never loads a whole table.
 */
function RelationPicker({
  field,
  value,
  onChange,
  disabled,
}: {
  field: AdminFieldMeta;
  value: string;
  onChange: (value: FormValue) => void;
  disabled: boolean;
}): React.ReactElement {
  const [query, setQuery] = useState("");
  const target = field.related === undefined ? "" : modelKeyOf(field.related.model);
  const selected = useQuery({
    queryKey: listKeys.options(target, "", [value]),
    queryFn: () => fetchOptions(target, "", [value]),
    enabled: value.length > 0 && target.length > 0,
  });
  const results = useQuery({
    queryKey: listKeys.options(target, query, []),
    queryFn: () => fetchOptions(target, query),
    enabled: query.length > 0 && target.length > 0,
  });

  useEffect(() => {
    setQuery("");
  }, [field.name]);

  const label =
    selected.data?.data.find((option) => option.id === value)?.label ??
    field.related?.labelField ??
    value;
  const options = query.length === 0 ? EMPTY_OPTIONS : (results.data?.data ?? EMPTY_OPTIONS);

  return (
    <div className="relative">
      <Input
        placeholder={value.length === 0 ? "Search…" : value}
        value={query}
        disabled={disabled}
        onFocus={() => setQuery("")}
        onChange={(event) => setQuery(event.target.value)}
      />
      {value.length > 0 && query.length === 0 ? (
        <p className="mt-1 text-xs text-neutral-500">{label}</p>
      ) : null}
      {options.length > 0 ? (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-neutral-200 bg-white p-1 shadow-lg">
          <li>
            <button
              type="button"
              className="w-full rounded px-2 py-1 text-left text-sm hover:bg-neutral-100"
              onClick={() => {
                onChange("");
                setQuery("");
              }}
            >
              — none —
            </button>
          </li>
          {options.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                className="w-full rounded px-2 py-1 text-left text-sm hover:bg-neutral-100"
                onClick={() => {
                  onChange(option.id);
                  setQuery("");
                }}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
