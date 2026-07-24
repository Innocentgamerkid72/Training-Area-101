// Shared leaderboard logic: category metadata, score submission, and
// fetch/rank queries. Used both by each game's end-of-session call and by
// leaderboard.html.
const CATEGORIES = {
    accuracy: { en: 'Clicker Accuracy',    zh: '点击精准度',           unit: '',      better: 'desc' },
    speed:    { en: 'Clicking Speed',      zh: '点击速度',             unit: ' CPM',  better: 'desc' },
    reaction: { en: 'Reaction Time',       zh: '反应时间',             unit: 'ms',    better: 'asc'  },
    timing:   { en: 'Timing',              zh: '时机训练',             unit: '',      better: 'desc' },
    typing:   { en: 'Typing Accuracy',     zh: '打字精准度',           unit: '',      better: 'desc' },
    stroop:   { en: 'Stroop Rush',         zh: '斯特鲁普冲刺',         unit: '',      better: 'desc' },
    chess:    { en: 'Chess (vs Bot wins)', zh: '国际象棋（人机对战胜场）', unit: ' wins', better: 'desc' }
};

// Every session's score is written as its own immutable log entry (never
// updated/deleted) -- this keeps the Firestore security rules simple and
// tamper-proof. The leaderboard READ side collapses to each user's best.
function submitScore(category, value) {
    const user = auth.currentUser;
    if (!user) return Promise.resolve(); // not logged in -- just skip silently
    awardXp(XP_SESSION);
    return db.collection('scores').add({
        uid: user.uid,
        username: user.displayName || 'Player',
        category,
        value,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
}

// Chess is a running tally (wins vs the bot), not a best-single-session
// value, so it gets its own doc-per-user with an atomic increment instead.
function submitChessWin() {
    const user = auth.currentUser;
    if (!user) return Promise.resolve();
    awardXp(XP_WIN_BONUS);
    const ref = db.collection('chessStats').doc(user.uid);
    return db.runTransaction(tx => {
        return tx.get(ref).then(doc => {
            const wins = doc.exists ? (doc.data().wins || 0) + 1 : 1;
            tx.set(ref, { uid: user.uid, username: user.displayName || 'Player', wins }, { merge: true });
        });
    });
}

async function fetchLeaderboard(category, limitCount) {
    limitCount = limitCount || 10;
    const info = CATEGORIES[category];
    if (!info) return [];

    if (category === 'chess') {
        const snap = await db.collection('chessStats').orderBy('wins', 'desc').limit(limitCount).get();
        return snap.docs.map(d => ({ username: d.data().username, value: d.data().wins }));
    }

    // Overfetch the raw log, then collapse to each user's personal best
    // client-side, since every session wrote its own separate entry.
    const snap = await db.collection('scores')
        .where('category', '==', category)
        .orderBy('value', info.better === 'asc' ? 'asc' : 'desc')
        .limit(limitCount * 5)
        .get();

    const bestByUser = new Map();
    snap.docs.forEach(d => {
        const data = d.data();
        const existing = bestByUser.get(data.uid);
        const isBetter = !existing || (info.better === 'asc' ? data.value < existing.value : data.value > existing.value);
        if (isBetter) bestByUser.set(data.uid, { username: data.username, value: data.value });
    });

    return Array.from(bestByUser.values())
        .sort((a, b) => info.better === 'asc' ? a.value - b.value : b.value - a.value)
        .slice(0, limitCount);
}
