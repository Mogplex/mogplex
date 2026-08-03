// Catalog introspection for the PostgREST shim, cached per shim instance:
// column types (for jsonb serialization on writes), primary keys (upsert
// without onConflict), and FK relationships (embed cardinality + join cols).
import { quoteIdent, type Queryable } from "./sql";

export type Relationship = {
  kind: "many-to-one" | "one-to-many";
  parentCols: string[];
  childCols: string[];
};

// Drivers differ on which Postgres array types they decode: node-pg leaves
// name[] (and any uncovered oid) as its "{a,b}" text form while PGlite
// returns a real array, so normalize both shapes.
function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (
    typeof value === "string" &&
    value.startsWith("{") &&
    value.endsWith("}")
  ) {
    const inner = value.slice(1, -1);
    if (inner === "") return [];
    return inner
      .split(",")
      .map((part) => part.replace(/^"|"$/g, "").replaceAll('\\"', '"'));
  }
  throw new Error(
    `postgrest-shim: expected a column-name array, got ${JSON.stringify(value)}`
  );
}

export class SchemaCache {
  private columnTypes = new Map<string, Map<string, string>>();
  private relationships = new Map<string, Relationship>();
  private primaryKeys = new Map<string, string[]>();

  constructor(private readonly db: Queryable) {}

  async getColumnTypes(table: string): Promise<Map<string, string>> {
    const cached = this.columnTypes.get(table);
    if (cached) return cached;
    const { rows } = await this.db.query(
      `select column_name, udt_name from information_schema.columns
       where table_schema = 'public' and table_name = $1`,
      [table]
    );
    if (rows.length === 0) {
      throw new Error(`postgrest-shim: unknown table ${JSON.stringify(table)}`);
    }
    const types = new Map<string, string>(
      rows.map((row) => [String(row.column_name), String(row.udt_name)])
    );
    this.columnTypes.set(table, types);
    return types;
  }

  async getPrimaryKey(table: string): Promise<string[]> {
    const cached = this.primaryKeys.get(table);
    if (cached) return cached;
    const { rows } = await this.db.query(
      `select a.attname as name
       from pg_index i
       join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
       where i.indrelid = ($1::text)::regclass and i.indisprimary
       order by array_position(i.indkey, a.attnum)`,
      [`public.${quoteIdent(table)}`]
    );
    const pk = rows.map((row) => String(row.name));
    this.primaryKeys.set(table, pk);
    return pk;
  }

  // Resolves how `child` embeds under `parent`, PostgREST-style: a FK from
  // child → parent means one-to-many (JSON array); parent → child means
  // many-to-one (JSON object). Cols are normalized so the join is always
  // child.childCols[i] = parent.parentCols[i]. When more than one FK links
  // the tables (e.g. the flows↔flow_versions cycle), `fkHint` — the
  // constraint name from a `table!my_fkey(...)` embed — selects which one.
  async getRelationship(
    parent: string,
    child: string,
    fkHint: string | null = null
  ): Promise<Relationship> {
    const key = `${parent}→${child}#${fkHint ?? ""}`;
    const cached = this.relationships.get(key);
    if (cached) return cached;
    const { rows } = await this.db.query(
      `select
         c.conname::text as constraint_name,
         conrelid::regclass::text as from_table,
         (select array_agg(a.attname::text order by k.ord)
            from unnest(c.conkey) with ordinality as k(attnum, ord)
            join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
         )::text[] as from_cols,
         (select array_agg(a.attname::text order by k.ord)
            from unnest(c.confkey) with ordinality as k(attnum, ord)
            join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum
         )::text[] as to_cols
       from pg_constraint c
       where c.contype = 'f'
         and (
           (c.conrelid = ($1::text)::regclass and c.confrelid = ($2::text)::regclass)
           or
           (c.conrelid = ($2::text)::regclass and c.confrelid = ($1::text)::regclass)
         )`,
      [`public.${quoteIdent(parent)}`, `public.${quoteIdent(child)}`]
    );
    if (rows.length === 0) {
      throw new Error(
        `postgrest-shim: no foreign key between ${parent} and ${child}`
      );
    }
    const row = fkHint
      ? rows.find((candidate) => String(candidate.constraint_name) === fkHint)
      : rows[0];
    if (!row) {
      throw new Error(
        `postgrest-shim: no foreign key named ${JSON.stringify(fkHint)} between ${parent} and ${child}`
      );
    }
    const constraintTable = String(row.from_table)
      .replace(/^public\./, "")
      .replaceAll('"', "");
    const fromCols = toStringArray(row.from_cols);
    const toCols = toStringArray(row.to_cols);
    const relationship: Relationship =
      constraintTable === child
        ? // FK lives on the child → each parent row can own many child rows.
          { kind: "one-to-many", parentCols: toCols, childCols: fromCols }
        : { kind: "many-to-one", parentCols: fromCols, childCols: toCols };
    this.relationships.set(key, relationship);
    return relationship;
  }
}
