export const config = { runtime: 'edge' };

const rooms = new Map();

export default async function handler(req) {
  const url = new URL(req.url);
  const room = url.searchParams.get('room') || 'default';
  const peerId = url.searchParams.get('peer') || crypto.randomUUID();

  if (req.method === 'GET') {
    if (!rooms.has(room)) rooms.set(room, new Map());
    const roomPeers = rooms.get(room);

    const stream = new ReadableStream({
      start(controller) {
        roomPeers.set(peerId, controller);

        // LATIDO INMEDIATO: Esto evita el 404/504 en Vercel Edge
        controller.enqueue(': heartbeat\n\n');

        // Latido constante cada 15s para que la conexión no muera
        const keepAlive = setInterval(() => {
          try {
            controller.enqueue(': keep-alive\n\n');
          } catch {
            clearInterval(keepAlive);
          }
        }, 15000);

        // Notificar a otros
        const joinMsg = JSON.stringify({ type: 'peer-joined', peerId });
        for (const [id, ctrl] of roomPeers) {
          if (id !== peerId) {
            try { ctrl.enqueue(`data: ${joinMsg}\n\n`); } catch {}
          }
        }

        // Bienvenida al nuevo
        const peers = [...roomPeers.keys()].filter(id => id !== peerId);
        controller.enqueue(`data: ${JSON.stringify({ type: 'welcome', peerId, peers })}\n\n`);
      },
      cancel() {
        roomPeers.delete(peerId);
        const leaveMsg = JSON.stringify({ type: 'peer-left', peerId });
        for (const [, ctrl] of roomPeers) {
          try { ctrl.enqueue(`data: ${leaveMsg}\n\n`); } catch {}
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  if (req.method === 'POST') {
    const body = await req.json();
    const { to, ...msg } = body;
    const roomPeers = rooms.get(room);

    if (roomPeers && to && roomPeers.has(to)) {
      try {
        roomPeers.get(to).enqueue(`data: ${JSON.stringify({ ...msg, from: peerId })}\n\n`);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      } catch {
        return new Response(JSON.stringify({ ok: false }), { status: 410 });
      }
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  }

  return new Response('Method not allowed', { status: 405 });
}