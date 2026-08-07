import { useMemo } from "react";
import useSWRInfinite from "swr/infinite";
import type { SlackChannel, SlackChannelsPage } from "./types";

export interface FlowSlackChannelsParams {
  selectedSlackTeamId: string;
  fetcher: (url: string) => Promise<SlackChannelsPage>;
}

export interface FlowSlackChannelsResult {
  slackChannels: SlackChannel[];
  slackChannelsLoading: boolean;
  slackChannelsHaveMore: boolean;
  slackChannelsLoadingMore: boolean;
  slackChannelPageCount: number;
  setSlackChannelPageCount: (size: number) => void;
}

export function useFlowSlackChannels({
  selectedSlackTeamId,
  fetcher,
}: FlowSlackChannelsParams): FlowSlackChannelsResult {
  const {
    data: slackChannelPages,
    isLoading: slackChannelsLoading,
    isValidating: slackChannelsValidating,
    size: slackChannelPageCount,
    setSize: setSlackChannelPageCount,
  } = useSWRInfinite<SlackChannelsPage>((_pageIndex, previousPage) => {
    if (!selectedSlackTeamId || (previousPage && !previousPage.nextCursor)) {
      return null;
    }
    const base = `/api/integrations/slack/installations/${encodeURIComponent(selectedSlackTeamId)}/channels`;
    return previousPage?.nextCursor
      ? `${base}?cursor=${encodeURIComponent(previousPage.nextCursor)}`
      : base;
  }, fetcher);

  const slackChannels = useMemo(() => {
    const channelsById = new Map<string, SlackChannel>();
    for (const page of slackChannelPages ?? []) {
      for (const channel of page.channels) {
        channelsById.set(channel.id, channel);
      }
    }
    return [...channelsById.values()];
  }, [slackChannelPages]);

  const slackChannelsHaveMore = Boolean(slackChannelPages?.at(-1)?.nextCursor);

  const slackChannelsLoadingMore =
    slackChannelsValidating && Boolean(slackChannelPages?.length);

  return {
    slackChannels,
    slackChannelsLoading,
    slackChannelsHaveMore,
    slackChannelsLoadingMore,
    slackChannelPageCount,
    setSlackChannelPageCount: (size: number) => {
      void setSlackChannelPageCount(size);
    },
  };
}
