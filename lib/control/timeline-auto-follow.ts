type TimelineResizeObserver = Pick<ResizeObserver, "disconnect" | "observe">;
type TimelineIntersectionObserver = Pick<
  IntersectionObserver,
  "disconnect" | "observe"
>;

type CreateTimelineResizeObserver = (
  callback: ResizeObserverCallback
) => TimelineResizeObserver;

type CreateTimelineIntersectionObserver = (
  callback: IntersectionObserverCallback,
  options: IntersectionObserverInit
) => TimelineIntersectionObserver;

/** Follow timeline growth until the reader scrolls away from the bottom. */
export function setupTimelineAutoFollow(
  scroll: HTMLElement,
  content: HTMLElement,
  bottom: HTMLElement,
  createResizeObserver: CreateTimelineResizeObserver = (callback) =>
    new ResizeObserver(callback),
  createIntersectionObserver: CreateTimelineIntersectionObserver = (
    callback,
    options
  ) => new IntersectionObserver(callback, options)
) {
  let following = true;
  const followContent = () => {
    if (following) scroll.scrollTop = scroll.scrollHeight;
  };

  const bottomObserver = createIntersectionObserver(
    ([entry]) => {
      following = entry?.isIntersecting ?? false;
    },
    { root: scroll, rootMargin: "0px 0px 48px 0px", threshold: 0 }
  );
  const resizeObserver = createResizeObserver(followContent);
  bottomObserver.observe(bottom);
  resizeObserver.observe(content);
  followContent();

  return () => {
    bottomObserver.disconnect();
    resizeObserver.disconnect();
  };
}
