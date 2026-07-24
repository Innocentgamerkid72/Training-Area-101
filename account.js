// Shared login/signup widget + Firebase Auth wiring. Injects itself into
// .page-nav (game pages) or .home-header (index.html) -- no HTML markup
// needed on the page itself beyond the <script> includes.
firebase.initializeApp(FIREBASE_CONFIG);
const auth = firebase.auth();
const db = firebase.firestore();

let currentUser = null;

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ─── QUICK SIGN UP (GitHub-style: random username + password, no typing) ──
// Firebase's email/password provider still needs *some* email under the
// hood, so a fake-but-syntactically-valid one is derived deterministically
// from the username (lowercased) -- that's also what lets logging back in
// happen by username instead of email, with no separate lookup table.
const USERNAME_ADJECTIVES = ['Swift','Clever','Brave','Silent','Cosmic','Lucky','Mighty','Gentle','Bold','Quick','Sunny','Rapid','Bright','Wild','Calm','Sharp','Wise','Nimble','Fierce','Jolly','Noble','Vivid','Golden','Silver'];
const USERNAME_NOUNS = ['Falcon','Tiger','Otter','Comet','Panda','Wolf','Hawk','Fox','Dragon','Phoenix','Lynx','Eagle','Raven','Panther','Shark','Whale','Badger','Heron','Cobra','Jaguar','Puma','Griffin','Kestrel','Viper'];

function generateUsername() {
    const adj = USERNAME_ADJECTIVES[Math.floor(Math.random() * USERNAME_ADJECTIVES.length)];
    const noun = USERNAME_NOUNS[Math.floor(Math.random() * USERNAME_NOUNS.length)];
    const num = Math.floor(Math.random() * 900) + 100;
    return adj + noun + num;
}

function generatePassword() {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'; // no 0/O/1/l/I -- avoids ambiguity when copied by hand
    const arr = new Uint32Array(14);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(arr);
    else for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 4294967295);
    let out = '';
    for (let i = 0; i < arr.length; i++) out += chars[arr[i] % chars.length];
    return out;
}

function usernameToEmail(username) {
    return username.trim().toLowerCase() + '@ta101-account.invalid';
}

// ─── XP / LEVELS ──────────────────────────────────────────────────
// Reaching level L from L-1 costs L*100 XP (so lvl2=100, lvl3=+200=300
// cumulative, lvl4=+300=600 cumulative, etc -- a gently steepening curve).
// XP_SESSION fires automatically from every submitScore() call (leaderboard.js
// -- covers every solo session AND both sides of an online race, win or
// lose, since both players call submitScore with their own result).
// XP_WIN_BONUS fires automatically from submitChessWin() and is added
// explicitly wherever a game's own "iWon" branch already exists. Games whose
// losing path doesn't run through either of those (a Standoff fault-forfeit,
// a chess resignation) call awardXp(XP_SESSION) directly at that spot instead.
const XP_SESSION = 15;
const XP_WIN_BONUS = 25;

function levelForXp(xp) {
    let level = 1, remaining = xp || 0;
    while (remaining >= level * 100) {
        remaining -= level * 100;
        level++;
    }
    return level;
}

function xpProgress(xp) {
    const level = levelForXp(xp);
    let consumed = 0;
    for (let l = 1; l < level; l++) consumed += l * 100;
    const xpIntoLevel = (xp || 0) - consumed;
    const xpForThisLevel = level * 100;
    return { level, xpIntoLevel, xpForThisLevel };
}

function awardXp(amount) {
    const user = auth.currentUser;
    if (!user) return Promise.resolve();
    return db.collection('userProgress').doc(user.uid).set({
        uid: user.uid,
        username: user.displayName || 'Player',
        xp: firebase.firestore.FieldValue.increment(amount)
    }, { merge: true });
}

function listenUserProgress(uid, cb) {
    return db.collection('userProgress').doc(uid).onSnapshot(snap => {
        cb(snap.exists ? (snap.data().xp || 0) : 0);
    });
}

// ─── WIDGET ─────────────────────────────────────────────────────
function buildAccountWidget() {
    if (document.getElementById('account-widget')) return;
    const nav = document.querySelector('.page-nav') || document.querySelector('.home-header');
    if (!nav) return;
    const widget = document.createElement('div');
    widget.id = 'account-widget';
    widget.className = 'account-widget';
    nav.appendChild(widget);
    renderAccountWidget();
}

function renderAccountWidget() {
    const widget = document.getElementById('account-widget');
    if (!widget) return;
    if (currentUser) {
        const level = levelForXp(currentXp);
        widget.innerHTML =
            '<span class="account-level" title="' + xpProgress(currentXp).xpIntoLevel + ' / ' + xpProgress(currentXp).xpForThisLevel + ' XP to next level">Lv.' + level + '</span>' +
            '<span class="account-name">👤 ' + escapeHtml(currentUser.displayName || 'Player') + '</span>' +
            '<button class="btn btn-ghost btn-sm" id="btn-logout">Log Out</button>';
        document.getElementById('btn-logout').onclick = () => auth.signOut();
    } else {
        widget.innerHTML = '<button class="btn btn-ghost btn-sm" id="btn-account">Log In / Sign Up</button>';
        document.getElementById('btn-account').onclick = openAuthModal;
    }
}

// ─── LOGIN / SIGNUP MODAL ───────────────────────────────────────
function buildAuthModal() {
    if (document.getElementById('auth-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'auth-overlay';
    overlay.className = 'auth-overlay';
    overlay.innerHTML =
        '<div class="auth-card">' +
            '<button class="btn btn-ghost auth-google" id="btn-google">Continue with Google</button>' +
            '<div class="auth-divider"><span>or</span></div>' +
            '<div class="auth-tabs">' +
                '<button class="auth-tab sel" data-tab="login">Log In</button>' +
                '<button class="auth-tab" data-tab="signup">Sign Up</button>' +
            '</div>' +
            '<div class="auth-error" id="auth-error"></div>' +
            '<form id="auth-form-login" class="auth-form">' +
                '<input type="text" id="login-identifier" placeholder="Username or Email" required autocomplete="username">' +
                '<input type="password" id="login-password" placeholder="Password" required autocomplete="current-password">' +
                '<button class="btn btn-primary" type="submit">Log In</button>' +
            '</form>' +
            '<form id="auth-form-signup" class="auth-form" style="display:none;">' +
                '<button type="button" class="btn btn-primary" id="btn-quick-signup">⚡ Quick Sign Up (random username)</button>' +
                '<div class="auth-divider"><span>or pick your own username</span></div>' +
                '<input type="text" id="signup-username" placeholder="Username (shown on leaderboards)" required maxlength="20">' +
                '<input type="password" id="signup-password" placeholder="Password (6+ characters)" required minlength="6" autocomplete="new-password">' +
                '<button class="btn btn-ghost" type="submit">Create Account</button>' +
            '</form>' +
            '<div class="auth-generated" id="auth-generated" style="display:none;">' +
                '<p class="auth-generated-note">Account created! Save these — there\'s no email attached, so this is the only way to log back in on another device.</p>' +
                '<div class="auth-cred-row"><span class="auth-cred-label">Username</span><code id="gen-username"></code></div>' +
                '<div class="auth-cred-row"><span class="auth-cred-label">Password</span><code id="gen-password"></code></div>' +
                '<button class="btn btn-primary" id="auth-generated-continue">I\'ve Saved It — Continue</button>' +
            '</div>' +
            '<button class="btn btn-ghost auth-close" id="auth-close">Close</button>' +
        '</div>';
    document.body.appendChild(overlay);

    overlay.querySelectorAll('.auth-tab').forEach(tab => {
        tab.onclick = () => {
            overlay.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('sel'));
            tab.classList.add('sel');
            const isLogin = tab.dataset.tab === 'login';
            document.getElementById('auth-form-login').style.display = isLogin ? '' : 'none';
            document.getElementById('auth-form-signup').style.display = isLogin ? 'none' : '';
            document.getElementById('auth-error').textContent = '';
        };
    });

    document.getElementById('auth-close').onclick = closeAuthModal;
    overlay.addEventListener('click', e => { if (e.target === overlay) closeAuthModal(); });

    document.getElementById('btn-google').onclick = () => {
        auth.signInWithPopup(new firebase.auth.GoogleAuthProvider())
            .then(() => closeAuthModal())
            .catch(showAuthError);
    };

    document.getElementById('auth-form-login').addEventListener('submit', e => {
        e.preventDefault();
        const identifier = document.getElementById('login-identifier').value.trim();
        const password = document.getElementById('login-password').value;
        const email = identifier.includes('@') ? identifier : usernameToEmail(identifier);
        auth.signInWithEmailAndPassword(email, password)
            .then(() => closeAuthModal())
            .catch(showAuthError);
    });

    document.getElementById('auth-form-signup').addEventListener('submit', e => {
        e.preventDefault();
        const username = document.getElementById('signup-username').value.trim();
        const password = document.getElementById('signup-password').value;
        if (!username) { showAuthError({ message: 'Please choose a username.' }); return; }
        auth.createUserWithEmailAndPassword(usernameToEmail(username), password)
            .then(cred => cred.user.updateProfile({ displayName: username }))
            .then(() => closeAuthModal())
            .catch(err => {
                if (err && err.code === 'auth/email-already-in-use') { showAuthError({ message: 'That username is already taken -- try another.' }); return; }
                showAuthError(err);
            });
    });

    document.getElementById('btn-quick-signup').onclick = () => quickSignUp();

    document.getElementById('auth-generated-continue').onclick = () => {
        restoreAuthModalDefaults();
        closeAuthModal();
    };
}

function quickSignUp(attempt) {
    attempt = attempt || 0;
    if (attempt >= 5) { showAuthError({ message: 'Could not generate a unique account -- please try again.' }); return; }
    const username = generateUsername();
    const password = generatePassword();
    auth.createUserWithEmailAndPassword(usernameToEmail(username), password)
        .then(cred => cred.user.updateProfile({ displayName: username }))
        .then(() => showGeneratedCredentials(username, password))
        .catch(err => {
            if (err && err.code === 'auth/email-already-in-use') { quickSignUp(attempt + 1); return; }
            showAuthError(err);
        });
}

function showGeneratedCredentials(username, password) {
    document.getElementById('gen-username').textContent = username;
    document.getElementById('gen-password').textContent = password;
    document.querySelector('.auth-google').style.display = 'none';
    document.querySelectorAll('.auth-divider').forEach(d => { d.style.display = 'none'; });
    document.querySelector('.auth-tabs').style.display = 'none';
    document.getElementById('auth-form-login').style.display = 'none';
    document.getElementById('auth-form-signup').style.display = 'none';
    document.getElementById('auth-error').style.display = 'none';
    document.getElementById('auth-close').style.display = 'none';
    document.getElementById('auth-generated').style.display = '';
}

function restoreAuthModalDefaults() {
    document.querySelector('.auth-google').style.display = '';
    document.querySelectorAll('.auth-divider').forEach(d => { d.style.display = ''; });
    document.querySelector('.auth-tabs').style.display = '';
    document.getElementById('auth-form-login').style.display = '';
    document.getElementById('auth-form-signup').style.display = 'none';
    document.getElementById('auth-error').style.display = '';
    document.getElementById('auth-error').textContent = '';
    document.getElementById('auth-close').style.display = '';
    document.getElementById('auth-generated').style.display = 'none';
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('sel'));
    document.querySelector('.auth-tab[data-tab="login"]').classList.add('sel');
}

function showAuthError(err) {
    const el = document.getElementById('auth-error');
    if (el) el.textContent = (err && err.message) || 'Something went wrong.';
}

function openAuthModal() {
    buildAuthModal();
    document.getElementById('auth-overlay').classList.add('on');
}

function closeAuthModal() {
    const overlay = document.getElementById('auth-overlay');
    if (overlay) overlay.classList.remove('on');
}

let currentXp = 0;
let unsubUserProgress = null;

auth.onAuthStateChanged(user => {
    currentUser = user;
    if (unsubUserProgress) { unsubUserProgress(); unsubUserProgress = null; }
    if (user) {
        unsubUserProgress = listenUserProgress(user.uid, xp => {
            currentXp = xp;
            renderAccountWidget();
        });
    } else {
        currentXp = 0;
    }
    renderAccountWidget();
});

document.addEventListener('DOMContentLoaded', buildAccountWidget);
