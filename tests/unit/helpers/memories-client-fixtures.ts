process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";

export async function loadMemoriesClient() {
  return import("../../../lib/memories-client");
}

export type MemoriesModule = Awaited<ReturnType<typeof loadMemoriesClient>>;
export type Embedder = Parameters<
  MemoriesModule["createMemoriesClient"]
>[1] extends
  | {
      embedder: infer E;
    }
  | undefined
  ? E
  : never;
export type Memory = Awaited<ReturnType<MemoriesModule["addToLane"]>>;
export type MemoriesClient = Parameters<MemoriesModule["editMemory"]>[0];
export type SupabaseLike = Parameters<
  MemoriesModule["createMemoriesClient"]
>[1] extends { supabase: infer S } | undefined
  ? S
  : never;

export type Call = { method: string; args: Record<string, unknown> };

export function makeFakeSupabase(rows: Memory[] = []) {
  const calls: Call[] = [];
  let affectedIds: string[] = rows.map((r) => r.id);
  let rpcError: { message: string } | null = null;

  const filters: Record<string, unknown> = {};
  let currentTable = "";
  let mutation: "select" | "insert" | "update" | "delete" = "select";
  let insertPayload: Record<string, unknown> | null = null;
  let updatePayload: Record<string, unknown> | null = null;
  let ilikePattern: string | null = null;
  let returnSelect = false;

  const reset = () => {
    for (const key of Object.keys(filters)) delete filters[key];
    mutation = "select";
    insertPayload = null;
    updatePayload = null;
    ilikePattern = null;
    returnSelect = false;
  };

  const unescapeLike = (value: string) => value.replace(/\\([\\%_])/g, "$1");

  const readRowValue = (row: Memory, column: string) => {
    if (column.startsWith("metadata->>")) {
      const key = column.slice("metadata->>".length);
      return row.metadata?.[key] ?? null;
    }
    return (row as Record<string, unknown>)[column];
  };

  const matchesFilters = (row: Memory) =>
    Object.entries(filters).every(([key, value]) => {
      if (key.endsWith("__contains")) {
        const column = key.slice(0, -"__contains".length);
        const rowValue = readRowValue(row, column);
        if (
          !rowValue ||
          typeof rowValue !== "object" ||
          Array.isArray(rowValue)
        ) {
          return false;
        }

        return Object.entries(value as Record<string, unknown>).every(
          ([nestedKey, nestedValue]) =>
            (rowValue as Record<string, unknown>)[nestedKey] === nestedValue
        );
      }

      if (key.endsWith("__ilike")) {
        const column = key.slice(0, -7);
        const rowValue = readRowValue(row, column);
        if (typeof rowValue !== "string") return false;
        const needle = unescapeLike(String(value))
          .replace(/%/g, "")
          .toLowerCase();
        return rowValue.toLowerCase().includes(needle);
      }

      if (key.endsWith("__is")) {
        const column = key.slice(0, -4);
        const rowValue = readRowValue(row, column);
        if (value === null) return rowValue == null;
        return rowValue === value;
      }

      if (key.endsWith("__lt")) {
        const column = key.slice(0, -4);
        const rowValue = readRowValue(row, column);
        return rowValue === undefined
          ? true
          : String(rowValue).localeCompare(String(value)) < 0;
      }

      const rowValue = readRowValue(row, key);
      return rowValue === undefined ? true : rowValue === value;
    });

  const filteredRows = () => rows.filter(matchesFilters);

  const builder: Record<string, unknown> = {
    insert(payload: Record<string, unknown>) {
      mutation = "insert";
      insertPayload = payload;
      return builder;
    },
    update(payload: Record<string, unknown>) {
      mutation = "update";
      updatePayload = payload;
      return builder;
    },
    delete() {
      mutation = "delete";
      return builder;
    },
    eq(col: string, val: unknown) {
      filters[col] = val;
      return builder;
    },
    lt(col: string, val: unknown) {
      filters[`${col}__lt`] = val;
      return builder;
    },
    ilike(col: string, pattern: string) {
      filters[`${col}__ilike`] = pattern;
      ilikePattern = pattern;
      return builder;
    },
    contains(col: string, value: Record<string, unknown>) {
      filters[`${col}__contains`] = value;
      return builder;
    },
    is(col: string, val: unknown) {
      filters[`${col}__is`] = val;
      return builder;
    },
    order() {
      return builder;
    },
    limit() {
      return builder;
    },
    single() {
      const selectedRows = filteredRows();
      calls.push({
        method: `${currentTable}.${mutation}.single`,
        args: { ...filters, insertPayload, updatePayload },
      });
      const data =
        mutation === "insert" && insertPayload
          ? {
              id: "inserted-id",
              lane: insertPayload.lane,
              content: insertPayload.content,
              metadata: insertPayload.metadata ?? null,
              created_at: "now",
              updated_at: "now",
            }
          : (selectedRows[0] ?? null);
      reset();
      return Promise.resolve({ data, error: null });
    },
    then(onFulfilled: (value: unknown) => unknown) {
      const selectedRows = filteredRows();
      calls.push({
        method: `${currentTable}.${mutation}`,
        args: {
          ...filters,
          insertPayload,
          updatePayload,
          ilikePattern,
          returnSelect,
        },
      });
      let data: unknown = selectedRows;
      if (mutation === "update" || mutation === "delete") {
        data = returnSelect ? affectedIds.map((id) => ({ id })) : null;
      }
      const result = { data, error: null };
      reset();
      return Promise.resolve(onFulfilled(result));
    },
  };

  builder.select = (_cols: string) => {
    if (mutation === "update" || mutation === "delete") returnSelect = true;
    return builder;
  };

  const fakeSupabase = {
    from(table: string) {
      currentTable = table;
      return builder;
    },
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ method: `rpc.${name}`, args });
      if (rpcError) return Promise.resolve({ data: null, error: rpcError });
      return Promise.resolve({ data: rows, error: null });
    },
  };

  return {
    supabase: fakeSupabase as unknown as SupabaseLike,
    calls,
    setAffectedIds(ids: string[]) {
      affectedIds = ids;
    },
    setRpcError(err: { message: string } | null) {
      rpcError = err;
    },
  };
}

export async function makeClient(
  opts: {
    embedder?: Embedder;
    rows?: Memory[];
  } = {}
): Promise<{
  mod: MemoriesModule;
  client: MemoriesClient;
  calls: Call[];
  setAffectedIds: (ids: string[]) => void;
  setRpcError: (err: { message: string } | null) => void;
}> {
  const mod = await loadMemoriesClient();
  const { supabase, calls, setAffectedIds, setRpcError } = makeFakeSupabase(
    opts.rows ?? []
  );
  const embedder: Embedder = opts.embedder ?? ((async () => null) as Embedder);
  const client = mod.createMemoriesClient("user-A", { supabase, embedder });
  return { mod, client, calls, setAffectedIds, setRpcError };
}
