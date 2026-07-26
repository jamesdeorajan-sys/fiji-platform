export interface Env {
  DB: unknown;
}

const jsonError = (status: number, code: string, message: string): Response =>
  Response.json({ error: { code, message } }, { status });

export default {
  fetch(request: Request): Response {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ status: "ok", service: "fiji-platform-v2-api" });
    }
    return jsonError(404, "NOT_FOUND", "Route not found");
  },
};
