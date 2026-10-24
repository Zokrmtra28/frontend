const API = 'http://127.0.0.1:8000/api';   // adresse de ton backend Django
const STATUS = { PENDING: 'En attente', PREPARING: 'En préparation', IN_DELIVERY: 'En livraison', DELIVERED: 'Livrée', CANCELLED: 'Annulée' };
const NEXT = { PENDING: ['PREPARING', 'Prendre en charge'], PREPARING: ['IN_DELIVERY', 'Partir en livraison'], IN_DELIVERY: ['DELIVERED', 'Marquer livrée'] };
const HOME = { CLIENT: 'catalog', LIVREUR: 'delivery', ADMIN_DISPATCH: 'admin' };

let user = JSON.parse(localStorage.getItem('user') || 'null');
let cart = [], products = [], livreurs = [], timer;

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');
const money = (n) => Number(n).toLocaleString('fr-FR') + ' Ar';
const errText = (e) => e.detail || e.username?.[0] || e.password?.[0] || (e.items && JSON.stringify(e.items)) || 'Une erreur est survenue.';

function show(text, ok) {
  const m = $('#msg');
  m.textContent = text; m.hidden = !text; m.className = ok ? 'ok' : '';
}

// ---------- Appels au backend ----------
async function api(path, method = 'GET', body) {
  const token = localStorage.getItem('token');
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) logout();
    throw data;
  }
  return data;
}

// ---------- Navigation ----------
function go(name) {
  clearInterval(timer);
  show('');
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('on', v.id === name));
  renderNav();
  const load = { catalog: loadCatalog, orders: loadOrders, admin: loadAdmin, delivery: loadDelivery }[name];
  if (load) { load(); if (name !== 'catalog') timer = setInterval(load, 5000); }
}

function renderNav() {
  const links = !user ? [['login', 'Connexion'], ['register', 'Inscription']]
    : user.role === 'CLIENT' ? [['catalog', 'Catalogue'], ['orders', 'Mes commandes']] : [[HOME[user.role], 'Dashboard']];
  $('#nav').innerHTML = links.map(([v, t]) => `<a href="#" data-go="${v}">${t}</a>`).join('') +
    (user ? `<button id="logout">Déconnexion (${esc(user.username)})</button>` : '');
}

function logout() {
  localStorage.clear(); user = null; cart = [];
  go('login');
}

function enter(data) {
  localStorage.setItem('token', data.access);
  user = data.user;
  localStorage.setItem('user', JSON.stringify(user));
  go(HOME[user.role]);
}

// ---------- Catalogue et panier ----------
async function loadCatalog() {
  try { products = await api('/products/'); } catch { return show('Impossible de charger le catalogue.'); }
  $('#products').innerHTML = products.map((p) => `
    <div class="card"><b>${esc(p.name)}</b><p>${esc(p.description)}</p>
      <p class="price">${money(p.price)}</p><p>Stock : ${p.stock}</p>
      <button class="btn" data-add="${p.id}" ${p.stock < 1 ? 'disabled' : ''}>Ajouter</button></div>`).join('');
  renderCart();
}

function renderCart() {
  const total = cart.reduce((s, i) => s + i.qty * i.price, 0);
  $('#cart').innerHTML = (cart.length ? cart.map((i) => `
    <div class="row"><span>${esc(i.name)}</span>
      <span><button data-qty="${i.id}" data-d="-1">−</button> ${i.qty} <button data-qty="${i.id}" data-d="1">+</button></span></div>`).join('')
    : '<p>Votre panier est vide.</p>') + `<p class="price">Total : ${money(total)}</p>`;
}

// ---------- Commandes ----------
function orderCard(o, footer = '') {
  return `<div class="card"><div class="row"><b>Commande #${o.id}</b><span class="badge ${o.statut}">${STATUS[o.statut]}</span></div>
    <p>Client : ${esc(o.client_username)} — ${esc(o.telephone)}</p><p>${esc(o.adresse_texte)}</p>
    <ul>${o.items.map((i) => `<li>${i.quantity}× ${esc(i.product_name)}</li>`).join('')}</ul>
    <p class="price">${money(o.montant_total)}</p>${footer}</div>`;
}

async function loadOrders() {
  try {
    const list = await api('/orders/');
    $('#orderList').innerHTML = list.map((o) => orderCard(o, o.livreur_username ? `<p>Livreur : ${esc(o.livreur_username)}</p>` : '')).join('') || '<p>Aucune commande.</p>';
  } catch { show('Impossible de charger vos commandes.'); }
}

async function loadDelivery() {
  try {
    const list = await api('/orders/');
    $('#deliveryList').innerHTML = list.map((o) => orderCard(o, NEXT[o.statut]
      ? `<button class="btn" data-id="${o.id}" data-next="${NEXT[o.statut][0]}">${NEXT[o.statut][1]}</button>` : '<p>Terminée</p>')).join('') || '<p>Aucune livraison assignée.</p>';
  } catch { show('Impossible de charger vos livraisons.'); }
}

async function loadAdmin() {
  try {
    const [list, liv] = await Promise.all([api('/orders/'), api('/livreurs/')]);
    livreurs = liv;
    $('#adminList').innerHTML = list.map((o) => orderCard(o, `
      <select data-id="${o.id}" data-k="statut">${Object.keys(STATUS).map((s) => `<option value="${s}" ${s === o.statut ? 'selected' : ''}>${STATUS[s]}</option>`).join('')}</select>
      <select data-id="${o.id}" data-k="livreur_id"><option value="">Non assigné</option>${livreurs.map((l) => `<option value="${l.id}" ${l.id === o.livreur ? 'selected' : ''}>${esc(l.username)}</option>`).join('')}</select>`)).join('') || '<p>Aucune commande.</p>';
  } catch { show('Impossible de charger le dashboard.'); }
}

async function updateOrder(id, payload) {
  try { await api(`/orders/${id}/update-status/`, 'POST', payload); user.role === 'LIVREUR' ? loadDelivery() : loadAdmin(); }
  catch (e) { show(errText(e)); }
}

// ---------- Événements ----------
document.addEventListener('click', (e) => {
  const t = e.target;
  if (t.dataset.go) { e.preventDefault(); go(t.dataset.go); }
  if (t.id === 'logout') logout();
  if (t.dataset.add) {
    const p = products.find((x) => x.id == t.dataset.add), line = cart.find((i) => i.id === p.id);
    line ? line.qty++ : cart.push({ id: p.id, name: p.name, price: p.price, qty: 1 });
    renderCart();
  }
  if (t.dataset.qty) {
    const line = cart.find((i) => i.id == t.dataset.qty);
    line.qty += Number(t.dataset.d);
    cart = cart.filter((i) => i.qty > 0);
    renderCart();
  }
  if (t.dataset.next) updateOrder(t.dataset.id, { statut: t.dataset.next });
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (!t.dataset.k) return;
  updateOrder(t.dataset.id, { [t.dataset.k]: t.dataset.k === 'livreur_id' ? (t.value ? Number(t.value) : null) : t.value });
});

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try { enter(await api('/auth/login/', 'POST', Object.fromEntries(new FormData(e.target)))); }
  catch (err) { show(errText(err)); }
});

$('#registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = Object.fromEntries(new FormData(e.target));
  try {
    await api('/auth/register/', 'POST', form);
    enter(await api('/auth/login/', 'POST', { username: form.username, password: form.password }));
  } catch (err) { show(errText(err)); }
});

$('#orderForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!cart.length) return show('Votre panier est vide.');
  try {
    await api('/orders/', 'POST', { ...Object.fromEntries(new FormData(e.target)), items: cart.map((i) => ({ product_id: i.id, quantity: i.qty })) });
    cart = []; e.target.reset(); await loadCatalog(); show('Commande passée avec succès.', true);
  } catch (err) { show(errText(err)); }
});

go(user ? HOME[user.role] : 'login');
