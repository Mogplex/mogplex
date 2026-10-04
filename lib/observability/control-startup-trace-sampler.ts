type SamplingContext = {
  name: string;
  inheritOrSampleWith: (fallbackRate: number) => number;
};

// Sentry's Node HTTP instrumentation names the root span using the method
// and path without query parameters. Keep this first trace for cold-start DB
// attribution; later requests retain the SDK's normal inherited sampling.
export function createControlStartupTraceSampler(fallbackRate: number) {
  let retainedFirstControl = false;

  return (context: SamplingContext): number => {
    if (
      fallbackRate > 0 &&
      fallbackRate <= 1 &&
      !retainedFirstControl &&
      context.name === "GET /api/control/sessions"
    ) {
      retainedFirstControl = true;
      return 1;
    }

    return context.inheritOrSampleWith(fallbackRate);
  };
}
