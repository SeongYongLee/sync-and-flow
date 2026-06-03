import { PresenceRoom } from "./room.js";

export { PresenceRoom };

interface Env {
  PRESENCE_ROOM: DurableObjectNamespace;
  SYNC_FLOW_PUBLISH_TOKEN?: string;
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

    if (url.pathname === "/publish" && !isAuthorizedPublish(request, env.SYNC_FLOW_PUBLISH_TOKEN)) {
      return new Response("Unauthorized", { status: 401 });
    }

    const id = env.PRESENCE_ROOM.idFromName("global");
    return env.PRESENCE_ROOM.get(id).fetch(request);
  },
};

export function isAuthorizedPublish(request: Request, token: string | undefined): boolean {
  if (!token) return true;

  const url = new URL(request.url);
  if (url.searchParams.get("token") === token) return true;

  const authorization = request.headers.get("Authorization") ?? "";
  return authorization === `Bearer ${token}`;
}
