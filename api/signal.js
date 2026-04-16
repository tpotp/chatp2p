// api/signal.js — Servidor de señalización WebRTC para Vercel
// Usa @vercel/node con WebSocket nativo
// Solo hace de "cartero" para que los peers se encuentren.
// Una vez conectados por WebRTC, los mensajes van P2P (no pasan por aquí).

export const config = { runtime: 'edge' };

// Mapa en memoria de salas: roomId -> Set de ReadableStream controllers
const rooms = new Map();

export default async function handler(req) {
  const url = new URL(req.url);
  const room = url.searchParams.get('room') || 'default';
  const peerId = url.searchParams.get('peer') || crypto.randomUUID();

  // Server-Sent Events para señalización (funciona en Edge Runtime de Vercel)
  if (req.method === 'GET') {
    if (!rooms.has(room)) rooms.set(room, new Map());
    const roomPeers = rooms.get(room);

    let controller;
    const stream = new ReadableStream({
      start(c) {
        controller = c;
        roomPeers.set(peerId, controller);

        // Anunciar a todos los peers existentes que llegó uno nuevo
        const joinMsg = JSON.stringify({ type: 'peer-joined', peerId });
        for (const [id, ctrl] of roomPeers) {
          if (id !== peerId) {
            try { ctrl.enqueue(`data: ${joinMsg}\n\n`); } catch {}
          }
        }

        // Enviar al nuevo la lista de peers actuales
        const peers = [...roomPeers.keys()].filter(id => id !== peerId);
        controller.enqueue(`data: ${JSON.stringify({ type: 'welcome', peerId, peers })}\n\n`);
      },
      cancel() {
        roomPeers.delete(peerId);
        if (roomPeers.size === 0) rooms.delete(room);
        // Notificar salida
        const leaveMsg = JSON.stringify({ type: 'peer-left', peerId });
        for (const [, ctrl] of roomPeers) {
          try { ctrl.enqueue(`data: ${leaveMsg}\n\n`); } catch {}
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'X-Peer-Id': peerId,
      }
    });
  }

  // POST: relay de mensajes SDP/ICE entre peers
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
        return new Response(JSON.stringify({ ok: false, error: 'peer disconnected' }), {
          status: 410,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
    }

    return new Response(JSON.stringify({ ok: false, error: 'peer not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  // OPTIONS (CORS preflight)
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  }

  return new Response('Method not allowed', { status: 405 });
}
