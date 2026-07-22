// Shared confetti burst, used by every game's results screen.
function spawnConfetti(count) {
    count = count || 70;
    let layer = document.getElementById('confetti-layer');
    if (!layer) {
        layer = document.createElement('div');
        layer.id = 'confetti-layer';
        layer.className = 'confetti-layer';
        document.body.appendChild(layer);
    }
    const colors = ['var(--blue)', 'var(--orange)', 'var(--green)', 'var(--purple)', 'var(--red)', 'var(--yellow)'];
    for (let i = 0; i < count; i++) {
        const piece = document.createElement('div');
        piece.className = 'confetti-piece';
        piece.style.left = Math.random() * 100 + '%';
        piece.style.background = colors[Math.floor(Math.random() * colors.length)];
        piece.style.animationDelay = (Math.random() * 0.35) + 's';
        piece.style.animationDuration = (1.6 + Math.random() * 1.3) + 's';
        piece.style.setProperty('--drift', Math.round(Math.random() * 160 - 80) + 'px');
        piece.style.setProperty('--rot', Math.round(Math.random() * 720 - 360) + 'deg');
        layer.appendChild(piece);
        setTimeout(() => piece.remove(), 3200);
    }
}
