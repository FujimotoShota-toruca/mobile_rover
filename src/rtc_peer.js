export class RtcPeerSession {
  constructor({ logger, onRemoteStream = () => {}, onChannel = () => {}, iceServers = null } = {}) {
    this.logger = logger;
    this.onRemoteStream = onRemoteStream;
    this.onChannel = onChannel;
    this.iceServers = iceServers || [{ urls: "stun:stun.l.google.com:19302" }];
    this.pc = null;
    this.channels = new Map();
  }

  createBasePeer() {
    if (this.pc) return this.pc;

    this.pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        this.onRemoteStream(event.streams[0]);
      }
    };

    this.pc.onconnectionstatechange = () => {
      this.logger?.info(`RTC state: ${this.pc.connectionState}`);
    };

    this.pc.ondatachannel = (event) => {
      this._registerChannel(event.channel);
    };

    return this.pc;
  }

  async prepareVehicle(localStream) {
    const pc = this.createBasePeer();
    if (localStream) {
      localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
    }
    this._registerChannel(pc.createDataChannel("ctrl-fast", {
      ordered: false,
      maxRetransmits: 0
    }));
    this._registerChannel(pc.createDataChannel("telemetry"));
    this._registerChannel(pc.createDataChannel("rpc"));
    return pc;
  }

  async prepareController() {
    const pc = this.createBasePeer();
    pc.addTransceiver("video", { direction: "recvonly" });
    return pc;
  }

  _registerChannel(channel) {
    this.channels.set(channel.label, channel);
    channel.onopen = () => {
      this.logger?.info(`channel open: ${channel.label}`);
      this.onChannel(channel.label, "open", channel);
    };
    channel.onclose = () => {
      this.logger?.warn(`channel close: ${channel.label}`);
      this.onChannel(channel.label, "close", channel);
    };
    channel.onerror = (event) => {
      this.logger?.warn(`channel error: ${channel.label} ${event?.message || ""}`);
    };
    channel.onmessage = (event) => {
      this.onChannel(channel.label, "message", channel, event.data);
    };
  }

  channel(label) {
    return this.channels.get(label) || null;
  }

  sendJson(label, payload) {
    const channel = this.channel(label);
    if (!channel || channel.readyState !== "open") return false;
    channel.send(JSON.stringify(payload));
    return true;
  }

  close() {
    for (const channel of this.channels.values()) {
      try { channel.close(); } catch {}
    }
    this.channels.clear();
    if (this.pc) {
      try { this.pc.close(); } catch {}
      this.pc = null;
    }
  }
}
