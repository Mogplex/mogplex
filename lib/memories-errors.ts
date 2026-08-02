/* eslint-disable max-classes-per-file -- co-located related error types */

export class MemoryNotFoundError extends Error {
  constructor(id?: string) {
    super(id ? `Memory not found: ${id}` : "Memory not found");
    this.name = "MemoryNotFoundError";
  }
}

export class InvalidMetadataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMetadataError";
  }
}
