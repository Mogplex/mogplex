export async function loadObservabilityCallsRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../../app/api/observability/calls/route");
}

export class FakeQuery {
  readonly eqCalls: unknown[][] = [];
  readonly filterCalls: unknown[][] = [];
  readonly isCalls: unknown[][] = [];
  readonly notCalls: unknown[][] = [];
  readonly orCalls: unknown[][] = [];

  constructor(
    private readonly result: {
      data: Record<string, unknown>[] | null;
      count?: number | null;
      error: { message: string } | null;
    }
  ) {}

  eq(...args: unknown[]) {
    this.eqCalls.push(args);
    return this;
  }
  order() {
    return this;
  }
  range() {
    return this;
  }
  in() {
    return this;
  }
  is(...args: unknown[]) {
    this.isCalls.push(args);
    return this;
  }
  not(...args: unknown[]) {
    this.notCalls.push(args);
    return this;
  }
  or(...args: unknown[]) {
    this.orCalls.push(args);
    return this;
  }
  filter(...args: unknown[]) {
    this.filterCalls.push(args);
    return this;
  }
  gte() {
    return this;
  }
  lte() {
    return this;
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?:
      | ((
          value:
            | {
                data: Record<string, unknown>[] | null;
                count?: number | null;
                error: { message: string } | null;
              }
            | TResult2
        ) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return Promise.resolve(this.result).catch(onrejected).then(onfulfilled);
  }
}
