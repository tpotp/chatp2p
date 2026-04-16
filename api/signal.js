// api/signal.js — Servidor de señalización WebRTC para Vercel Edge
export const config = { runtime: 'edge' };

const rooms = new Map();

export default async function handler(req) {
  const url = new URL(req.url);
  const room = url.searchParams.get('room') || 'default';
  const peerId = url.searchParams.get('peer') || crypto.randomUUID();

  // GET: Establece la conexión de escucha (SSE)
  if (req.method === 'GET') {
    if (!rooms.has(room)) rooms.set(room, new Map());
    const roomPeers = rooms.get(room);

    let controller;
    const stream = new ReadableStream({
      start(c) {
        controller = c;
        roomPeers.set(peerId, controller);

        // 1. OBLIGATORIO: Enviar comentario inicial para abrir el stream en Vercel
        controller.enqueue(': ok\n\n');

        // 2. SISTEMA LATIDO (Keep-Alive): Evita que Vercel corte la conexión
        const interval = setInterval(() => {
          try {
            controller.enqueue(': keep-alive\n\n');
          } catch (err) {
            clearInterval(interval);
          }
        }, 15000); // Cada 15 segundos

        // Anunciar a los demás
        const joinMsg = JSON.stringify({ type: 'peer-joined', peerId });
        for (const [id, ctrl] of roomPeers) {
          if (id !== peerId) {
            try { ctrl.enqueue(`data: ${joinMsg}\n\n`); } catch {}
          }
        }

        // Lista de peers actuales para el nuevo
        const peers = [...roomPeers.keys()].filter(id => id !== peerId);
        controller.enqueue(`data: ${JSON.stringify({ type: 'welcome', peerId, peers })}\n\n`);
      },
      cancel() {
        roomPeers.delete(peerId);
        if (roomPeers.size === 0) rooms.delete(room);
        const leaveMsg = JSON.stringify({ type: 'peer-left', peerId });
        for (const [, ctrl] of roomPeers) {
          try { ctrl.enqueue(`data: ${leaveMsg}\n\n`); } catch {}
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform', // "no-transform" evita que Vercel comprima el stream
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // Crítico: Desactiva el buffering de Nginx
        'Access-Control-Allow-Origin': '*',
      }
    });
  }

  // POST: Relay de mensajes entre usuarios
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
      } catch (e) {
        return new Response(JSON.stringify({ ok: false }), { status: 410 });
      }
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  }

  return new Response('Not Allowed', { status: 405 });
}