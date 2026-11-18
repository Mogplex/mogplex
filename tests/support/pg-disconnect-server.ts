import { createServer, type Socket } from "node:net";
import { once } from "node:events";

function message(type: string, payload: Buffer) {
  const header = Buffer.alloc(5);
  header.write(type);
  header.writeInt32BE(payload.length + 4, 1);
  return Buffer.concat([header, payload]);
}

// A network boundary fixture: use the real pg client/pool against enough of
// the Postgres wire protocol to connect, complete a query, and lose a socket.
export async function startDisconnectServer() {
  const sockets = new Set<Socket>();
  let connections = 0;
  const server = createServer((socket) => {
    connections++;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let buffer = Buffer.alloc(0);
    let started = false;
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= (started ? 5 : 4)) {
        const offset = started ? 1 : 0;
        const length = buffer.readInt32BE(offset) + offset;
        if (buffer.length < length) return;
        const frame = buffer.subarray(0, length);
        buffer = buffer.subarray(length);
        if (!started) {
          started = true;
          socket.write(message("R", Buffer.alloc(4)));
          socket.write(message("Z", Buffer.from("I")));
        } else if (frame[0] === 81) {
          if (frame.includes(Buffer.from("disconnect"))) {
            socket.destroy();
          } else {
            socket.write(message("C", Buffer.from("SELECT 0\0")));
            socket.write(message("Z", Buffer.from("I")));
          }
        } else if (frame[0] === 88) {
          socket.end();
        }
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  return {
    url: `postgres://owner@127.0.0.1:${address.port}/test?sslmode=disable`,
    get connections() {
      return connections;
    },
    disconnect() {
      for (const socket of sockets) socket.destroy();
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      const closed = once(server, "close");
      server.close();
      await closed;
    },
  };
}
