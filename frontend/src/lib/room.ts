import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  type CollectionReference,
  type DocumentReference,
  type Firestore,
} from "firebase/firestore";

export type CandidateRole = "callerCandidates" | "calleeCandidates";

export type RoomRecord = {
  roomName: string;
  passwordHash: string;
  createdAt: number;
  updatedAt: number;
  offer?: RTCSessionDescriptionInit | null;
  answer?: RTCSessionDescriptionInit | null;
  hostState?: string;
  mobileState?: string;
};

export function sanitizeRoomId(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (!value) throw new Error("room name is required");
  return value.replace(/[^a-z0-9-_]/g, "-");
}

export async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function getRoomRef(db: Firestore, roomName: string): DocumentReference {
  return doc(db, "rooms", sanitizeRoomId(roomName));
}

export function getCandidateCollection(
  db: Firestore,
  roomName: string,
  role: CandidateRole
): CollectionReference {
  return collection(getRoomRef(db, roomName), role);
}

export async function clearCollectionDocuments(col: CollectionReference): Promise<void> {
  const snapshot = await getDocs(col);
  await Promise.all(snapshot.docs.map((entry) => deleteDoc(entry.ref)));
}

export async function cleanupRoomArtifacts(db: Firestore, roomName: string): Promise<void> {
  const roomRef = getRoomRef(db, roomName);
  await clearCollectionDocuments(getCandidateCollection(db, roomName, "callerCandidates"));
  await clearCollectionDocuments(getCandidateCollection(db, roomName, "calleeCandidates"));
  const snap = await getDoc(roomRef);
  if (snap.exists()) {
    await deleteDoc(roomRef);
  }
}

export async function createOrResetRoom(
  db: Firestore,
  roomName: string,
  passwordHash: string,
  offer: RTCSessionDescriptionInit
): Promise<void> {
  await cleanupRoomArtifacts(db, roomName);
  await setDoc(getRoomRef(db, roomName), {
    roomName,
    passwordHash,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    hostState: "waiting",
    mobileState: "idle",
    offer,
    answer: null,
  } satisfies RoomRecord);
}

export async function markRoomState(
  db: Firestore,
  roomName: string,
  patch: Partial<RoomRecord>
): Promise<void> {
  await updateDoc(getRoomRef(db, roomName), {
    ...patch,
    updatedAt: Date.now(),
  });
}

export async function appendIceCandidate(
  db: Firestore,
  roomName: string,
  role: CandidateRole,
  candidate: RTCIceCandidate
): Promise<void> {
  await addDoc(getCandidateCollection(db, roomName, role), candidate.toJSON());
}
