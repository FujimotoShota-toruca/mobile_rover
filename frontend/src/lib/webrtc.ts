export async function waitForIceGatheringComplete(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return;

  await new Promise<void>((resolve) => {
    const handler = () => {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", handler);
        resolve();
      }
    };
    pc.addEventListener("icegatheringstatechange", handler);
  });
}

export async function createOfferBlob(pc: RTCPeerConnection): Promise<string> {
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitForIceGatheringComplete(pc);
  return JSON.stringify(pc.localDescription, null, 2);
}

export async function applyRemoteDescriptionBlob(
  pc: RTCPeerConnection,
  raw: string
): Promise<void> {
  const parsed = JSON.parse(raw) as RTCSessionDescriptionInit;
  await pc.setRemoteDescription(parsed);
}

export async function createAnswerBlob(pc: RTCPeerConnection): Promise<string> {
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitForIceGatheringComplete(pc);
  return JSON.stringify(pc.localDescription, null, 2);
}
