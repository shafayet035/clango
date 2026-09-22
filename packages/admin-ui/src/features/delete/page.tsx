import { Alert, Button, Skeleton } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";

import { deleteRow, fetchCascade, fetchRow, listKeys } from "@/features/list/_api";
import { fetchMeta, metaKeys } from "@/features/meta/_api";
import { findModel, keyOfModel } from "@/features/models/_lib/model";

/** Delete confirmation with a cascade preview of everything else the delete will affect. */
export default function DeletePage(): React.ReactElement {
  const { app, model: segment, id = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const meta = useQuery({ queryKey: metaKeys.root(), queryFn: fetchMeta });
  const model = findModel(meta.data, app, segment);
  const key = model === undefined ? "" : keyOfModel(model);

  const row = useQuery({
    queryKey: listKeys.row(key, id),
    queryFn: () => fetchRow(key, id),
    enabled: model !== undefined,
  });
  const cascade = useQuery({
    queryKey: listKeys.cascade(key, id),
    queryFn: () => fetchCascade(key, id),
    enabled: model !== undefined,
  });

  const remove = useMutation({
    mutationFn: () => deleteRow(key, id),
    onSuccess: async () => {
      toast.success("Deleted.");
      await queryClient.invalidateQueries({ queryKey: listKeys.all });
      await navigate(model?.path ?? "/admin");
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : String(error)),
  });

  if (meta.isPending || row.isPending || cascade.isPending)
    return <Skeleton className="h-40 w-full" />;
  if (model === undefined) return <p className="text-sm text-red-600">Unknown model.</p>;
  if (!model.permissions.delete) {
    return (
      <Alert status="warning">
        <Alert.Title>Not allowed</Alert.Title>
        <Alert.Description>
          You do not have permission to delete {model.verboseNamePlural}.
        </Alert.Description>
      </Alert>
    );
  }

  const labelField = model.listDisplay[0];
  const label = labelField === undefined ? id : String(row.data?.data[labelField] ?? id);
  const related = cascade.data?.data.related ?? [];

  return (
    <section className="flex max-w-2xl flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Delete {model.verboseName}</h1>
        <Button variant="ghost" onPress={() => void navigate(`${model.path}/${id}`)}>
          Back
        </Button>
      </header>

      <p className="text-sm">
        Delete <strong>{label}</strong>? This cannot be undone.
      </p>

      {related.length > 0 ? (
        <Alert status="warning">
          <Alert.Title>Related rows will change</Alert.Title>
          <Alert.Description>
            <ul className="mt-1 list-disc pl-4">
              {related.map((entry) => (
                <li key={`${entry.model}.${entry.field}`}>
                  {entry.action === "cascade" ? "Deletes" : "Clears the relation on"}{" "}
                  <strong>{entry.capped ? `at least ${entry.count}` : entry.count}</strong> row(s)
                  in {entry.model} via <code>{entry.field}</code>
                  {entry.sample.length === 0 ? null : (
                    <span className="text-neutral-500"> ({entry.sample.join(", ")})</span>
                  )}
                </li>
              ))}
            </ul>
          </Alert.Description>
        </Alert>
      ) : (
        <p className="text-xs text-neutral-500">No related rows will be affected.</p>
      )}

      <footer className="flex items-center gap-2">
        <Button variant="danger" isDisabled={remove.isPending} onPress={() => remove.mutate()}>
          {remove.isPending ? "Deleting…" : "Delete"}
        </Button>
        <Button variant="ghost" onPress={() => void navigate(model.path)}>
          Cancel
        </Button>
      </footer>
    </section>
  );
}
