import { Button, Chip, Pagination, Skeleton, Table } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";

import { FieldControl } from "@/components/field-control";
import { fetchList, listKeys, runAction } from "@/features/list/_api";
import { formatCell, listQueryString, orderMarker, toggleOrder } from "@/features/list/_lib/format";
import type { ListResult } from "@/features/list/_types";
import { fetchMeta, metaKeys } from "@/features/meta/_api";
import { findModel, keyOfModel } from "@/features/models/_lib/model";
import type { FormValue } from "@/features/form/_lib/values";
import { useRelationLabels } from "@/features/list/_lib/use-relation-labels";

const PAGE_SIZE = 25;

/** List view: sortable columns, filters, search, bounded counts and bulk actions. */
export default function ListPage(): React.ReactElement {
  const { app, model: segment } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [cursorStack, setCursorStack] = useState<readonly (string | null)[]>([null]);
  const [selected, setSelected] = useState<readonly string[]>([]);

  const meta = useQuery({ queryKey: metaKeys.root(), queryFn: fetchMeta });
  const model = findModel(meta.data, app, segment);
  const key = model === undefined ? "" : keyOfModel(model);
  const cursor = params.get("cursor");

  const search = useMemo(() => listQueryString(params, PAGE_SIZE, cursor), [params, cursor]);
  const list = useQuery({
    queryKey: [...listKeys.page(key), search],
    queryFn: () => fetchList(key, search),
    enabled: model !== undefined,
  });

  const action = useMutation({
    mutationFn: (input: { name: string; ids: readonly string[] }) =>
      runAction(key, input.name, input.ids),
    onSuccess: async (result) => {
      toast.success(`${result.data.affected} row(s) updated.`);
      setSelected([]);
      await queryClient.invalidateQueries({ queryKey: listKeys.all });
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : String(error)),
  });

  if (meta.isPending) return <Skeleton className="h-64 w-full" />;
  if (model === undefined) {
    return (
      <p className="text-sm text-red-600">
        Unknown model “{app}/{segment}”.
      </p>
    );
  }

  const page: ListResult | undefined = list.data;
  const rows = page?.data ?? [];
  const labels = useRelationLabels(model, rows);

  function setParam(name: string, value: string): void {
    const next = new URLSearchParams(params);
    if (value.length === 0) next.delete(name);
    else next.set(name, value);
    next.delete("cursor");
    setCursorStack([null]);
    setSelected([]);
    setParams(next);
  }

  function goTo(cursorValue: string | null, position: number): void {
    const next = new URLSearchParams(params);
    if (cursorValue === null) next.delete("cursor");
    else next.set("cursor", cursorValue);
    setSelected([]);
    setCursorStack((current) => current.slice(0, position + 1));
    setParams(next);
  }

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{model.verboseNamePlural}</h1>
        {model.permissions.add ? (
          <Button variant="primary" onPress={() => void navigate(`${model.path}/new`)}>
            <Plus className="size-4" /> Add {model.verboseName}
          </Button>
        ) : null}
      </header>

      <div className="flex flex-wrap items-end gap-3">
        {model.searchFields.length > 0 ? (
          <label className="flex flex-col gap-1 text-xs text-neutral-500">
            Search
            <input
              type="search"
              className="w-64 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-900"
              value={params.get("search") ?? ""}
              onChange={(event) => setParam("search", event.target.value)}
            />
          </label>
        ) : null}
        {model.listFilter.map((name) => {
          const field = model.fields.find((candidate) => candidate.name === name);
          if (field === undefined) return null;
          return (
            <label key={name} className="flex w-44 flex-col gap-1 text-xs text-neutral-500">
              {field.label}
              <FieldControl
                field={field}
                value={(params.get(name) ?? "") as FormValue}
                onChange={(value) =>
                  setParam(name, typeof value === "boolean" ? String(value) : value)
                }
              />
            </label>
          );
        })}
        {list.isFetching ? <span className="pb-2 text-xs text-neutral-500">Loading…</span> : null}
      </div>

      {list.isError ? (
        <p className="text-sm text-red-600">
          {list.error instanceof Error ? list.error.message : String(list.error)}
        </p>
      ) : null}

      <Table aria-label={model.verboseNamePlural}>
        <Table.ScrollContainer>
          <Table.Content>
            <Table.Header>
              <Table.Column className="w-8">
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={rows.length > 0 && selected.length === rows.length}
                  onChange={(event) =>
                    setSelected(event.target.checked ? rows.map((row) => String(row["id"])) : [])
                  }
                />
              </Table.Column>
              {model.listDisplay.map((name) => (
                <Table.Column key={name} isRowHeader>
                  <button
                    type="button"
                    className="flex items-center gap-1 text-left"
                    onClick={() =>
                      setParam(
                        "order",
                        toggleOrder(params.get("order") ?? model.ordering.join(","), name),
                      )
                    }
                  >
                    {model.fields.find((field) => field.name === name)?.label ?? name}
                    <span aria-hidden="true">
                      {orderMarker(params.get("order") ?? model.ordering.join(","), name)}
                    </span>
                  </button>
                </Table.Column>
              ))}
              <Table.Column> </Table.Column>
            </Table.Header>
            <Table.Body>
              {rows.map((row) => {
                const id = String(row["id"]);
                return (
                  <Table.Row key={id}>
                    <Table.Cell>
                      <input
                        type="checkbox"
                        aria-label={`Select ${id}`}
                        checked={selected.includes(id)}
                        onChange={(event) =>
                          setSelected((current) =>
                            event.target.checked
                              ? [...current, id]
                              : current.filter((entry) => entry !== id),
                          )
                        }
                      />
                    </Table.Cell>
                    {model.listDisplay.map((name) => (
                      <Table.Cell key={name}>
                        {formatCell(
                          model.fields.find((field) => field.name === name),
                          row[name],
                          labels,
                        )}
                      </Table.Cell>
                    ))}
                    <Table.Cell>
                      <div className="flex justify-end gap-2">
                        {model.permissions.change ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onPress={() => void navigate(`${model.path}/${id}`)}
                          >
                            Edit
                          </Button>
                        ) : null}
                        {model.permissions.delete ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onPress={() => void navigate(`${model.path}/${id}/delete`)}
                          >
                            Delete
                          </Button>
                        ) : null}
                      </div>
                    </Table.Cell>
                  </Table.Row>
                );
              })}
              {rows.length === 0 && !list.isFetching ? (
                <Table.Row>
                  <Table.Cell colSpan={model.listDisplay.length + 2}>
                    <span className="text-sm text-neutral-500">
                      No {model.verboseNamePlural} yet.
                    </span>
                  </Table.Cell>
                </Table.Row>
              ) : null}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>

      <footer className="flex items-center justify-between">
        <span className="text-xs text-neutral-500">
          {page?.page.count ?? 0}
          {page?.page.countCapped === true ? "+" : ""} {model.verboseNamePlural}
        </span>
        <Pagination>
          <Pagination.Content>
            <Pagination.Item>
              <Pagination.Previous
                isDisabled={cursorStack.length <= 1}
                onPress={() => {
                  const position = cursorStack.length - 2;
                  goTo(cursorStack[position] ?? null, position);
                }}
              >
                <Pagination.PreviousIcon />
                Previous
              </Pagination.Previous>
            </Pagination.Item>
            <Pagination.Item>
              <Pagination.Next
                isDisabled={page?.page.nextCursor === null || page?.page.nextCursor === undefined}
                onPress={() => {
                  const nextCursor = page?.page.nextCursor;
                  if (nextCursor === null || nextCursor === undefined) return;
                  setCursorStack((current) => [...current, nextCursor]);
                  goTo(nextCursor, cursorStack.length);
                }}
              >
                Next
                <Pagination.NextIcon />
              </Pagination.Next>
            </Pagination.Item>
          </Pagination.Content>
        </Pagination>
      </footer>

      {model.actions.length > 0 && model.permissions.change ? (
        <div className="flex items-center gap-2">
          {selected.length > 0 ? <Chip>{selected.length} selected</Chip> : null}
          {model.actions.map((entry) => (
            <Button
              key={entry.name}
              variant="secondary"
              isDisabled={selected.length === 0 || action.isPending}
              onPress={() => action.mutate({ name: entry.name, ids: selected })}
            >
              {entry.label}
            </Button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
