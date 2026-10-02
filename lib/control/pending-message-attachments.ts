/** Store attachment data outside sessionStorage's small synchronous quota. */
export type PendingAttachmentStore = {
  put: (key: string, url: string) => Promise<void>;
  get: (key: string) => Promise<string | null>;
  remove: (key: string) => Promise<void>;
};
let database: Promise<IDBDatabase> | undefined;
function openDatabase() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("mogplex-control-pending", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("attachments");
    };
    request.onsuccess = () => resolve(request.result);
    request.addEventListener("error", () => {
      database = undefined;
      reject(request.error);
    });
  });
  return database;
}
async function operate<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction("attachments", mode);
    const request = operation(transaction.objectStore("attachments"));
    transaction.oncomplete = () => resolve(request.result);
    transaction.addEventListener("abort", () =>
      reject(transaction.error ?? new Error("Could not save attachments"))
    );
    transaction.addEventListener("error", () =>
      reject(transaction.error ?? new Error("Could not save attachments"))
    );
  });
}
export const browserPendingAttachmentStore: PendingAttachmentStore = {
  put: async (key, url) => {
    await operate("readwrite", (store) => store.put(url, key));
  },
  get: async (key) =>
    (await operate("readonly", (store) => store.get(key))) ?? null,
  remove: async (key) => {
    await operate("readwrite", (store) => store.delete(key));
  },
};
