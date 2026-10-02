import type { Env } from "./types.js";

/**
 * One baseline-MCP SSE stream, held in a Durable Object.
 *
 * `GET /sse` and the later `POST /message` are separate requests, and a
 * Worker may serve them from different isolates, so the open stream cannot
 * live in a module-level Map: a message that landed elsewhere found no stream.
 * Both requests address the same object by session id instead, and the object
 * is where the writer lives.
 *
 * The Worker does the authentication and runs the JSON-RPC call; this object
 * only owns the stream and delivers what it is handed.
 */
export class SseSession {
  private writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
  private userId: string | undefined;

  // The platform constructs this with (state, env); neither is needed.
  constructor(_state?: DurableObjectState, _env?: Env) {}

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    const body = (await request.json()) as { userId: string; endpoint?: string; payload?: unknown };

    if (path === "/connect") {
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
      const writer = writable.getWriter();
      this.writer = writer;
      this.userId = body.userId;
      // The client going away closes the stream; forget it so a late message
      // is refused instead of written to nothing.
      writer.closed.catch(() => undefined).finally(() => {
        if (this.writer === writer) this.writer = undefined;
      });
      void writer.write(new TextEncoder().encode(`event: endpoint\ndata: ${body.endpoint}\n\n`)).catch(() => undefined);
      return new Response(readable, {
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
      });
    }

    if (path === "/send") {
      // The user check is the isolation between tenants: a session id alone
      // must not let someone else write into this stream.
      if (!this.writer || this.userId !== body.userId) return new Response("Session not found", { status: 404 });
      // Not awaited: a write completes when the client reads it, and one slow
      // reader must not hold up the POST that delivered the message.
      const writer = this.writer;
      writer.write(new TextEncoder().encode(`event: message\ndata: ${JSON.stringify(body.payload)}\n\n`)).catch(() => {
        if (this.writer === writer) this.writer = undefined;
      });
      return new Response(null, { status: 202 });
    }

    return new Response("Not Found", { status: 404 });
  }
}
