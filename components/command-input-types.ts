export type CommandInputAttachment = {
  type: "image" | "file";
  name: string;
  mediaType: string;
  url: string;
  data?: string;
};
