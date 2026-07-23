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
        widget.innerHTML =
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
            '<div class="auth-tabs">' +
                '<button class="auth-tab sel" data-tab="login">Log In</button>' +
                '<button class="auth-tab" data-tab="signup">Sign Up</button>' +
            '</div>' +
            '<div class="auth-error" id="auth-error"></div>' +
            '<form id="auth-form-login" class="auth-form">' +
                '<input type="email" id="login-email" placeholder="Email" required autocomplete="email">' +
                '<input type="password" id="login-password" placeholder="Password" required autocomplete="current-password">' +
                '<button class="btn btn-primary" type="submit">Log In</button>' +
            '</form>' +
            '<form id="auth-form-signup" class="auth-form" style="display:none;">' +
                '<input type="text" id="signup-username" placeholder="Username (shown on leaderboards)" required maxlength="20">' +
                '<input type="email" id="signup-email" placeholder="Email" required autocomplete="email">' +
                '<input type="password" id="signup-password" placeholder="Password (6+ characters)" required minlength="6" autocomplete="new-password">' +
                '<button class="btn btn-primary" type="submit">Create Account</button>' +
            '</form>' +
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

    document.getElementById('auth-form-login').addEventListener('submit', e => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        auth.signInWithEmailAndPassword(email, password)
            .then(() => closeAuthModal())
            .catch(showAuthError);
    });

    document.getElementById('auth-form-signup').addEventListener('submit', e => {
        e.preventDefault();
        const username = document.getElementById('signup-username').value.trim();
        const email = document.getElementById('signup-email').value;
        const password = document.getElementById('signup-password').value;
        if (!username) { showAuthError({ message: 'Please choose a username.' }); return; }
        auth.createUserWithEmailAndPassword(email, password)
            .then(cred => cred.user.updateProfile({ displayName: username }))
            .then(() => closeAuthModal())
            .catch(showAuthError);
    });
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

auth.onAuthStateChanged(user => {
    currentUser = user;
    renderAccountWidget();
});

document.addEventListener('DOMContentLoaded', buildAccountWidget);
