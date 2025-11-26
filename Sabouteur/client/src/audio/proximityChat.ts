import type { PlayerStateSnapshot } from '../net/types';
import { emitRtcAnswer, emitRtcCandidate, emitRtcOffer, socket } from '../net/client';
import { useGameStore } from '../state/store';

interface PeerContext {
  pc: RTCPeerConnection;
  gainNode: GainNode;
  stream?: MediaStream;
}

const STUN_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

export interface ProximityChat {
  enabled: boolean;
  connectTo: (playerId: string) => void;
  disconnectFrom: (playerId: string) => void;
  updateVolumes: (players: Record<string, PlayerStateSnapshot>) => void;
}

export const createProximityChat = async (): Promise<ProximityChat> => {
  const audioContext = new AudioContext();
  let localStream: MediaStream | undefined;
  const peers = new Map<string, PeerContext>();

  const resumeContext = () => {
    if (audioContext.state === 'suspended') {
      audioContext.resume().catch(() => undefined);
    }
  };
  document.addEventListener('pointerdown', resumeContext, { once: true });

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    console.warn('Microphone permissions denied – proximity chat disabled.', error);
    return {
      enabled: false,
      connectTo: () => undefined,
      disconnectFrom: () => undefined,
      updateVolumes: () => undefined,
    };
  }

  const initPeer = (remoteId: string): PeerContext => {
    let context = peers.get(remoteId);
    if (context) return context;

    const pc = new RTCPeerConnection(STUN_CONFIG);
    localStream?.getTracks().forEach((track) => pc.addTrack(track, localStream!));

    const gainNode = audioContext.createGain();
    gainNode.gain.value = 0;
    gainNode.connect(audioContext.destination);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        emitRtcCandidate(remoteId, event.candidate.toJSON ? event.candidate.toJSON() : event.candidate);
      }
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0];
      context = peers.get(remoteId);
      if (!context) return;
      context.stream = stream;
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(context.gainNode);
    };

    context = { pc, gainNode };
    peers.set(remoteId, context);
    return context;
  };

  const createOffer = async (remoteId: string) => {
    const ctx = initPeer(remoteId);
    const offer = await ctx.pc.createOffer();
    await ctx.pc.setLocalDescription(offer);
    emitRtcOffer(remoteId, offer);
  };

  socket.on('rtcOffer', async ({ from, description }) => {
    const ctx = initPeer(from);
    await ctx.pc.setRemoteDescription(description);
    const answer = await ctx.pc.createAnswer();
    await ctx.pc.setLocalDescription(answer);
    emitRtcAnswer(from, answer);
  });

  socket.on('rtcAnswer', async ({ from, description }) => {
    const ctx = initPeer(from);
    await ctx.pc.setRemoteDescription(description);
  });

  socket.on('rtcCandidate', async ({ from, candidate }) => {
    const ctx = initPeer(from);
    try {
      await ctx.pc.addIceCandidate(candidate);
    } catch (error) {
      console.warn('Failed to add ICE candidate', error);
    }
  });

  const connectTo = (playerId: string) => {
    if (playerId === useGameStore.getState().playerId) return;
    if (peers.has(playerId)) return;
    createOffer(playerId).catch(console.error);
  };

  const disconnectFrom = (playerId: string) => {
    const ctx = peers.get(playerId);
    if (!ctx) return;
    ctx.pc.close();
    ctx.gainNode.disconnect();
    peers.delete(playerId);
  };

  const updateVolumes = (players: Record<string, PlayerStateSnapshot>) => {
    const store = useGameStore.getState();
    const localPlayer = store.playerId ? players[store.playerId] : undefined;
    if (!localPlayer) return;
    peers.forEach((ctx, playerId) => {
      const remotePlayer = players[playerId];
      if (!remotePlayer || !remotePlayer.position) {
        ctx.gainNode.gain.value = 0;
        return;
      }
      const dx = remotePlayer.position.x - localPlayer.position.x;
      const dy = remotePlayer.position.y - localPlayer.position.y;
      const dz = remotePlayer.position.z - localPlayer.position.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const volume = Math.max(0, 1 - distance / 25);
      ctx.gainNode.gain.value = volume ** 2;
    });
  };

  return {
    enabled: true,
    connectTo,
    disconnectFrom,
    updateVolumes,
  };
};
