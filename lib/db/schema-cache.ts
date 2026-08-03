// Catalog introspection for the PostgREST shim, cached per shim instance:
// column types (for jsonb serialization on writes), primary keys (upsert
// without onConflict), and FK relationships (embed cardinality + join cols).
import { quoteIdent, type Queryable } from "./sql";

export type Relationship = {
  kind: "many-to-one" | "one-to-many";
  parentCols: string[];
  childCols: string[];
};

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
  // child.childCols[i] = parent.parentCols[i].
  async getRelationship(parent: string, child: string): Promise<Relationship> {
    const key = `${parent}→${child}`;
    const cached = this.relationships.get(key);
    if (cached) return cached;
    const { rows } = await this.db.query(
      `select
         conrelid::regclass::text as from_table,
         (select array_agg(a.attname order by k.ord)
            from unnest(c.conkey) with ordinality as k(attnum, ord)
            join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
         ) as from_cols,
         (select array_agg(a.attname order by k.ord)
            from unnest(c.confkey) with ordinality as k(attnum, ord)
            join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum
         ) as to_cols
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
    const constraintTable = String(rows[0].from_table)
      .replace(/^public\./, "")
      .replaceAll('"', "");
    const fromCols = rows[0].from_cols as string[];
    const toCols = rows[0].to_cols as string[];
    const relationship: Relationship =
      constraintTable === child
        ? // FK lives on the child → each parent row can own many child rows.
          { kind: "one-to-many", parentCols: toCols, childCols: fromCols }
        : { kind: "many-to-one", parentCols: fromCols, childCols: toCols };
    this.relationships.set(key, relationship);
    return relationship;
  }
}
