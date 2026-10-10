import { addIntegration, replayIntegration } from "@sentry/nextjs";

export function startReplay() {
  addIntegration(replayIntegration());
}
