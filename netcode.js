// Shared online-multiplayer infrastructure: public matchmaking queue + live
// match rooms, both backed by Firestore. There's no game server (GitHub Pages
// is static hosting), so matching and turn/state validation happen client-side
// via Firestore transactions and security rules -- fine for a hobby project,
// not meant to resist a determined cheater.
//
// Data model:
//   queue/{ticketId}   -- {uid, username, category, createdAtMs, status, roomId}
//   rooms/{roomId}     -- {category, players:{p1,p2}, status, createdAt,
//                          p1LastSeen, p2LastSeen, state:{...per-game}}

// ─── CLOCK SYNC ─────────────────────────────────────────────────
// Firestore listeners land at different times on each player's device, which
// would make a shared "GO!" signal unfair. Instead every client independently
// estimates its offset from server time, then converts a shared server-epoch
// target moment into its own local wall clock -- so both players' local
// setTimeout fires at (as close as network jitter allows) the same instant.
let cachedOffsetMs = 0;
let offsetSynced = false;

function syncClock() {
    if (offsetSynced) return Promise.resolve(cachedOffsetMs);
    const ref = db.collection('_clockPing').doc();
    const t0 = Date.now();
    return ref.set({ ts: firebase.firestore.FieldValue.serverTimestamp() })
        .then(() => {
            const t1 = Date.now();
            const estimatedAckLocalTime = t0 + (t1 - t0) / 2;
            return ref.get().then(snap => {
                const serverMs = snap.data().ts.toMillis();
                cachedOffsetMs = serverMs - estimatedAckLocalTime;
                offsetSynced = true;
                ref.delete().catch(() => {});
            });
        })
        .then(() => cachedOffsetMs)
        .catch(() => { offsetSynced = true; return cachedOffsetMs; });
}

function netNow() {
    return Date.now() + cachedOffsetMs;
}

// ─── MATCHMAKING QUEUE ──────────────────────────────────────────
// joinQueue tries to pair the caller with the longest-waiting other player in
// the same category. Whichever client notices a valid opponent first claims
// it via a transaction (so two clients racing for the same opponent can't
// both succeed); the loser of that race just keeps listening.
function joinQueue(category, handlers) {
    const user = auth.currentUser;
    if (!user) { handlers.onError && handlers.onError(new Error('not-signed-in')); return { cancel() {} }; }

    let cancelled = false;
    let claiming = false;
    let myTicketRef = null;
    let unsubQueue = null;
    let unsubMine = null;

    function cleanup() {
        if (unsubQueue) { unsubQueue(); unsubQueue = null; }
        if (unsubMine) { unsubMine(); unsubMine = null; }
    }

    function tryClaim(candidateSnap) {
        claiming = true;
        const roomRef = db.collection('rooms').doc();
        db.runTransaction(tx => {
            return Promise.all([tx.get(candidateSnap.ref), tx.get(myTicketRef)]).then(([candSnap, mineSnap]) => {
                if (!candSnap.exists || candSnap.data().status !== 'waiting') throw new Error('taken');
                if (!mineSnap.exists || mineSnap.data().status !== 'waiting') throw new Error('self-taken');
                const a = { uid: mineSnap.data().uid, username: mineSnap.data().username };
                const b = { uid: candSnap.data().uid, username: candSnap.data().username };
                const swap = Math.random() < 0.5;
                const p1 = swap ? b : a;
                const p2 = swap ? a : b;
                const initialState = handlers.buildInitialState(p1, p2);
                tx.set(roomRef, {
                    category,
                    players: { p1, p2 },
                    status: 'active',
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    p1LastSeen: firebase.firestore.FieldValue.serverTimestamp(),
                    p2LastSeen: firebase.firestore.FieldValue.serverTimestamp(),
                    state: initialState
                });
                tx.update(candSnap.ref, { status: 'matched', roomId: roomRef.id });
                tx.update(myTicketRef, { status: 'matched', roomId: roomRef.id });
            });
        }).then(() => {
            cleanup();
            handlers.onMatched(roomRef.id);
        }).catch(() => {
            claiming = false; // someone else claimed the candidate (or us) first -- keep listening
        });
    }

    db.collection('queue').add({
        uid: user.uid,
        username: user.displayName || 'Player',
        category,
        createdAtMs: Date.now(),
        status: 'waiting',
        roomId: null
    }).then(ref => {
        if (cancelled) { ref.delete().catch(() => {}); return; }
        myTicketRef = ref;

        unsubMine = ref.onSnapshot(snap => {
            const data = snap.data();
            if (data && data.status === 'matched' && data.roomId) {
                cleanup();
                handlers.onMatched(data.roomId);
            }
        });

        unsubQueue = db.collection('queue')
            .where('category', '==', category)
            .where('status', '==', 'waiting')
            .onSnapshot(snap => {
                if (cancelled || claiming) return;
                const candidates = snap.docs
                    .filter(d => d.id !== myTicketRef.id && d.data().uid !== user.uid)
                    .sort((a, b) => a.data().createdAtMs - b.data().createdAtMs);
                if (candidates.length === 0) { handlers.onWaiting && handlers.onWaiting(); return; }
                tryClaim(candidates[0]);
            }, err => handlers.onError && handlers.onError(err));
    }).catch(err => handlers.onError && handlers.onError(err));

    return {
        cancel() {
            cancelled = true;
            cleanup();
            if (myTicketRef) myTicketRef.delete().catch(() => {});
        }
    };
}

// ─── ROOMS ──────────────────────────────────────────────────────
function listenRoom(roomId, cb) {
    return db.collection('rooms').doc(roomId).onSnapshot(snap => {
        if (snap.exists) cb(snap.data());
    });
}

function mySlot(room, uid) {
    if (room.players.p1.uid === uid) return 'p1';
    if (room.players.p2.uid === uid) return 'p2';
    return null;
}

function otherSlot(slot) {
    return slot === 'p1' ? 'p2' : 'p1';
}

function updateRoomState(roomId, partialState) {
    const dotted = {};
    Object.keys(partialState).forEach(k => { dotted['state.' + k] = partialState[k]; });
    return db.collection('rooms').doc(roomId).update(dotted);
}

function markRoomFinished(roomId, partialState) {
    const dotted = { status: 'finished' };
    if (partialState) Object.keys(partialState).forEach(k => { dotted['state.' + k] = partialState[k]; });
    return db.collection('rooms').doc(roomId).update(dotted);
}

function touchPresence(roomId, slot) {
    const field = slot + 'LastSeen';
    return db.collection('rooms').doc(roomId).update({ [field]: firebase.firestore.FieldValue.serverTimestamp() }).catch(() => {});
}

// Presence is "stale" (opponent likely disconnected) if their last heartbeat
// is older than this. Heartbeats are sent every ~5s (see startPresenceHeartbeat).
const PRESENCE_STALE_MS = 15000;

function isOpponentStale(room, slot) {
    const ts = room[otherSlot(slot) + 'LastSeen'];
    if (!ts || typeof ts.toMillis !== 'function') return false;
    return netNow() - ts.toMillis() > PRESENCE_STALE_MS;
}

function startPresenceHeartbeat(roomId, slot) {
    touchPresence(roomId, slot);
    const id = setInterval(() => touchPresence(roomId, slot), 5000);
    return () => clearInterval(id);
}
