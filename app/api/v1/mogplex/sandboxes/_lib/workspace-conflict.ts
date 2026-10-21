export class SavedWorkspaceUnavailableError extends Error {
  constructor() {
    super("Saved workspace is unavailable. Contact support for recovery.");
    this.name = "SavedWorkspaceUnavailableError";
  }
}
