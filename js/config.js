const SUPABASE_URL = 'https://mccnhiphlvzezkztpexr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1jY25oaXBobHZ6ZXprenRwZXhyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwNTIzMTUsImV4cCI6MjA5MzYyODMxNX0.uWZGzLuHVdBivcgR6I05-q3a9OesFXXBy54nkPJWESY';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function getUser() {
  const { data: { user } } = await sb.auth.getUser();
  return user;
}

async function requireAuth() {
  const user = await getUser();
  if (!user) { window.location.href = 'index.html'; return null; }
  return user;
}

async function getProfile(userId) {
  const { data } = await sb.from('profiles').select('*').eq('id', userId).single();
  return data;
}

function showToast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, 3500);
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str ?? '';
  return d.innerHTML;
}

function posColor(pos) {
  const cols = ['#3b82f6','#ef4444','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#84cc16','#f97316','#6366f1'];
  return cols[pos % cols.length];
}

function nameInitials(name) {
  return (name || '?').split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
}

function charAvatar(char, size = '') {
  if (char.photo_url) {
    return `<img src="${escapeHtml(char.photo_url)}" alt="${escapeHtml(char.name)}" loading="lazy">`;
  }
  return `<div class="initials-avatar ${size}" style="background:${posColor(char.position)}">${nameInitials(char.name)}</div>`;
}
