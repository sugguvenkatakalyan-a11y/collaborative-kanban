import { io } from 'socket.io-client';

let socket = null;

/** One authenticated socket per logged-in session. */
export function connectSocket(token) {
  disconnectSocket();
  const url = import.meta.env.VITE_API_URL || undefined; // undefined → same origin (Vite proxy)
  socket = io(url, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
  });
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}

export const getSocket = () => socket;
export const getSocketId = () => socket?.id;
