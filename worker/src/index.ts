import { PresenceRoom } from "./room.js";

export { PresenceRoom };

interface Env {
  PRESENCE_ROOM: DurableObjectNamespace;
}

export default {
  fetch(request: Request, env: Env): Response | Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, service: "sync-and-flow-worker" }), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    if (url.pathname !== "/publish" && url.pathname !== "/watch") {
      return new Response("Not found", { status: 404 });
    }

    const id = env.PRESENCE_ROOM.idFromName("global");
    return env.PRESENCE_ROOM.get(id).fetch(request);
  },
};
