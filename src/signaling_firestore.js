import { initializeApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  deleteDoc,
  collection,
  addDoc,
  getDocs
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase_config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export class FirestoreSignaling {
  constructor({ logger }) {
    this.logger = logger;
    this.unsubRoom = null;
    this.unsubCandidates = null;
    this.role = null;
    this.roomId = null;
  }

  async cleanupRoom(roomId) {
    const roomRef = doc(db, "rooms", roomId);
    const callerCandidates = collection(roomRef, "callerCandidates");
    const calleeCandidates = collection(roomRef, "calleeCandidates");

    const callerSnap = await getDocs(callerCandidates);
    for (const d of callerSnap.docs) await deleteDoc(d.ref);

    const calleeSnap = await getDocs(calleeCandidates);
    for (const d of calleeSnap.docs) await deleteDoc(d.ref);

    const roomSnap = await getDoc(roomRef);
    if (roomSnap.exists()) {
      await deleteDoc(roomRef);
    }
  }

  async startAsVehicle(pc, roomId) {
    this.role = "vehicle";
    this.roomId = roomId;
    const roomRef = doc(db, "rooms", roomId);

    await this.cleanupRoom(roomId).catch((error) => {
      this.logger?.warn(`room cleanup warn: ${error.message}`);
    });

    const localCandidatesCollection = collection(roomRef, "callerCandidates");
    const remoteCandidatesCollection = collection(roomRef, "calleeCandidates");

    pc.onicecandidate = async (event) => {
      if (event.candidate) {
        await addDoc(localCandidatesCollection, event.candidate.toJSON());
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    await setDoc(roomRef, {
      offer: { type: offer.type, sdp: offer.sdp },
      createdAt: Date.now(),
      version: 2,
      role: "vehicle"
    });

    this.unsubRoom = onSnapshot(roomRef, async (snapshot) => {
      const data = snapshot.data();
      if (!data) return;
      if (!pc.currentRemoteDescription && data.answer) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        this.logger?.info("answer received");
      }
    });

    this.unsubCandidates = onSnapshot(remoteCandidatesCollection, (snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type === "added") {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
          } catch (error) {
            this.logger?.warn(`callee ICE add failed: ${error.message}`);
          }
        }
      });
    });
  }

  async startAsController(pc, roomId) {
    this.role = "controller";
    this.roomId = roomId;
    const roomRef = doc(db, "rooms", roomId);
    const roomSnapshot = await getDoc(roomRef);
    if (!roomSnapshot.exists()) {
      throw new Error("vehicle 側 room がまだ作成されていません");
    }

    const localCandidatesCollection = collection(roomRef, "calleeCandidates");
    const remoteCandidatesCollection = collection(roomRef, "callerCandidates");

    pc.onicecandidate = async (event) => {
      if (event.candidate) {
        await addDoc(localCandidatesCollection, event.candidate.toJSON());
      }
    };

    const roomData = roomSnapshot.data();
    await pc.setRemoteDescription(new RTCSessionDescription(roomData.offer));

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await updateDoc(roomRef, {
      answer: { type: answer.type, sdp: answer.sdp },
      controllerJoinedAt: Date.now()
    });

    this.unsubCandidates = onSnapshot(remoteCandidatesCollection, (snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type === "added") {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
          } catch (error) {
            this.logger?.warn(`caller ICE add failed: ${error.message}`);
          }
        }
      });
    });
  }

  async stop() {
    if (this.unsubRoom) {
      this.unsubRoom();
      this.unsubRoom = null;
    }
    if (this.unsubCandidates) {
      this.unsubCandidates();
      this.unsubCandidates = null;
    }
    if (this.role === "vehicle" && this.roomId) {
      await this.cleanupRoom(this.roomId).catch(() => {});
    }
    this.role = null;
    this.roomId = null;
  }
}
