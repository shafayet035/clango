import { Alert, Button, Fieldset, Skeleton } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";

import { FieldControl } from "../../components/field-control";
import { createRow, fetchRow, listKeys, updateRow } from "../list/_api";
import { fetchMeta, metaKeys } from "../meta/_api";
import { findModel, keyOfModel } from "../models/_lib/model";
import {
  buildCreatePayload,
  buildUpdatePayload,
  emptyFormValue,
  validateRequired,
  valuesFromRow,
  type FormValue,
} from "./_lib/values";

interface FieldIssue {
  readonly path?: readonly (string | number)[];
  readonly message?: string;
}

function issuesOf(error: unknown): readonly FieldIssue[] {
  const details = (error as { details?: unknown } | null)?.details;
  return Array.isArray(details) ? (details as readonly FieldIssue[]) : [];
}

/** Create and edit form: fieldsets, per-widget controls and inline validation errors. */
export default function FormPage(): React.ReactElement {
  const { app, model: segment, id } = useParams();
  const editing = id !== undefined;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, FormValue>>({});
  const [missing, setMissing] = useState<readonly string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  const meta = useQuery({ queryKey: metaKeys.root(), queryFn: fetchMeta });
  const model = findModel(meta.data, app, segment);
  const key = model === undefined ? "" : keyOfModel(model);
  const row = useQuery({
    queryKey: listKeys.row(key, id ?? ""),
    queryFn: () => fetchRow(key, id as string),
    enabled: model !== undefined && editing,
  });

  const fields = useMemo(() => model?.fields ?? [], [model]);
  // Creating needs `add`, editing needs `change`; without either the form is read-only.
  const mayWrite =
    model === undefined ? false : editing ? model.permissions.change : model.permissions.add;

  useEffect(() => {
    if (model === undefined) return;
    if (editing) {
      if (row.data !== undefined) setValues(valuesFromRow(fields, row.data.data));
      return;
    }
    const initial: Record<string, FormValue> = {};
    for (const field of fields) if (field.editable) initial[field.name] = emptyFormValue(field);
    setValues(initial);
  }, [model, editing, row.data, fields]);

  const save = useMutation({
    mutationFn: async (payload: Record<string, unknown>) =>
      editing ? updateRow(key, id as string, payload) : createRow(key, payload),
    onSuccess: async (result) => {
      toast.success(editing ? "Saved." : "Created.");
      await queryClient.invalidateQueries({ queryKey: listKeys.all });
      await navigate(`${model?.path ?? ""}/${String(result.data["id"])}`);
    },
    onError: (error: unknown) => {
      setFormError(error instanceof Error ? error.message : String(error));
    },
  });

  if (meta.isPending || (editing && row.isPending)) return <Skeleton className="h-64 w-full" />;
  if (model === undefined) return <p className="text-sm text-red-600">Unknown model.</p>;

  const issues = issuesOf(save.error);

  function submit(): void {
    const empty = validateRequired(fields, values);
    setMissing(empty);
    setFormError(null);
    if (empty.length > 0) return;

    let payload: Record<string, unknown>;
    try {
      payload = editing ? buildUpdatePayload(fields, values) : buildCreatePayload(fields, values);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : String(cause));
      return;
    }
    save.mutate(payload);
  }

  return (
    <section className="flex max-w-3xl flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">
          {editing ? `Edit ${model.verboseName}` : `New ${model.verboseName}`}
          {editing ? <span className="ml-2 text-sm font-normal text-neutral-500">{id}</span> : null}
        </h1>
        <Button variant="ghost" onPress={() => void navigate(model.path)}>
          Back to list
        </Button>
      </header>

      {formError !== null ? (
        <Alert status="danger">
          <Alert.Title>Could not save</Alert.Title>
          <Alert.Description>{formError}</Alert.Description>
        </Alert>
      ) : null}
      {missing.length > 0 ? (
        <Alert status="warning">
          <Alert.Title>Required fields are empty</Alert.Title>
          <Alert.Description>{missing.join(", ")}</Alert.Description>
        </Alert>
      ) : null}

      {model.fieldsets.map((fieldset, index) => (
        <Fieldset key={fieldset.title}>
          <Fieldset.Legend>{index === 0 ? fieldset.title : fieldset.title}</Fieldset.Legend>
          {fieldset.description === undefined ? null : (
            <p className="mb-2 text-xs text-neutral-500">{fieldset.description}</p>
          )}
          <Fieldset.Group className="flex flex-col gap-3">
            {fieldset.fields.map((name) => {
              const field = model.fields.find((candidate) => candidate.name === name);
              if (field === undefined) return null;
              const message = issues.find((issue) => issue.path?.[0] === name)?.message;
              return (
                <div key={name} className="grid grid-cols-[180px_1fr] items-start gap-3">
                  <label className="pt-1.5 text-sm text-neutral-700">
                    {field.label}
                    {field.required ? <span className="text-red-600"> *</span> : null}
                  </label>
                  <div className="max-w-xl">
                    <FieldControl
                      field={field}
                      value={values[name] ?? emptyFormValue(field)}
                      disabled={!field.editable || !mayWrite}
                      onChange={(value) => setValues((current) => ({ ...current, [name]: value }))}
                    />
                    {field.helpText === undefined ? null : (
                      <p className="mt-1 text-xs text-neutral-500">{field.helpText}</p>
                    )}
                    {message === undefined ? null : (
                      <p className="mt-1 text-xs text-red-600">{message}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </Fieldset.Group>
        </Fieldset>
      ))}

      {!mayWrite ? (
        <Alert status="warning">
          <Alert.Title>Read-only</Alert.Title>
          <Alert.Description>
            You do not have permission to {editing ? "edit" : "create"} {model.verboseNamePlural}.
          </Alert.Description>
        </Alert>
      ) : null}

      <footer className="flex items-center gap-2">
        {mayWrite ? (
          <Button variant="primary" isDisabled={save.isPending} onPress={submit}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        ) : null}
        <Button variant="ghost" onPress={() => void navigate(model.path)}>
          Cancel
        </Button>
        {editing && model.permissions.delete ? (
          <Button
            variant="danger"
            className="ml-auto"
            onPress={() => void navigate(`${model.path}/${id}/delete`)}
          >
            Delete
          </Button>
        ) : null}
      </footer>
    </section>
  );
}
