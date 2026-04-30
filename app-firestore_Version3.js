import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  getDoc,
  setDoc,
  query,
  orderBy,
  where,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// ─── Firebase ────────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyC8IRsEWgUZEY6AwdOWE8ZCVPorPuObdFA",
  authDomain: "solomix-56b7b.firebaseapp.com",
  projectId: "solomix-56b7b",
  storageBucket: "solomix-56b7b.firebasestorage.app",
  messagingSenderId: "851808503220",
  appId: "1:851808503220:web:f1d632e4405331385d1ee1",
  measurementId: "G-8PVVFM0KRX"
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ─── Session ──────────────────────────────────────────────────────────────────
let currentUser = null; // { username, role, filial, nome }

// ─── In-memory caches ─────────────────────────────────────────────────────────
let itensProposta = [];
let clientesCache = [];
let perfisCache = [];
let propostasCache = [];
let programacoesCache = [];
let usuariosCache = [];
let empresaCache = {};
let obrasCache = [];
let empresasCache = [];
let propostaItensTemp = [];
let _pendingInactivateId = null;

let _localIdCounter = 0;
function generateLocalId() {
  _localIdCounter++;
  return `${Date.now()}_${_localIdCounter}`;
}

// ─── Google Calendar OAuth state ─────────────────────────────────────────────
const GCAL_CLIENT_ID_KEY  = 'gcal_client_id';
const GCAL_TIMEZONE       = 'America/Sao_Paulo';
let gcalToken = null;           // current access token
let gcalTokenExpiry = 0;        // expiry time (Date.now() ms)
let gcalTokenClient = null;     // GIS token client instance
let gcalTokenRefreshing = false; // guard against concurrent refresh requests

// ─── Constants ────────────────────────────────────────────────────────────────
const ADMIN_USER = 'admin';
const ADMIN_SENHA_KEY = 'solomix_admin_senha';
const DEFAULT_ADMIN_SENHA = 'password2026';
const SESSION_KEY = 'solomix_user';

// ─── HTML escaping to prevent XSS ────────────────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Proposal number formatting ───────────────────────────────────────────────
function formatNumeroProposta(num) {
  return num ? String(num).padStart(4, '0') : '—';
}

// ─── Role helpers ─────────────────────────────────────────────────────────────
function isAdmin()    { return currentUser?.role === 'administrador'; }
function isGerente()  { return currentUser?.role === 'gerente'; }
function isConsultor(){ return currentUser?.role === 'consultor_comercial'; }
function podeGerenciarUsuarios() { return isAdmin() || isGerente(); }

function aplicarFiltroRole(lista) {
  if (!currentUser || isAdmin()) return lista;
  if (isGerente()) {
    return lista.filter(r => !r.filial || r.filial === currentUser.filial);
  }
  // consultor_comercial: only own records (or legacy records with no criadoPor)
  return lista.filter(r => !r.criadoPor || r.criadoPor === currentUser.username);
}

// Profile-specific visibility: consultor sees ONLY their own profiles (no legacy fallback)
function filtrarPerfisRole(lista) {
  if (!currentUser || isAdmin()) return lista;
  if (isGerente()) {
    return lista.filter(p => !p.filial || p.filial === currentUser.filial);
  }
  // consultor_comercial: strictly only profiles created by themselves
  return lista.filter(p => p.criadoPor === currentUser.username);
}

// Returns true if the current user is allowed to edit/delete the given profile
function podeDeletarPerfil(p) {
  if (isAdmin()) return true;
  if (isGerente()) return !p.filial || p.filial === currentUser.filial;
  return p.criadoPor === currentUser.username;
}

function filialParaRegistro() {
  // For admin using a proposal form the filial field is editable
  return currentUser?.filial || 'Divinopolis';
}

// ─── Login / Logout ───────────────────────────────────────────────────────────
async function fazerLogin() {
  const username = (document.getElementById('login_usuario')?.value || '').trim().toLowerCase();
  const senha    = (document.getElementById('login_senha')?.value || '').trim();
  const erroEl   = document.getElementById('login-erro');
  if (erroEl) erroEl.textContent = '';

  if (!username || !senha) {
    if (erroEl) erroEl.textContent = 'Informe usuário e senha.';
    return;
  }

  // Bootstrap admin (local)
  if (username === ADMIN_USER) {
    const adminSenha = localStorage.getItem(ADMIN_SENHA_KEY) || DEFAULT_ADMIN_SENHA;
    if (senha === adminSenha) {
      currentUser = { username: ADMIN_USER, role: 'administrador', filial: 'Todas', nome: 'Administrador' };
      iniciarSessao();
      return;
    }
    if (erroEl) erroEl.textContent = 'Usuário ou senha incorretos.';
    return;
  }

  // Firestore users
  try {
    const snap = await getDocs(query(collection(db, 'usuarios'), where('username', '==', username)));
    if (snap.empty) {
      if (erroEl) erroEl.textContent = 'Usuário ou senha incorretos.';
      return;
    }
    const userData = snap.docs[0].data();
    if (userData.senha !== senha) {
      if (erroEl) erroEl.textContent = 'Usuário ou senha incorretos.';
      return;
    }
    if (userData.ativo === false) {
      if (erroEl) erroEl.textContent = 'Usuário inativo. Entre em contato com o administrador.';
      return;
    }
    currentUser = {
      id: snap.docs[0].id,
      username: userData.username,
      role: userData.role || 'consultor_comercial',
      filial: userData.filial || 'Divinopolis',
      nome: userData.nome || username
    };
    iniciarSessao();
  } catch (e) {
    console.error(e);
    if (erroEl) erroEl.textContent = 'Erro ao conectar. Verifique a conexão.';
  }
}

function iniciarSessao() {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(currentUser));
  document.getElementById('tela-login').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  configurarUI();
  inicializar();
}

function fazerLogout() {
  sessionStorage.removeItem(SESSION_KEY);
  currentUser = null;
  document.getElementById('app').style.display = 'none';
  document.getElementById('tela-login').style.display = 'flex';
  const erroEl = document.getElementById('login-erro');
  if (erroEl) erroEl.textContent = '';
  document.getElementById('login_usuario').value = '';
  document.getElementById('login_senha').value = '';
}

function configurarUI() {
  document.getElementById('header-nome').textContent   = currentUser.nome;
  document.getElementById('header-role').textContent   = labelRole(currentUser.role);
  document.getElementById('header-filial').textContent = currentUser.filial;

  const navU = document.getElementById('nav-usuarios');
  if (navU) navU.style.display = podeGerenciarUsuarios() ? '' : 'none';

  const navD = document.getElementById('nav-dashboard');
  if (navD) navD.style.display = (isAdmin() || isGerente()) ? '' : 'none';

  // For gerente/consultor, lock filial fields to their own filial
  const filialSelProposta = document.getElementById('filial');
  if (filialSelProposta && !isAdmin()) {
    filialSelProposta.value = currentUser.filial;
    filialSelProposta.disabled = true;
  }

  // In user form: admin sees all roles; gerente sees only gerente/consultor
  const uRole = document.getElementById('u_role');
  if (uRole) {
    if (!isAdmin()) {
      // Remove administrador option for gerente
      Array.from(uRole.options).forEach(opt => {
        if (opt.value === 'administrador') opt.remove();
      });
    }
  }
  // In user form: gerente can only set their own filial
  const uFilial = document.getElementById('u_filial');
  if (uFilial && isGerente()) {
    uFilial.value = currentUser.filial;
    uFilial.disabled = true;
  }
}

function labelRole(role) {
  const map = { administrador: 'Administrador', gerente: 'Gerente', consultor_comercial: 'Consultor Comercial' };
  return map[role] || role;
}

// ─── Password change (login screen modal) ─────────────────────────────────────
function abrirModalSenha() {
  const m = document.getElementById('modal-senha');
  if (m) { m.classList.add('aberto'); document.getElementById('senha-msg').textContent = ''; }
}
function fecharModalSenha() {
  const m = document.getElementById('modal-senha');
  if (m) m.classList.remove('aberto');
}

async function trocarSenha() {
  const usuario    = (document.getElementById('ms_usuario')?.value || '').trim().toLowerCase();
  const senhaAtual = (document.getElementById('ms_senha_atual')?.value || '').trim();
  const senhaNova  = (document.getElementById('ms_senha_nova')?.value || '').trim();
  const senhaConf  = (document.getElementById('ms_senha_conf')?.value || '').trim();
  const msg        = document.getElementById('senha-msg');

  if (!usuario || !senhaAtual || !senhaNova) { msg.textContent = 'Preencha todos os campos.'; return; }
  if (senhaNova !== senhaConf) { msg.textContent = 'As senhas não coincidem.'; return; }
  if (senhaNova.length < 8)   { msg.textContent = 'Senha muito curta (mín. 8 caracteres).'; return; }

  if (usuario === ADMIN_USER) {
    const adminSenha = localStorage.getItem(ADMIN_SENHA_KEY) || DEFAULT_ADMIN_SENHA;
    if (senhaAtual !== adminSenha) { msg.textContent = 'Senha atual incorreta.'; return; }
    localStorage.setItem(ADMIN_SENHA_KEY, senhaNova);
    msg.style.color = '#2d6a4f';
    msg.textContent = 'Senha alterada com sucesso!';
    setTimeout(fecharModalSenha, 1500);
    return;
  }

  try {
    const snap = await getDocs(query(collection(db, 'usuarios'), where('username', '==', usuario)));
    if (snap.empty) { msg.textContent = 'Usuário não encontrado.'; return; }
    const userData = snap.docs[0].data();
    if (userData.senha !== senhaAtual) { msg.textContent = 'Senha atual incorreta.'; return; }
    await updateDoc(doc(db, 'usuarios', snap.docs[0].id), { senha: senhaNova });
    msg.style.color = '#2d6a4f';
    msg.textContent = 'Senha alterada com sucesso!';
    setTimeout(fecharModalSenha, 1500);
  } catch (e) {
    msg.textContent = 'Erro ao alterar senha: ' + e.message;
  }
}

// Password change inside the app (Perfil tab)
async function trocarSenhaPerfil() {
  const senhaAtual = (document.getElementById('perfil_senha_atual')?.value || '').trim();
  const senhaNova  = (document.getElementById('perfil_senha_nova')?.value || '').trim();
  const senhaConf  = (document.getElementById('perfil_senha_conf')?.value || '').trim();

  if (!senhaAtual || !senhaNova) { alert('Preencha todos os campos.'); return; }
  if (senhaNova !== senhaConf)   { alert('As senhas não coincidem.'); return; }
  if (senhaNova.length < 8)     { alert('Senha muito curta (mín. 8 caracteres).'); return; }

  if (currentUser.username === ADMIN_USER) {
    const adminSenha = localStorage.getItem(ADMIN_SENHA_KEY) || DEFAULT_ADMIN_SENHA;
    if (senhaAtual !== adminSenha) { alert('Senha atual incorreta.'); return; }
    localStorage.setItem(ADMIN_SENHA_KEY, senhaNova);
    alert('Senha alterada com sucesso!');
    document.getElementById('perfil_senha_atual').value = '';
    document.getElementById('perfil_senha_nova').value  = '';
    document.getElementById('perfil_senha_conf').value  = '';
    return;
  }

  if (!currentUser.id) { alert('Não foi possível identificar o usuário atual.'); return; }
  try {
    await updateDoc(doc(db, 'usuarios', currentUser.id), { senha: senhaNova });
    alert('Senha alterada com sucesso!');
    document.getElementById('perfil_senha_atual').value = '';
    document.getElementById('perfil_senha_nova').value  = '';
    document.getElementById('perfil_senha_conf').value  = '';
  } catch (e) {
    alert('Erro ao alterar senha: ' + e.message);
  }
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function tab(id, btn) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const sec = document.getElementById(id);
  if (sec) sec.classList.add('active');
  if (btn) btn.classList.add('active');
}

// ─── Masks ────────────────────────────────────────────────────────────────────
function mascaraTel(i) {
  let v = i.value.replace(/\D/g, "");
  if (v.length <= 10) v = v.replace(/^(\d{2})(\d{4})(\d{0,4}).*/, "($1) $2-$3");
  else v = v.replace(/^(\d{2})(\d{5})(\d{0,4}).*/, "($1) $2-$3");
  i.value = v;
}

function mascaraDoc(i) {
  let v = i.value.replace(/\D/g, "");
  if (v.length <= 11) {
    v = v.replace(/(\d{3})(\d)/, "$1.$2");
    v = v.replace(/(\d{3})(\d)/, "$1.$2");
    v = v.replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  } else {
    v = v.replace(/^(\d{2})(\d)/, "$1.$2");
    v = v.replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3");
    v = v.replace(/\.(\d{3})(\d)/, ".$1/$2");
    v = v.replace(/(\d{4})(\d{1,2})$/, "$1-$2");
  }
  i.value = v;
}

function mascaraCEP(i) {
  let v = i.value.replace(/\D/g, "").slice(0, 8);
  v = v.replace(/(\d{5})(\d)/, "$1-$2");
  i.value = v;
}

async function autoCEP(v) {
  const cep = (v || '').replace(/\D/g, "");
  if (cep.length === 8) {
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const d = await r.json();
      if (!d.erro) {
        const endEl = document.getElementById('end');
        if (endEl) endEl.value = `${d.logradouro || ''}${d.bairro ? ', ' + d.bairro : ''}`;
      }
    } catch (e) { console.error(e); }
  }
}

// ─── Clientes ─────────────────────────────────────────────────────────────────
async function carregarClientesCache() {
  const snap = await getDocs(query(collection(db, "clientes"), orderBy("data", "desc")));
  const todos = [];
  snap.forEach(d => todos.push({ id: d.id, ...d.data() }));
  clientesCache = aplicarFiltroRole(todos);
  return clientesCache;
}

async function atualizarC() {
  const s     = document.getElementById('selC');
  const sp    = document.getElementById('selProgC');
  const sCObra= document.getElementById('selCObra');

  if (s)      s.innerHTML      = '<option value="">Selecionar Cliente...</option>';
  if (sp)     sp.innerHTML     = '<option value="">Selecionar Cliente...</option>';
  if (sCObra) sCObra.innerHTML = '<option value="">Selecionar cliente...</option>';

  await carregarClientesCache();

  clientesCache.forEach((c, i) => {
    if (s)      s.innerHTML      += `<option value="${c.id}">${esc(c.nome)}</option>`;
    if (sp)     sp.innerHTML     += `<option value="${c.id}">${esc(c.nome)}</option>`;
    if (sCObra) sCObra.innerHTML += `<option value="${c.id}">${esc(c.nome)}</option>`;
  });

  filtrarClientes();
}

function filtrarClientes() {
  const filtro = (document.getElementById('filtroCliente')?.value || '').toLowerCase();
  const l = document.getElementById('listaC');
  if (!l) return;
  l.innerHTML = '';
  clientesCache
    .filter(c => !filtro ||
      (c.nome || '').toLowerCase().includes(filtro) ||
      (c.doc  || '').toLowerCase().includes(filtro) ||
      (c.tel  || '').toLowerCase().includes(filtro))
    .forEach((c, i) => {
      l.innerHTML += `<tr>
        <td>${c.data || ''}</td>
        <td>${esc(c.nome || '')}</td>
        <td>${esc(c.doc || '')}</td>
        <td>${esc(c.tel || '')}</td>
        <td>${esc(c.end || '')}${c.num ? ', '+esc(c.num) : ''}${c.comp ? ' - '+esc(c.comp) : ''}</td>
        <td>${esc(c.filial || '')}</td>
        <td class="actions">
          <span onclick="editarC(${i})" title="Editar">✏️</span>
          <span onclick="excluirC('${c.id}')" title="Excluir">🗑️</span>
        </td>
      </tr>`;
    });
}

function editarC(i) {
  const c = clientesCache[i];
  if (!c) return;
  document.getElementById('nome').value  = c.nome  || '';
  document.getElementById('doc_c').value = c.doc   || '';
  document.getElementById('tel_c').value = c.tel   || '';
  document.getElementById('end').value   = c.end   || '';
  document.getElementById('num').value   = c.num   || '';
  document.getElementById('comp').value  = c.comp  || '';
  document.getElementById('cep').value   = c.cep   || '';
  document.getElementById('idx_c').value = i;
  document.getElementById('btn_cli').innerText = "ATUALIZAR";
}

function limparC() {
  document.getElementById('idx_c').value = "-1";
  document.getElementById('btn_cli').innerText = "SALVAR CLIENTE";
  ['nome','doc_c','tel_c','end','num','comp','cep'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

async function salvarC() {
  const idx  = document.getElementById('idx_c')?.value || "-1";
  const nome = (document.getElementById('nome')?.value || '').trim();
  if (!nome) return alert("Informe o nome do cliente!");

  const obj = {
    data:      new Date().toLocaleDateString('pt-BR'),
    nome,
    doc:       document.getElementById('doc_c')?.value  || '',
    tel:       document.getElementById('tel_c')?.value  || '',
    end:       document.getElementById('end')?.value    || '',
    num:       document.getElementById('num')?.value    || '',
    comp:      document.getElementById('comp')?.value   || '',
    cep:       document.getElementById('cep')?.value    || '',
    criadoPor: currentUser.username,
    filial:    (isAdmin() && currentUser.filial === 'Todas') ? 'Divinopolis' : currentUser.filial
  };

  try {
    if (idx === "-1") {
      await addDoc(collection(db, "clientes"), obj);
    } else {
      const refId = clientesCache[Number(idx)]?.id;
      if (!refId) return alert("Cliente não encontrado para atualização.");
      await updateDoc(doc(db, "clientes", refId), obj);
    }
    await atualizarC();
    limparC();
    alert("Cliente salvo!");
  } catch (err) {
    console.error(err);
    alert("Erro ao salvar cliente: " + err.message);
  }
}

async function excluirC(id) {
  if (!confirm("Excluir cliente?")) return;
  await deleteDoc(doc(db, "clientes", id));
  await atualizarC();
  await listarP();
  await listarProgramacoes();
}

// ─── Perfis (Vendedor) ────────────────────────────────────────────────────────
async function carregarPerfisCache() {
  const snap = await getDocs(query(collection(db, "perfis_vendedor"), orderBy("data", "desc")));
  perfisCache = [];
  snap.forEach(d => perfisCache.push({ id: d.id, ...d.data() }));
  perfisCache = filtrarPerfisRole(perfisCache);

  const selV = document.getElementById('selV');
  const filtroPerfil = document.getElementById('filtroPropostaPerfil');

  if (selV) {
    selV.innerHTML = '<option value="">Selecionar Perfil...</option>';
    perfisCache.forEach(p => {
      selV.innerHTML += `<option value="${p.id}">${p.nome || ''}</option>`;
    });
  }

  if (filtroPerfil) {
    filtroPerfil.innerHTML = '<option value="">Todos os perfis</option>';
    perfisCache.forEach(p => {
      filtroPerfil.innerHTML += `<option value="${p.nome || ''}">${p.nome || ''}</option>`;
    });
  }

  return perfisCache;
}

function filtrarPerfis() {
  const filtro = (document.getElementById('filtroPerfil')?.value || '').toLowerCase();
  const tbody = document.getElementById('listaV');
  if (!tbody) return;

  const vinculadoId = localStorage.getItem(PERFIL_VINCULADO_KEY);
  tbody.innerHTML = '';
  perfisCache
    .filter(p => !filtro || (p.nome || '').toLowerCase().includes(filtro) || (p.cel || '').toLowerCase().includes(filtro))
    .forEach((p, i) => {
      const filialInfo  = (isAdmin() && p.filial) ? ` <small style="color:#888">(${esc(p.filial)})</small>` : '';
      const podeAcao    = podeDeletarPerfil(p);
      const isVinculado = p.id === vinculadoId;
      tbody.innerHTML += `<tr${isVinculado ? ' style="background:#e8f5e9;"' : ''}>
        <td>${esc(p.nome || '')}${filialInfo}${isVinculado ? ' <small style="color:#27ae60">(✓ vinculado)</small>' : ''}</td>
        <td>${esc(p.cel || '')}</td>
        <td class="actions">
          ${podeAcao ? `<span onclick="editarPerfil(${i})" title="Editar">✏️</span>` : ''}
          <span onclick="vincularPerfilAoLayout(${i})" title="Vincular ao layout" style="cursor:pointer">🔗</span>
          ${podeAcao ? `<span onclick="excluirPerfil('${esc(p.id)}')" title="Excluir">🗑️</span>` : ''}
        </td>
      </tr>`;
    });
}

function vincularPerfilAoLayout(i) {
  const p = perfisCache[i];
  if (!p) return;
  localStorage.setItem(PERFIL_VINCULADO_KEY, p.id);
  const vn = document.getElementById('v_nome');
  const vc = document.getElementById('v_cel');
  if (vn) vn.value = p.nome || '';
  if (vc) vc.value = p.cel  || '';
  filtrarPerfis();
  alert(`Perfil "${p.nome}" vinculado ao layout da proposta!`);
}

function editarPerfil(i) {
  const p = perfisCache[i];
  if (!p) return;
  const vn = document.getElementById('v_nome');
  const vc = document.getElementById('v_cel');
  const iv = document.getElementById('idx_v');
  if (vn) vn.value = p.nome || '';
  if (vc) vc.value = p.cel  || '';
  if (iv) iv.value = i;
}

function limparPerfil() {
  const iv = document.getElementById('idx_v');
  const vn = document.getElementById('v_nome');
  const vc = document.getElementById('v_cel');
  if (iv) iv.value = '-1';
  if (vn) vn.value = '';
  if (vc) vc.value = '';
}

async function salvarV() {
  if (!currentUser) return alert("Sessão inválida. Faça login novamente.");
  const idx = document.getElementById('idx_v')?.value || '-1';
  const obj = {
    data: new Date().toLocaleDateString('pt-BR'),
    nome: document.getElementById('v_nome')?.value || '',
    cel:  document.getElementById('v_cel')?.value  || ''
  };

  if (!obj.nome) return alert("Informe o nome do perfil!");

  if (idx === '-1') {
    // New profile: record creator metadata
    obj.criadoPor = currentUser.username;
    obj.filial    = currentUser.filial || '';
    obj.role      = currentUser.role   || '';
    await addDoc(collection(db, "perfis_vendedor"), obj);
  } else {
    const existing = perfisCache[Number(idx)];
    const refId = existing?.id;
    if (!refId) return alert("Perfil não encontrado para atualização.");
    if (!podeDeletarPerfil(existing)) return alert("Sem permissão para editar este perfil.");
    await updateDoc(doc(db, "perfis_vendedor", refId), obj);
  }

  await carregarPerfisCache();
  filtrarPerfis();
  limparPerfil();
  alert("Perfil salvo!");
}

async function excluirPerfil(id) {
  if (!confirm("Excluir perfil?")) return;
  const p = perfisCache.find(item => item.id === id);
  if (p && !podeDeletarPerfil(p)) return alert("Sem permissão para excluir este perfil.");
  await deleteDoc(doc(db, "perfis_vendedor", id));
  await carregarPerfisCache();
  filtrarPerfis();
}

async function carregarVendedor() {
  const snap = await getDoc(doc(db, "perfil_vendedor", "principal"));
  if (snap.exists()) {
    const v = snap.data();
    const vn = document.getElementById('v_nome');
    const vc = document.getElementById('v_cel');
    if (vn) vn.value = v.nome || '';
    if (vc) vc.value = v.cel  || '';
  }
}

// ─── Propostas ────────────────────────────────────────────────────────────────
async function atualizarDadosClienteProposta() {
  const cliId = document.getElementById('selC')?.value;
  const cli   = clientesCache.find(c => c.id === cliId) || {};
  const cn    = document.getElementById('prop_cnpj');
  const ct    = document.getElementById('prop_tel');
  if (cn) cn.value = cli.doc || '';
  if (ct) ct.value = cli.tel || '';

  // Load obras for this client
  const selObra = document.getElementById('selObra');
  if (selObra) {
    selObra.innerHTML = '<option value="">— Selecionar Obra (opcional) —</option>';
    if (cliId) {
      try {
        const snap = await getDocs(query(collection(db, 'obras'), where('clienteId', '==', cliId)));
        snap.forEach(d => {
          const o = d.data();
          const endParts = [o.end || '', o.num || '', o.comp || ''].filter(Boolean);
          selObra.innerHTML += `<option value="${esc(d.id)}" data-end="${esc(endParts.join(', '))}">${esc(o.nome||'')}</option>`;
        });
      } catch(e) { console.error(e); }
    }
  }
}

function atualizarEnderecoObra() {
  const selObra = document.getElementById('selObra');
  if (!selObra) return;
  const opt = selObra.options[selObra.selectedIndex];
  if (opt && opt.dataset.end) {
    const endEl = document.getElementById('prop_end_obra');
    if (endEl) endEl.textContent = opt.dataset.end.trim();
  }
}

function addLinha() {
  const volume = parseFloat(document.getElementById('volume')?.value) || 0;
  const base   = parseFloat(document.getElementById('vBase')?.value)  || 0;
  const margem = parseFloat(document.getElementById('margem')?.value) || 0;
  if (volume <= 0) return alert("Insira o volume!");
  if (base   <= 0) return alert("Insira um valor base!");
  const item = {
    volume,
    fck:   document.getElementById('fck')?.value   || '',
    brita: document.getElementById('brita')?.value || '',
    slump: document.getElementById('slump')?.value || '120±20',
    preco: base * (1 + margem / 100)
  };
  const idxItem = parseInt(document.getElementById('idx_item')?.value || '-1');
  if (idxItem >= 0 && idxItem < itensProposta.length) {
    itensProposta[idxItem] = item;
    document.getElementById('idx_item').value = '-1';
    const btnAdd = document.getElementById('btn_add_item');
    if (btnAdd) btnAdd.textContent = '+ ADICIONAR ITEM';
  } else {
    itensProposta.push(item);
  }
  document.getElementById('volume').value = '';
  document.getElementById('vBase').value  = '';
  document.getElementById('margem').value = '0';
  renderItens();
}

function editarItem(i) {
  const it = itensProposta[i];
  if (!it) return;
  document.getElementById('volume').value = it.volume || '';
  document.getElementById('fck').value    = it.fck    || '';
  document.getElementById('brita').value  = it.brita  || '';
  document.getElementById('slump').value  = it.slump  || '120±20';
  const preco = parseFloat(it.preco) || 0;
  document.getElementById('vBase').value  = preco.toFixed(2);
  document.getElementById('margem').value = '0';
  document.getElementById('idx_item').value = i;
  const btnAdd = document.getElementById('btn_add_item');
  if (btnAdd) btnAdd.textContent = '✏️ ATUALIZAR ITEM';
}

function renderItens() {
  const t = document.getElementById('itensTmp');
  if (!t) return;
  t.innerHTML = '';
  itensProposta.forEach((it, i) => {
    t.innerHTML += `<tr>
      <td>${esc(it.volume)}</td>
      <td>${esc(it.fck)}</td>
      <td>${esc(it.brita)}</td>
      <td>${esc(it.slump || '120±20')}</td>
      <td>R$ ${esc(Number(it.preco).toFixed(2))}</td>
      <td>
        <span onclick="editarItem(${i})" style="cursor:pointer" title="Editar">✏️</span>
        <span onclick="removerItem(${i})" style="cursor:pointer" title="Remover">❌</span>
      </td>
    </tr>`;
  });
}

function removerItem(i) {
  itensProposta.splice(i, 1);
  renderItens();
}

async function salvarP() {
  const cliente = document.getElementById('selC')?.value || '';
  if (!cliente) return alert("Selecione um cliente!");
  if (itensProposta.length === 0) return alert("Adicione itens!");

  const perfilId = document.getElementById('selV')?.value || '';
  const perfil   = perfisCache.find(p => p.id === perfilId) || {};

  const filialVal = isAdmin()
    ? (document.getElementById('filial')?.value || currentUser.filial)
    : currentUser.filial;

  const obj = {
    data:       new Date().toLocaleDateString('pt-BR'),
    cliId:      cliente,
    perfilId,
    perfilNome: perfil.nome || '',
    status:     document.getElementById('status')?.value || 'andamento',
    itens:      [...itensProposta],
    resp:       document.getElementById('contato_obra')?.value || '',
    filial:     filialVal,
    obs:        document.getElementById('obs')?.value || '',
    motivoPerda: (document.getElementById('status')?.value === 'perdida')
                  ? (document.getElementById('motivo_perda')?.value || '')
                  : '',
    criadoPor:  currentUser.username,
    cfg: {
      b:   document.getElementById('cfg_bomba')?.value   || '',
      mb:  document.getElementById('cfg_min_b')?.value   || '',
      f:   document.getElementById('cfg_fibra')?.value   || '',
      fal: document.getElementById('cfg_faltante')?.value|| '',
      p:   document.getElementById('cfg_perm')?.value    || '',
      rac: document.getElementById('cfg_rac')?.value     || '',
      roc: document.getElementById('cfg_roc')?.value     || '',
      prz: document.getElementById('cfg_prazo')?.value   || '',
      hu:  document.getElementById('cfg_h_uteis')?.value || '',
      hs:  document.getElementById('cfg_h_sab')?.value   || '',
      hd:  document.getElementById('cfg_h_dom')?.value   || '',
      md:  document.getElementById('cfg_min_dom')?.value || ''
    }
  };
  const obraId  = document.getElementById('selObra')?.value || '';
  const obraEl  = document.getElementById('selObra');
  const obraTxt = obraEl?.options[obraEl.selectedIndex]?.text || '';
  obj.obraId   = obraId;
  obj.obraNome = (obraId && obraTxt !== '— Selecionar Obra (opcional) —') ? obraTxt : '';

  const idx = document.getElementById('idx_p')?.value || "-1";
  if (idx === "-1") {
    // Generate next sequential proposal number atomically
    const counterRef = doc(db, "config", "contadores");
    let numeroProposta;
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(counterRef);
      const current = snap.exists() ? (snap.data().numeroProposta || 0) : 0;
      numeroProposta = current + 1;
      transaction.set(counterRef, { numeroProposta }, { merge: true });
    });
    obj.numeroProposta = numeroProposta;
    await addDoc(collection(db, "propostas"), obj);
    // Show the assigned number in the form
    const numEl = document.getElementById('display_numero_proposta');
    if (numEl) numEl.value = formatNumeroProposta(numeroProposta);
  } else {
    const refId = propostasCache[Number(idx)]?.id;
    if (!refId) return alert("Proposta não encontrada para atualizar.");
    // Preserve the original proposal number on updates
    const existing = propostasCache[Number(idx)];
    if (existing?.numeroProposta) obj.numeroProposta = existing.numeroProposta;
    await updateDoc(doc(db, "propostas", refId), obj);
  }

  await listarP();
  popularSelectProposta();
  alert("Proposta salva!");
}

async function listarP() {
  const dbP = document.getElementById('listaP');
  if (dbP) dbP.innerHTML = '';
  const snap = await getDocs(query(collection(db, "propostas"), orderBy("data", "desc")));
  const todos = [];
  snap.forEach(d => todos.push({ id: d.id, ...d.data() }));
  propostasCache = aplicarFiltroRole(todos);
  filtrarPropostas();
}

function filtrarPropostas() {
  const filtroCliente = (document.getElementById('filtroPropostaCliente')?.value || '').toLowerCase();
  const filtroPerfil  = document.getElementById('filtroPropostaPerfil')?.value || '';
  const filtroStatus  = document.getElementById('filtroPropostaStatus')?.value || '';
  const l = document.getElementById('listaP');
  if (!l) return;

  l.innerHTML = '';
  propostasCache
    .filter(p => {
      const cli = clientesCache.find(c => c.id === p.cliId);
      const nomeCli   = (cli?.nome || '').toLowerCase();
      const perfilNome = p.perfilNome || '';
      const status     = p.status    || '';
      return (
        (!filtroCliente || nomeCli.includes(filtroCliente)) &&
        (!filtroPerfil  || perfilNome === filtroPerfil) &&
        (!filtroStatus  || status === filtroStatus)
      );
    })
    .forEach((p, i) => {
      const cli      = clientesCache.find(c => c.id === p.cliId);
      const nomeCli  = cli ? cli.nome : "Excluído";
      const volTotal = (p.itens || []).reduce((acc, it) => acc + (parseFloat(it.volume) || 0), 0);
      const valTotal = calcReceitaProposta(p);
      const obraNome = p.obraNome || '—';
      l.innerHTML += `<tr>
        <td>${formatNumeroProposta(p.numeroProposta)}</td>
        <td>${p.data || ''}</td>
        <td>${esc(nomeCli)}</td>
        <td>${esc(obraNome)}</td>
        <td>${esc(p.perfilNome || '—')}</td>
        <td>${esc(p.filial || '—')}</td>
        <td>${volTotal.toFixed(1)} m³</td>
        <td>R$ ${fmtBRL(valTotal)}</td>
        <td><span class="badge bg-${p.status}">${p.status}</span></td>
        <td class="actions">
          <span onclick="editarP(${i})" title="Editar">✏️</span>
          <span onclick="excluirP('${p.id}')" title="Excluir">🗑️</span>
        </td>
      </tr>`;
    });
}

function editarP(i) {
  const p = propostasCache[i];
  if (!p) return;
  document.getElementById('selC').value            = p.cliId  || '';
  document.getElementById('selV').value            = p.perfilId || '';
  document.getElementById('status').value          = p.status || 'andamento';
  document.getElementById('contato_obra').value    = p.resp   || '';
  if (isAdmin()) document.getElementById('filial').value = p.filial || 'Divinopolis';
  document.getElementById('obs').value             = p.obs    || '';
  const mpEl = document.getElementById('motivo_perda');
  if (mpEl) mpEl.value = p.motivoPerda || '';
  alternarMotivPerda(p.status || 'andamento');
  itensProposta = [...(p.itens || [])];
  renderItens();

  if (p.cfg) {
    document.getElementById('cfg_bomba').value   = p.cfg.b   || '';
    document.getElementById('cfg_min_b').value   = p.cfg.mb  || '';
    document.getElementById('cfg_fibra').value   = p.cfg.f   || '';
    document.getElementById('cfg_faltante').value= p.cfg.fal || '';
    document.getElementById('cfg_perm').value    = p.cfg.p   || '';
    document.getElementById('cfg_rac').value     = p.cfg.rac || '';
    document.getElementById('cfg_roc').value     = p.cfg.roc || '';
    document.getElementById('cfg_prazo').value   = p.cfg.prz || '';
    document.getElementById('cfg_h_uteis').value = p.cfg.hu  || '';
    document.getElementById('cfg_h_sab').value   = p.cfg.hs  || '';
    document.getElementById('cfg_h_dom').value   = p.cfg.hd  || '';
    document.getElementById('cfg_min_dom').value = p.cfg.md  || '';
  }

  document.getElementById('idx_p').value = i;
  document.getElementById('btn_prop').innerText = "ATUALIZAR";

  const numEl = document.getElementById('display_numero_proposta');
  if (numEl) {
    numEl.value = formatNumeroProposta(p.numeroProposta);
  }

  // Reload obras for this client then set the selected obra
  if (document.getElementById('selObra')) {
    atualizarDadosClienteProposta().then(() => {
      const selObra = document.getElementById('selObra');
      if (selObra && p.obraId) selObra.value = p.obraId;
    });
  }
}

async function excluirP(id) {
  if (confirm("Excluir proposta?")) {
    await deleteDoc(doc(db, "propostas", id));
    await listarP();
    popularSelectProposta();
  }
}

// ─── Programação ──────────────────────────────────────────────────────────────
async function salvarProgramacao() {
  const filialVal = currentUser.filial;

  const obj = {
    data:          new Date().toLocaleDateString('pt-BR'),
    data_evento:   document.getElementById('prog_data_evento')?.value   || '',
    horario_evento:document.getElementById('prog_horario_evento')?.value|| '',
    cliId:         document.getElementById('selProgC')?.value         || '',
    obra_nome:     document.getElementById('prog_obra_nome')?.value   || '',
    contrato:     document.getElementById('prog_contrato')?.value    || '',
    solicitante:  document.getElementById('prog_solicitante')?.value || '',
    cno:          document.getElementById('prog_cno')?.value         || '',
    email:        document.getElementById('prog_email')?.value       || '',
    contato_obra: document.getElementById('prog_contato_obra')?.value|| '',
    volume:       document.getElementById('prog_volume')?.value      || '',
    fck:          document.getElementById('prog_fck')?.value         || '',
    slp:          document.getElementById('prog_slp')?.value         || '',
    brita:        document.getElementById('prog_brita')?.value       || '',
    preco:        document.getElementById('prog_preco')?.value       || '',
    bomba:        document.getElementById('prog_bomba')?.value       || '',
    pagamento:    document.getElementById('prog_pagamento')?.value   || '',
    end_obra:     document.getElementById('prog_end_obra')?.value    || '',
    obs:          document.getElementById('prog_obs')?.value         || '',
    criadoPor:    currentUser.username,
    filial:       filialVal
  };

  const idx = document.getElementById('idx_prog')?.value || "-1";
  if (idx === "-1") {
    await addDoc(collection(db, "programacoes"), obj);
  } else {
    const refId = programacoesCache[Number(idx)]?.id;
    if (!refId) return alert("Programação não encontrada para atualizar.");
    await updateDoc(doc(db, "programacoes", refId), obj);
  }

  await listarProgramacoes();
  alert("Programação salva!");
}

async function listarProgramacoes() {
  const l = document.getElementById('listaProg');
  if (l) l.innerHTML = '';
  const snap = await getDocs(query(collection(db, "programacoes"), orderBy("data", "desc")));
  const todos = [];
  snap.forEach(d => todos.push({ id: d.id, ...d.data() }));
  programacoesCache = aplicarFiltroRole(todos);

  for (let i = 0; i < programacoesCache.length; i++) {
    const p = programacoesCache[i];
    const cli = clientesCache.find(c => c.id === p.cliId);
    const nomeCli = cli ? cli.nome : "Excluído";
    if (l) l.innerHTML += `<tr>
      <td>${p.data || ''}</td>
      <td>${nomeCli}</td>
      <td>${p.obra_nome || ''}</td>
      <td class="actions">
        <span onclick="editarProgramacao(${i})" title="Editar">✏️</span>
        <span onclick="excluirProgramacao('${p.id}')" title="Excluir">🗑️</span>
      </td>
    </tr>`;
  }
  atualizarExtratoProgramacao();
}

function editarProgramacao(i) {
  const p = programacoesCache[i];
  if (!p) return;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  set('selProgC',          p.cliId          || '');
  set('prog_data_evento',  p.data_evento    || '');
  set('prog_horario_evento', p.horario_evento || '');
  set('prog_obra_nome',    p.obra_nome       || '');
  set('prog_contrato',     p.contrato        || '');
  set('prog_solicitante',  p.solicitante     || '');
  set('prog_cno',          p.cno             || '');
  set('prog_email',        p.email           || '');
  set('prog_contato_obra', p.contato_obra    || '');
  set('prog_volume',       p.volume          || '');
  set('prog_fck',          p.fck             || '');
  set('prog_slp',          p.slp             || '');
  set('prog_brita',        p.brita           || '');
  set('prog_preco',        p.preco           || '');
  set('prog_bomba',        p.bomba           || '');
  set('prog_pagamento',    p.pagamento       || '');
  set('prog_end_obra',     p.end_obra        || '');
  set('prog_obs',          p.obs             || '');
  set('idx_prog',          i);
  atualizarExtratoProgramacao();
}

async function excluirProgramacao(id) {
  if (confirm("Excluir programação?")) {
    await deleteDoc(doc(db, "programacoes", id));
    await listarProgramacoes();
  }
}

async function carregarClienteProgramacao() {
  atualizarExtratoProgramacao();
}

function popularSelectProposta() {
  const sel = document.getElementById('selPropostaProg');
  if (!sel) return;
  const valorAtual = sel.value;
  sel.innerHTML = '<option value="">— Selecionar Proposta —</option>';
  propostasCache.forEach((p, i) => {
    const cli = clientesCache.find(c => c.id === p.cliId);
    const nomeCli = cli ? cli.nome : 'Excluído';
    const num = p.numeroProposta ? formatNumeroProposta(p.numeroProposta) + ' - ' : '';
    sel.innerHTML += `<option value="${i}">${num}${nomeCli} (${p.data || ''})</option>`;
  });
  if (valorAtual !== '') sel.value = valorAtual;
}

function carregarPropostaNaProgramacao(idx) {
  if (idx === '' || idx === null || idx === undefined) return;
  const p = propostasCache[Number(idx)];
  if (!p) return;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };

  // Cliente
  set('selProgC', p.cliId || '');

  // Responsável da obra
  if (p.resp) set('prog_contato_obra', p.resp);

  // Observações
  if (p.obs) set('prog_obs', p.obs);

  // Show all items
  propostaItensTemp = p.itens || [];
  const container = document.getElementById('prog_itens_container');
  const lista = document.getElementById('prog_itens_lista');
  if (container && lista && propostaItensTemp.length > 0) {
    container.style.display = 'block';
    lista.innerHTML = '';
    propostaItensTemp.forEach((it, i) => {
      const preco = parseFloat(it.preco) || 0;
      lista.innerHTML += `<div style="background:white; border:1px solid #ddd; border-radius:4px; padding:10px; margin-top:8px; display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
        <span style="font-size:0.8rem;"><strong>Vol:</strong> ${esc(String(it.volume))} m³</span>
        <span style="font-size:0.8rem;"><strong>FCK:</strong> ${esc(it.fck||'')}</span>
        <span style="font-size:0.8rem;"><strong>Brita:</strong> ${esc(it.brita||'')}</span>
        <span style="font-size:0.8rem;"><strong>Slump:</strong> ${esc(it.slump||'120±20')}</span>
        <span style="font-size:0.8rem;"><strong>Valor:</strong> R$ ${preco.toFixed(2).replace('.',',')}</span>
        <button class="btn" style="font-size:0.75rem; padding:6px 10px; width:auto; margin:0;" onclick="usarItemProgramacao(${i})">📋 Usar</button>
      </div>`;
    });
  } else if (container) {
    container.style.display = 'none';
  }

  // Load first item by default
  if (propostaItensTemp.length > 0) {
    const totalVol = propostaItensTemp.reduce((acc, it) => acc + (parseFloat(it.volume) || 0), 0);
    set('prog_volume', totalVol > 0 ? totalVol.toString() : '');
    const item0 = propostaItensTemp[0];
    if (item0.fck)   set('prog_fck',   item0.fck);
    if (item0.brita) set('prog_brita', item0.brita);
    if (item0.slump) set('prog_slp',   item0.slump);
    const preco = parseFloat(item0.preco);
    if (!isNaN(preco)) set('prog_preco', preco.toFixed(2).replace('.', ','));
  }

  // Bomba e pagamento das configurações
  if (p.cfg) {
    if (p.cfg.b)   set('prog_bomba',    p.cfg.b);
    if (p.cfg.prz) set('prog_pagamento', p.cfg.prz);
  }

  atualizarExtratoProgramacao();
}

function usarItemProgramacao(i) {
  const item = propostaItensTemp[i];
  if (!item) return;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  set('prog_volume', item.volume || '');
  set('prog_fck',    item.fck    || '');
  set('prog_brita',  item.brita  || '');
  set('prog_slp',    item.slump  || '120±20');
  const preco = parseFloat(item.preco) || 0;
  set('prog_preco', preco.toFixed(2).replace('.', ','));
  atualizarExtratoProgramacao();
}

function atualizarExtratoProgramacao() {
  const cliId = document.getElementById('selProgC')?.value || '';
  const cli   = clientesCache.find(c => c.id === cliId) || {};
  const get   = id => document.getElementById(id)?.value || '';
  const set   = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };

  set('pp_obra_nome',   get('prog_obra_nome'));
  set('pp_contrato',    get('prog_contrato'));
  set('pp_cliente',     cli.nome || '');
  set('pp_cnpj',        cli.doc  || '');
  set('pp_end_cliente', `${cli.end || ''}${cli.num ? ', ' + cli.num : ''}${cli.comp ? ' - ' + cli.comp : ''}`);
  set('pp_cno',         get('prog_cno'));
  set('pp_email',       get('prog_email'));
  set('pp_contato_obra',get('prog_contato_obra'));
  set('pp_solicitante', get('prog_solicitante'));
  set('pp_end_obra',    get('prog_end_obra'));
  set('pp_fck',         get('prog_fck'));
  set('pp_slp',         get('prog_slp'));
  set('pp_brita',       get('prog_brita'));
  set('pp_preco',       get('prog_preco'));
  set('pp_bomba',       get('prog_bomba'));
  set('pp_volume',      get('prog_volume'));
  set('pp_pagamento',   get('prog_pagamento'));
  set('pp_obs',         get('prog_obs'));

  // date/time for event
  const dataEvento   = get('prog_data_evento');
  const horarioEvento = get('prog_horario_evento');
  if (dataEvento) {
    const [y, m, d] = dataEvento.split('-');
    set('pp_data_evento', `${d}/${m}/${y}`);
  } else {
    set('pp_data_evento', '');
  }
  set('pp_horario_evento', horarioEvento);
}

// ─── Usuários ─────────────────────────────────────────────────────────────────
async function carregarUsuarios() {
  if (!podeGerenciarUsuarios()) return;
  const snap = await getDocs(query(collection(db, "usuarios"), orderBy("nome", "asc")));
  const todos = [];
  snap.forEach(d => todos.push({ id: d.id, ...d.data() }));

  // Admin não vê outros admins; Gerente vê só usuários da sua filial
  if (isAdmin()) {
    usuariosCache = todos.filter(u => u.role !== 'administrador');
  } else {
    usuariosCache = todos.filter(u => u.filial === currentUser.filial);
  }

  const l = document.getElementById('listaU');
  if (!l) return;
  l.innerHTML = '';
  usuariosCache.forEach((u, i) => {
    const roleClass = `role-${u.role || 'consultor_comercial'}`;
    const ativo     = u.ativo !== false;
    const rowStyle  = ativo ? '' : ' style="opacity:0.5;"';
    l.innerHTML += `<tr${rowStyle}>
      <td>${esc(u.nome || '')}</td>
      <td>${esc(u.username || '')}</td>
      <td><span class="role-badge ${roleClass}">${labelRole(u.role)}</span></td>
      <td>${esc(u.filial || '')}</td>
      <td>${ativo ? '<span style="color:#27ae60">✅ Ativo</span>' : '<span style="color:#e74c3c">🚫 Inativo</span>'}</td>
      <td class="actions">
        <span onclick="editarUsuario(${i})" title="Editar">✏️</span>
        ${ativo
          ? `<span onclick="pedirSenhaParaInativar('${esc(u.id)}')" title="Tornar Inativo" aria-label="Tornar Inativo" style="cursor:pointer">🚫</span>`
          : `<span onclick="reativarUsuario('${esc(u.id)}')" title="Reativar" aria-label="Reativar" style="cursor:pointer">✅</span>`
        }
      </td>
    </tr>`;
  });
}

function editarUsuario(i) {
  const u = usuariosCache[i];
  if (!u) return;
  document.getElementById('u_nome').value     = u.nome     || '';
  document.getElementById('u_username').value = u.username || '';
  document.getElementById('u_senha').value    = '';
  document.getElementById('u_role').value     = u.role     || 'consultor_comercial';
  if (isAdmin()) document.getElementById('u_filial').value = u.filial || 'Divinopolis';
  document.getElementById('idx_u').value = i;
  document.getElementById('btn_usuario').innerText = 'ATUALIZAR USUÁRIO';
}

function limparUsuario() {
  document.getElementById('idx_u').value      = '-1';
  document.getElementById('u_nome').value     = '';
  document.getElementById('u_username').value = '';
  document.getElementById('u_senha').value    = '';
  document.getElementById('u_role').value     = 'consultor_comercial';
  document.getElementById('btn_usuario').innerText = 'SALVAR USUÁRIO';
}

async function salvarUsuario() {
  if (!podeGerenciarUsuarios()) return alert("Sem permissão.");

  const idx      = document.getElementById('idx_u')?.value || '-1';
  const nome     = (document.getElementById('u_nome')?.value || '').trim();
  const username = (document.getElementById('u_username')?.value || '').trim().toLowerCase();
  const senha    = (document.getElementById('u_senha')?.value || '').trim();
  const role     = document.getElementById('u_role')?.value || 'consultor_comercial';
  const filial   = isAdmin()
    ? (document.getElementById('u_filial')?.value || currentUser.filial)
    : currentUser.filial;

  if (!nome || !username) return alert("Informe nome e usuário.");
  if (idx === '-1' && !senha) return alert("Informe a senha para o novo usuário.");
  if (username === ADMIN_USER) return alert("Nome de usuário reservado.");

  // Validate admin-only restriction
  if (!isAdmin() && role === 'administrador') return alert("Sem permissão para criar administradores.");

  const obj = { nome, username, role, filial };
  if (senha) obj.senha = senha;

  if (idx === '-1') {
    // Check uniqueness
    const exists = await getDocs(query(collection(db, 'usuarios'), where('username', '==', username)));
    if (!exists.empty) return alert("Este usuário já existe.");
    await addDoc(collection(db, "usuarios"), obj);
  } else {
    const refId = usuariosCache[Number(idx)]?.id;
    if (!refId) return alert("Usuário não encontrado para atualização.");
    await updateDoc(doc(db, "usuarios", refId), obj);
  }

  await carregarUsuarios();
  limparUsuario();
  alert("Usuário salvo!");
}

async function excluirUsuario(id) {
  if (!podeGerenciarUsuarios()) return;
  if (confirm("Excluir usuário?")) {
    await deleteDoc(doc(db, "usuarios", id));
    await carregarUsuarios();
  }
}

// ─── User Inactivation ────────────────────────────────────────────────────────
function pedirSenhaParaInativar(id) {
  _pendingInactivateId = id;
  const senhaEl = document.getElementById('modal_conf_senha');
  const erroEl  = document.getElementById('modal-conf-erro');
  if (senhaEl) senhaEl.value = '';
  if (erroEl)  erroEl.textContent = '';
  const modal = document.getElementById('modal-confirmar-senha');
  if (modal) modal.style.display = 'flex';
}

function fecharModalConfirmarSenha() {
  const modal = document.getElementById('modal-confirmar-senha');
  if (modal) modal.style.display = 'none';
  _pendingInactivateId = null;
}

async function confirmarOperacaoComSenha() {
  const senha  = (document.getElementById('modal_conf_senha')?.value || '').trim();
  const erroEl = document.getElementById('modal-conf-erro');
  if (!senha) { if (erroEl) erroEl.textContent = 'Informe sua senha.'; return; }

  let senhaCorreta = false;
  if (currentUser.username === ADMIN_USER) {
    const adminSenha = localStorage.getItem(ADMIN_SENHA_KEY) || DEFAULT_ADMIN_SENHA;
    senhaCorreta = senha === adminSenha;
  } else if (currentUser.id) {
    try {
      const snap = await getDoc(doc(db, 'usuarios', currentUser.id));
      if (snap.exists()) senhaCorreta = snap.data().senha === senha;
    } catch (e) {
      if (erroEl) erroEl.textContent = 'Erro ao verificar senha.';
      return;
    }
  }

  if (!senhaCorreta) {
    if (erroEl) erroEl.textContent = 'Senha incorreta.';
    return;
  }

  fecharModalConfirmarSenha();
  if (_pendingInactivateId) await inativarUsuario(_pendingInactivateId);
}

async function inativarUsuario(id) {
  try {
    await updateDoc(doc(db, 'usuarios', id), { ativo: false });
    await carregarUsuarios();
    alert('Usuário tornado inativo com sucesso!');
  } catch (e) {
    alert('Erro ao inativar usuário: ' + e.message);
  }
}

async function reativarUsuario(id) {
  if (!confirm("Reativar este usuário?")) return;
  try {
    await updateDoc(doc(db, 'usuarios', id), { ativo: true });
    await carregarUsuarios();
    alert('Usuário reativado!');
  } catch (e) {
    alert('Erro ao reativar usuário: ' + e.message);
  }
}

// ─── Obras ────────────────────────────────────────────────────────────────────
async function autoCEPObra(v) {
  const cep = (v || '').replace(/\D/g, "");
  if (cep.length === 8) {
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const d = await r.json();
      if (!d.erro) {
        const endEl = document.getElementById('obra_end');
        if (endEl) {
          const parts = [d.logradouro || '', d.bairro || ''].filter(Boolean);
          endEl.value = parts.join(', ');
        }
      }
    } catch (e) { console.error(e); }
  }
}

async function carregarObrasCliente(cliId) {
  const l = document.getElementById('listaObras');
  if (l) l.innerHTML = '';
  obrasCache = [];
  if (!cliId) return;
  try {
    const snap = await getDocs(query(collection(db, "obras"), where("clienteId", "==", cliId), orderBy("data", "desc")));
    snap.forEach(d => obrasCache.push({ id: d.id, ...d.data() }));
  } catch(e) { console.error(e); }
  atualizarListaObras();
}

function atualizarListaObras() {
  const l = document.getElementById('listaObras');
  if (!l) return;
  l.innerHTML = '';
  if (!obrasCache.length) {
    l.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#888;">Nenhuma obra cadastrada.</td></tr>';
    return;
  }
  obrasCache.forEach((o, i) => {
    l.innerHTML += `<tr>
      <td>${esc(o.nome || '')}</td>
      <td>${esc(o.end || '')}${o.num ? ', ' + esc(o.num) : ''}${o.comp ? ' - ' + esc(o.comp) : ''}</td>
      <td>${esc(o.cep || '')}</td>
      <td class="actions">
        <span onclick="editarObra(${i})" title="Editar">✏️</span>
        <span onclick="excluirObra('${esc(o.id)}')" title="Excluir">🗑️</span>
      </td>
    </tr>`;
  });
}

function editarObra(i) {
  const o = obrasCache[i];
  if (!o) return;
  document.getElementById('obra_nome').value = o.nome || '';
  document.getElementById('obra_cep').value  = o.cep  || '';
  document.getElementById('obra_end').value  = o.end  || '';
  document.getElementById('obra_num').value  = o.num  || '';
  document.getElementById('obra_comp').value = o.comp || '';
  document.getElementById('idx_obra').value  = i;
  document.getElementById('btn_obra').innerText = 'ATUALIZAR OBRA';
}

function limparObra() {
  ['obra_nome','obra_cep','obra_end','obra_num','obra_comp'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('idx_obra').value = '-1';
  document.getElementById('btn_obra').innerText = 'SALVAR OBRA';
}

async function salvarObra() {
  const cliId = document.getElementById('selCObra')?.value || '';
  if (!cliId) return alert("Selecione um cliente para a obra!");
  const nome = (document.getElementById('obra_nome')?.value || '').trim();
  if (!nome) return alert("Informe o nome/descrição da obra!");
  const idx = document.getElementById('idx_obra')?.value || '-1';
  const obj = {
    clienteId: cliId,
    nome,
    cep:       document.getElementById('obra_cep')?.value  || '',
    end:       document.getElementById('obra_end')?.value  || '',
    num:       document.getElementById('obra_num')?.value  || '',
    comp:      document.getElementById('obra_comp')?.value || '',
    data:      new Date().toLocaleDateString('pt-BR'),
    criadoPor: currentUser.username,
    filial:    currentUser.filial || ''
  };
  try {
    if (idx === '-1') {
      await addDoc(collection(db, "obras"), obj);
    } else {
      const refId = obrasCache[Number(idx)]?.id;
      if (!refId) return alert("Obra não encontrada para atualizar.");
      await updateDoc(doc(db, "obras", refId), obj);
    }
    await carregarObrasCliente(cliId);
    limparObra();
    alert("Obra salva!");
  } catch (err) {
    alert("Erro ao salvar obra: " + err.message);
  }
}

async function excluirObra(id) {
  if (!confirm("Excluir obra?")) return;
  try {
    await deleteDoc(doc(db, "obras", id));
    const cliId = document.getElementById('selCObra')?.value || '';
    await carregarObrasCliente(cliId);
  } catch(e) { alert("Erro ao excluir obra: " + e.message); }
}

// ─── Print / Export ───────────────────────────────────────────────────────────
function _preencherDocumentoImpressao() {
  const cliId = document.getElementById('selC')?.value || '';
  if (!cliId || itensProposta.length === 0) {
    alert("Selecione o cliente e adicione itens!");
    return false;
  }

  const cli   = clientesCache.find(c => c.id === cliId) || {};
  const vNome = document.getElementById('v_nome')?.value || '';
  const vCel  = document.getElementById('v_cel')?.value  || '';

  // Empresa info in print header
  const setElementText = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
  setElementText('p_emp_razao', empresaCache.razaoSocial || '');
  setElementText('p_emp_cnpj',  empresaCache.cnpj  ? 'CNPJ: ' + empresaCache.cnpj  : '');
  setElementText('p_emp_end',   empresaCache.endereco || '');
  setElementText('p_emp_tel',   empresaCache.telefone ? 'Tel: ' + empresaCache.telefone : '');
  setElementText('p_emp_email', empresaCache.email || '');

  document.getElementById('p_cidade').innerText     = (document.getElementById('filial')?.value || currentUser.filial);
  document.getElementById('p_data').innerText       = new Date().toLocaleDateString('pt-BR');
  document.getElementById('p_cliente').innerText    = (cli.nome || '').toUpperCase();
  document.getElementById('p_cnpj').innerText       = cli.doc || '';
  document.getElementById('p_tel').innerText        = cli.tel || '';
  document.getElementById('p_obra').innerText       = `${cli.end || ''}, ${cli.num || ''} ${cli.comp ? '- ' + cli.comp : ''}`.toUpperCase();
  document.getElementById('p_responsavel').innerText= document.getElementById('contato_obra')?.value || "RESPONSÁVEL";

  // Proposal number: read from the display field populated by editarP, or leave blank for unsaved new proposals
  const numDisplay = document.getElementById('display_numero_proposta')?.value || '';
  const pNumeroEl  = document.getElementById('p_numero');
  if (pNumeroEl) pNumeroEl.innerText = numDisplay !== '—' ? numDisplay : '';

  const tb = document.getElementById('p_tabela_itens');
  tb.innerHTML = '';
  itensProposta.forEach(it => {
    tb.innerHTML += `<tr>
      <td>${esc(it.volume)}</td>
      <td>${esc(it.fck)}</td>
      <td>${esc(it.brita)}</td>
      <td>${esc(it.slump || '120±20')}</td>
      <td>R$ ${esc(Number(it.preco).toFixed(2))}</td>
    </tr>`;
  });

  const get = id => document.getElementById(id)?.value || '';
  document.getElementById('pr_bomba').innerText    = get('cfg_bomba');
  document.getElementById('pr_min_b').innerText    = get('cfg_min_b');
  document.getElementById('pr_fibra').innerText    = get('cfg_fibra');
  document.getElementById('pr_faltante').innerText = get('cfg_faltante');
  document.getElementById('pr_perm').innerText     = get('cfg_perm');
  document.getElementById('pr_h_uteis').innerText  = get('cfg_h_uteis');
  document.getElementById('pr_h_sab').innerText    = get('cfg_h_sab');
  document.getElementById('pr_h_dom').innerText    = get('cfg_h_dom');
  document.getElementById('pr_min_dom').innerText  = get('cfg_min_dom');
  document.getElementById('pr_rac').innerText      = get('cfg_rac');
  document.getElementById('pr_roc').innerText      = get('cfg_roc');
  document.getElementById('pr_prazo').innerText    = get('cfg_prazo');
  document.getElementById('p_obs').innerText       = get('obs') || "A COMBINAR";
  document.getElementById('p_vend').innerText      = vNome.toUpperCase();
  document.getElementById('p_v_cel').innerText     = vCel;

  const anexoNome = document.getElementById('anexo_nome_cliente');
  if (anexoNome) anexoNome.innerText = (cli.nome || '').toUpperCase();

  return true;
}

function imprimir() {
  try {
    if (!_preencherDocumentoImpressao()) return;
    setTimeout(() => window.print(), 100);
  } catch (e) {
    alert("Erro ao gerar impressão: " + e.message);
  }
}

function visualizarProposta() {
  try {
    if (!_preencherDocumentoImpressao()) return;

    const modal     = document.getElementById('modal-proposta-preview');
    const conteudo  = document.getElementById('preview-conteudo');
    const docImp    = document.getElementById('doc-impressao');
    const docAnexo  = document.getElementById('doc-anexo');

    const docImpClone = docImp.cloneNode(true);
    docImpClone.style.display = 'block';

    const docAnexoClone = docAnexo.cloneNode(true);
    docAnexoClone.style.display = 'block';

    const sep = document.createElement('div');
    sep.style.cssText = 'border-top:2px dashed #ccc; margin:24px 0;';

    conteudo.innerHTML = '';
    conteudo.appendChild(docImpClone);
    conteudo.appendChild(sep);
    conteudo.appendChild(docAnexoClone);

    modal.style.display = 'flex';
    modal.scrollTop = 0;
  } catch (e) {
    alert("Erro ao gerar visualização: " + e.message);
  }
}

function enviarWhatsAppComPDF() {
  try {
    if (!_preencherDocumentoImpressao()) return;
    alert(
      'Passo 1: A janela de impressão será aberta agora.\n' +
      'Selecione "Salvar como PDF" (ou "Microsoft Print to PDF") para gerar o arquivo PDF da proposta.\n\n' +
      'Após fechar a janela de impressão, o WhatsApp será aberto automaticamente para envio da mensagem.\n' +
      'Você poderá então anexar o PDF salvo na conversa do WhatsApp.'
    );
    setTimeout(() => {
      window.print();
      enviarWhatsApp();
    }, 100);
  } catch (e) {
    alert("Erro: " + e.message);
  }
}

function fecharPreviewProposta() {
  document.getElementById('modal-proposta-preview').style.display = 'none';
}

function enviarWhatsApp() {
  const cliId = document.getElementById('selC')?.value || '';
  if (!cliId) { alert("Selecione o cliente!"); return; }
  const cli = clientesCache.find(c => c.id === cliId) || {};
  const telRaw = cli.tel || '';
  if (!telRaw) { alert("O cliente não possui telefone cadastrado!"); return; }
  const digitos = telRaw.replace(/\D/g, '');
  const phone = digitos.startsWith('55') ? digitos : '55' + digitos;
  const nomeCliente = (cli.nome || '').toUpperCase();
  const numProposta = document.getElementById('display_numero_proposta')?.value || '';
  const msg = encodeURIComponent(
    `Olá ${nomeCliente}, segue a Proposta Comercial${numProposta ? ' Nº ' + numProposta : ''} da Solomix. ` +
    `Por favor, entre em contato para mais informações.`
  );
  const link = document.createElement('a');
  link.href = `https://wa.me/${phone}?text=${msg}`;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function exportarClientesExcel() {
  if (clientesCache.length === 0) return alert("Não há clientes cadastrados.");
  let csv = "\ufeffData;Nome;Documento;Telefone;CEP;Endereco;Numero;Complemento\n";
  clientesCache.forEach(c => {
    csv += `${c.data || ''};${c.nome || ''};${c.doc || ''};${c.tel || ''};${c.cep || ''};${c.end || ''};${c.num || ''};${c.comp || ''}\n`;
  });
  baixarCSV(csv, "clientes_solomix.csv");
}

function exportarPropostasExcel() {
  if (propostasCache.length === 0) return alert("Não há propostas cadastradas.");
  let csv = "\ufeffNro;Data;Cliente;Perfil;Filial;Status;Responsavel;Valor_Total\n";
  propostasCache.forEach(p => {
    const cli   = clientesCache.find(c => c.id === p.cliId);
    const nomeC = cli ? cli.nome : "Excluido";
    const total = (p.itens || []).reduce((acc, it) => acc + Number(it.preco || 0), 0).toFixed(2);
    const nro   = p.numeroProposta ? formatNumeroProposta(p.numeroProposta) : '';
    csv += `${nro};${p.data || ''};${nomeC};${p.perfilNome || ''};${p.filial || ''};${p.status || ''};${p.resp || ''};${total}\n`;
  });
  baixarCSV(csv, "propostas_solomix.csv");
}

function baixarCSV(csv, nome) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = nome;
  link.click();
}

function gerarTxtProgramacao() {
  const cliId = document.getElementById('selProgC')?.value || '';
  const cli   = clientesCache.find(c => c.id === cliId) || {};
  const get   = id => document.getElementById(id)?.value || '';

  const dataEventoRaw = get('prog_data_evento');
  const dataEventoFmt = dataEventoRaw
    ? (() => { const [y, m, d] = dataEventoRaw.split('-'); return `${d}/${m}/${y}`; })()
    : '';

  const txt = [
    `Data do Evento: ${dataEventoFmt}`,
    `Horário: ${get('prog_horario_evento')}`,
    `Nome da obra: ${get('prog_obra_nome')}`,
    `Contrato: ${get('prog_contrato')}`,
    `Cliente: ${cli.nome || ''}`,
    `CNPJ: ${cli.doc || ''}`,
    `Endereço Cliente: ${cli.end || ''}${cli.num ? ', ' + cli.num : ''}${cli.comp ? ' - ' + cli.comp : ''}`,
    `CNO: ${get('prog_cno')}`,
    `Email: ${get('prog_email')}`,
    `Contato da obra: ${get('prog_contato_obra')}`,
    `Solicitante: ${get('prog_solicitante')}`,
    `End. Obra: ${get('prog_end_obra')}`,
    `FCK: ${get('prog_fck')}`,
    `SLP: ${get('prog_slp')}`,
    `Brita: ${get('prog_brita')}`,
    `Preço: ${get('prog_preco')}`,
    `Bomba: ${get('prog_bomba')}`,
    `Volume: ${get('prog_volume')}`,
    `Forma pagamento: ${get('prog_pagamento')}`,
    `Observação: ${get('prog_obs')}`
  ].join('\n');

  const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'programacao.txt';
  link.click();
}

// ─── Google Calendar OAuth helpers ───────────────────────────────────────────
function atualizarUiGcal() {
  const statusBox  = document.getElementById('gcal-status-box');
  const statusText = document.getElementById('gcal-status-text');
  const btnConectar    = document.getElementById('btn-conectar-google');
  const btnDesconectar = document.getElementById('btn-desconectar-google');
  if (!statusBox) return;

  const conectado = gcalToken && Date.now() < gcalTokenExpiry;
  if (conectado) {
    statusBox.className = 'gcal-status conectado';
    statusText.textContent = '✓ Conectado ao Google Calendar';
    btnConectar.style.display    = 'none';
    btnDesconectar.style.display = 'block';
  } else {
    statusBox.className = 'gcal-status desconectado';
    statusText.textContent = 'Não conectado ao Google';
    btnConectar.style.display    = 'block';
    btnDesconectar.style.display = 'none';
  }
}

function inicializarGcalClienteId() {
  const saved = localStorage.getItem(GCAL_CLIENT_ID_KEY) || '';
  const campo = document.getElementById('gcal_client_id');
  if (campo) campo.value = saved;
}

function salvarGcalClientId() {
  const campo = document.getElementById('gcal_client_id');
  const clientId = (campo?.value || '').trim();
  if (!clientId) { alert('Informe o Client ID do Google OAuth 2.0.'); return; }
  localStorage.setItem(GCAL_CLIENT_ID_KEY, clientId);
  gcalTokenClient = null; // reset so it's re-initialized with the new ID
  alert('Client ID salvo com sucesso!');
}

function obterGcalClientId() {
  const campo = document.getElementById('gcal_client_id');
  const fromField = (campo?.value || '').trim();
  if (fromField) return fromField;
  return localStorage.getItem(GCAL_CLIENT_ID_KEY) || '';
}

function conectarGoogle() {
  const clientId = obterGcalClientId();
  if (!clientId) {
    alert('Informe e salve o Client ID do Google OAuth 2.0 antes de conectar.');
    return;
  }
  if (typeof google === 'undefined' || !google?.accounts?.oauth2) {
    alert('A biblioteca do Google ainda está carregando. Aguarde alguns segundos e tente novamente.');
    return;
  }
  // Save any typed client ID before connecting
  const campo = document.getElementById('gcal_client_id');
  if (campo?.value?.trim()) localStorage.setItem(GCAL_CLIENT_ID_KEY, campo.value.trim());

  gcalTokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: 'https://www.googleapis.com/auth/calendar.events',
    callback: (resp) => {
      if (resp.error) {
        alert('Erro ao conectar ao Google: ' + resp.error);
        return;
      }
      gcalToken = resp.access_token;
      // GIS tokens expire in 3600 s by default
      gcalTokenExpiry = Date.now() + (resp.expires_in || 3600) * 1000;
      atualizarUiGcal();
    }
  });
  gcalTokenClient.requestAccessToken({ prompt: 'consent' });
}

function desconectarGoogle() {
  if (gcalToken && typeof google !== 'undefined' && google?.accounts?.oauth2) {
    google.accounts.oauth2.revoke(gcalToken, () => {});
  }
  gcalToken = null;
  gcalTokenExpiry = 0;
  gcalTokenClient = null;
  atualizarUiGcal();
}

async function criarEventoGcalAPI(eventBody) {
  // If token is expired or missing, request a new one first
  if (!gcalToken || Date.now() >= gcalTokenExpiry) {
    const clientId = obterGcalClientId();
    if (!clientId || typeof google === 'undefined' || !google?.accounts?.oauth2) return false;
    // Prevent concurrent token refresh requests
    if (gcalTokenRefreshing) return false;
    gcalTokenRefreshing = true;
    return new Promise((resolve) => {
      const handleTokenResponse = async (resp) => {
        gcalTokenRefreshing = false;
        if (resp.error) { resolve(false); return; }
        gcalToken = resp.access_token;
        // GIS tokens expire in 3600 seconds by default
        gcalTokenExpiry = Date.now() + (resp.expires_in || 3600) * 1000;
        atualizarUiGcal();
        resolve(await _postEventoGcal(eventBody));
      };
      if (!gcalTokenClient) {
        gcalTokenClient = google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: 'https://www.googleapis.com/auth/calendar.events',
          callback: handleTokenResponse
        });
      } else {
        gcalTokenClient.callback = handleTokenResponse;
      }
      gcalTokenClient.requestAccessToken({ prompt: '' });
    });
  }
  return _postEventoGcal(eventBody);
}

async function _postEventoGcal(eventBody) {
  try {
    const resp = await fetch(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events',
      {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + gcalToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(eventBody)
      }
    );
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      const msg = err?.error?.message || `HTTP ${resp.status}`;
      console.error('Google Calendar API error:', err);
      alert(`Erro ao criar evento no Google Calendar: ${msg}\nUsando método alternativo.`);
      return false;
    }
    return true;
  } catch (e) {
    console.error('Google Calendar fetch error:', e);
    alert('Erro de rede ao acessar o Google Calendar. Usando método alternativo.');
    return false;
  }
}

function adicionarGoogleAgenda() {
  const cliId = document.getElementById('selProgC')?.value || '';
  const cli   = clientesCache.find(c => c.id === cliId) || {};
  const get   = id => document.getElementById(id)?.value || '';

  const dataVal    = get('prog_data_evento');
  const horarioVal = get('prog_horario_evento');

  if (!dataVal || !horarioVal) {
    alert('Informe a data e o horário do evento antes de adicionar ao Google Agenda.');
    return;
  }

  // Build datetime strings (local time, no Z suffix)
  const dateStr = dataVal.replace(/-/g, '');
  const timeStr = horarioVal.replace(':', '') + '00';
  const startDT = `${dateStr}T${timeStr}`;

  // End time = start + 1 hour (handle midnight rollover)
  const startDate = new Date(`${dataVal}T${horarioVal}:00`);
  const endDate   = new Date(startDate.getTime() + 60 * 60 * 1000);
  const pad       = n => String(n).padStart(2, '0');
  const endDateStr = `${endDate.getFullYear()}${pad(endDate.getMonth() + 1)}${pad(endDate.getDate())}`;
  const endDT = `${endDateStr}T${pad(endDate.getHours())}${pad(endDate.getMinutes())}00`;

  const titulo = `Programação: ${get('prog_obra_nome') || 'Obra'} - ${cli.nome || 'Cliente'}`;

  const [y, mo, d] = dataVal.split('-');
  const dataEventoFmt = `${d}/${mo}/${y}`;
  const endCli = `${cli.end || ''}${cli.num ? ', ' + cli.num : ''}${cli.comp ? ' - ' + cli.comp : ''}`;
  const desc = [
    `Data do Evento: ${dataEventoFmt}`,
    `Horário: ${horarioVal}`,
    `Nome da Obra: ${get('prog_obra_nome')}`,
    `Contrato: ${get('prog_contrato')}`,
    `Cliente: ${cli.nome || ''}`,
    `CNPJ: ${cli.doc || ''}`,
    `Endereço Cliente: ${endCli}`,
    `CNO: ${get('prog_cno')}`,
    `Email: ${get('prog_email')}`,
    `Contato da Obra: ${get('prog_contato_obra')}`,
    `Solicitante: ${get('prog_solicitante')}`,
    `Endereço da Obra: ${get('prog_end_obra')}`,
    `FCK: ${get('prog_fck')}`,
    `SLP: ${get('prog_slp')}`,
    `Brita: ${get('prog_brita')}`,
    `Preço: R$ ${get('prog_preco')}`,
    `Bomba: R$ ${get('prog_bomba')}`,
    `Volume: ${get('prog_volume')}`,
    `Forma de Pagamento: ${get('prog_pagamento')}`,
    `Observação: ${get('prog_obs')}`
  ].join('\n');

  const location = get('prog_end_obra');

  // If connected via OAuth, use the Calendar API directly
  const clientId = obterGcalClientId();
  const tokenValido = gcalToken && Date.now() < gcalTokenExpiry;
  if (clientId && (tokenValido || gcalTokenClient)) {
    const eventBody = {
      summary: titulo,
      location: location,
      description: desc,
      start: {
        dateTime: `${dataVal}T${horarioVal}:00`,
        timeZone: GCAL_TIMEZONE
      },
      end: {
        dateTime: `${endDate.getFullYear()}-${pad(endDate.getMonth() + 1)}-${pad(endDate.getDate())}T${pad(endDate.getHours())}:${pad(endDate.getMinutes())}:00`,
        timeZone: GCAL_TIMEZONE
      }
    };
    criarEventoGcalAPI(eventBody).then(ok => {
      if (ok) {
        alert('✅ Evento adicionado com sucesso ao Google Calendar!');
        atualizarUiGcal();
      } else {
        // Fallback to URL approach
        const url = 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
          '&text=' + encodeURIComponent(titulo) +
          '&dates=' + encodeURIComponent(startDT) + '/' + encodeURIComponent(endDT) +
          '&details=' + encodeURIComponent(desc) +
          '&location=' + encodeURIComponent(location);
        window.open(url, '_blank');
      }
    });
    return;
  }

  // Fallback: open Google Calendar URL (user must be logged in their browser)
  const url = 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
    '&text=' + encodeURIComponent(titulo) +
    '&dates=' + encodeURIComponent(startDT) + '/' + encodeURIComponent(endDT) +
    '&details=' + encodeURIComponent(desc) +
    '&location=' + encodeURIComponent(location);

  window.open(url, '_blank');
}

// ─── Motivo Perda toggle ──────────────────────────────────────────────────────
function alternarMotivPerda(statusVal) {
  const wrap = document.getElementById('motivo_perda_wrap');
  if (wrap) wrap.style.display = statusVal === 'perdida' ? 'block' : 'none';
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function parseDateBR(s) {
  // Parse dd/mm/yyyy → Date
  if (!s) return null;
  const parts = s.split('/');
  if (parts.length !== 3) return null;
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);
  if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
  return new Date(year, month - 1, day);
}

function fmtBRL(v) {
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function calcReceitaProposta(p) {
  return (p.itens || []).reduce((acc, it) => {
    const vol   = parseFloat(it.volume) || 0;
    const preco = parseFloat(it.preco)  || 0;
    return acc + vol * preco;
  }, 0);
}

function renderizarDashboard() {
  if (!isAdmin() && !isGerente()) return;

  const filtroFilial   = document.getElementById('dash_filial')?.value   || '';
  const filtroVendedor = document.getElementById('dash_vendedor')?.value || '';
  const filtroPeriodo  = document.getElementById('dash_periodo')?.value  || '';

  const agora = new Date();
  const inicioMes      = new Date(agora.getFullYear(), agora.getMonth(), 1);
  const mesInicioTrim  = agora.getMonth() - 2;
  const anoInicioTrim  = agora.getFullYear() + Math.floor(mesInicioTrim / 12);
  const inicioTrimestre= new Date(anoInicioTrim, ((mesInicioTrim % 12) + 12) % 12, 1);
  const inicioAno      = new Date(agora.getFullYear(), 0, 1);

  // Build the full propostas list for admin (all units), gerente (own filial)
  let lista = [...propostasCache];

  // Apply filial filter
  if (filtroFilial) lista = lista.filter(p => p.filial === filtroFilial);

  // Apply vendedor filter
  if (filtroVendedor) lista = lista.filter(p => p.perfilNome === filtroVendedor);

  // Apply period filter
  if (filtroPeriodo) {
    const inicio = filtroPeriodo === 'mes' ? inicioMes
                 : filtroPeriodo === 'trimestre' ? inicioTrimestre
                 : inicioAno;
    lista = lista.filter(p => {
      const d = parseDateBR(p.data);
      return d && d >= inicio;
    });
  }

  const total     = lista.length;
  const andamento = lista.filter(p => p.status === 'andamento').length;
  const fechadas  = lista.filter(p => p.status === 'fechada').length;
  const perdidas  = lista.filter(p => p.status === 'perdida').length;
  const receita   = lista.filter(p => p.status === 'fechada')
                         .reduce((acc, p) => acc + calcReceitaProposta(p), 0);

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('dash_total',     total);
  set('dash_andamento', andamento);
  set('dash_fechadas',  fechadas);
  set('dash_perdidas',  perdidas);
  set('dash_receita',   'R$ ' + fmtBRL(receita));

  // ── Populate vendedor dropdown ────────────────────────────────────────────
  const selVend = document.getElementById('dash_vendedor');
  if (selVend) {
    const current = selVend.value;
    const vendedores = [...new Set(propostasCache.map(p => p.perfilNome).filter(Boolean))].sort();
    selVend.innerHTML = '<option value="">Todos os Vendedores</option>';
    vendedores.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      selVend.appendChild(opt);
    });
    selVend.value = current;
  }

  // ── Por Unidade ───────────────────────────────────────────────────────────
  const porFilial = {};
  lista.forEach(p => {
    const f = p.filial || 'N/A';
    if (!porFilial[f]) porFilial[f] = { and: 0, fech: 0, perd: 0, receita: 0 };
    if (p.status === 'andamento') porFilial[f].and++;
    else if (p.status === 'fechada') { porFilial[f].fech++; porFilial[f].receita += calcReceitaProposta(p); }
    else if (p.status === 'perdida') porFilial[f].perd++;
  });

  const tbFilial = document.getElementById('dash_tabela_unidade');
  if (tbFilial) {
    tbFilial.innerHTML = '';
    const entries = Object.entries(porFilial).sort((a, b) => a[0].localeCompare(b[0]));
    if (!entries.length) {
      tbFilial.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#888;">Nenhum dado</td></tr>';
    } else {
      let rows = '';
      entries.forEach(([filial, d]) => {
        rows += `<tr>
          <td>${esc(filial)}</td>
          <td><span class="badge bg-andamento">${d.and}</span></td>
          <td><span class="badge bg-fechada">${d.fech}</span></td>
          <td><span class="badge bg-perdida">${d.perd}</span></td>
          <td>${d.and + d.fech + d.perd}</td>
          <td>R$ ${fmtBRL(d.receita)}</td>
        </tr>`;
      });
      tbFilial.innerHTML = rows;
    }
  }

  // ── Por Vendedor ──────────────────────────────────────────────────────────
  const porVendedor = {};
  lista.forEach(p => {
    const v = p.perfilNome || 'N/A';
    const f = p.filial     || 'N/A';
    const key = v + '||' + f;
    if (!porVendedor[key]) porVendedor[key] = { nome: v, filial: f, and: 0, fech: 0, perd: 0, receita: 0 };
    if (p.status === 'andamento') porVendedor[key].and++;
    else if (p.status === 'fechada') { porVendedor[key].fech++; porVendedor[key].receita += calcReceitaProposta(p); }
    else if (p.status === 'perdida') porVendedor[key].perd++;
  });

  const tbVend = document.getElementById('dash_tabela_vendedor');
  if (tbVend) {
    tbVend.innerHTML = '';
    const entries = Object.values(porVendedor).sort((a, b) => a.nome.localeCompare(b.nome));
    if (!entries.length) {
      tbVend.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#888;">Nenhum dado</td></tr>';
    } else {
      let rows = '';
      entries.forEach(d => {
        rows += `<tr>
          <td>${esc(d.nome)}</td>
          <td>${esc(d.filial)}</td>
          <td><span class="badge bg-andamento">${d.and}</span></td>
          <td><span class="badge bg-fechada">${d.fech}</span></td>
          <td><span class="badge bg-perdida">${d.perd}</span></td>
          <td>${d.and + d.fech + d.perd}</td>
          <td>R$ ${fmtBRL(d.receita)}</td>
        </tr>`;
      });
      tbVend.innerHTML = rows;
    }
  }

  // ── Por Tipo de Concreto (FCK) — apenas propostas fechadas ────────────────
  const porFck = {};
  lista.filter(p => p.status === 'fechada').forEach(p => {
    (p.itens || []).forEach(it => {
      const fck = it.fck || 'N/A';
      if (!porFck[fck]) porFck[fck] = { volume: 0, receita: 0, qtd: new Set() };
      porFck[fck].volume  += parseFloat(it.volume) || 0;
      porFck[fck].receita += (parseFloat(it.volume) || 0) * (parseFloat(it.preco) || 0);
      porFck[fck].qtd.add(p.id);
    });
  });

  const tbFck = document.getElementById('dash_tabela_fck');
  if (tbFck) {
    tbFck.innerHTML = '';
    const entries = Object.entries(porFck).sort((a, b) => b[1].receita - a[1].receita);
    if (!entries.length) {
      tbFck.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#888;">Nenhum dado</td></tr>';
    } else {
      let rows = '';
      entries.forEach(([fck, d]) => {
        rows += `<tr>
          <td><strong>${esc(fck)}</strong></td>
          <td>${fmtBRL(d.volume)} m³</td>
          <td>R$ ${fmtBRL(d.receita)}</td>
          <td>${d.qtd.size}</td>
        </tr>`;
      });
      tbFck.innerHTML = rows;
    }
  }

  // ── Motivos de Perda ──────────────────────────────────────────────────────
  const perdidas_list = lista.filter(p => p.status === 'perdida');
  const tbPerd = document.getElementById('dash_tabela_perdidas');
  if (tbPerd) {
    tbPerd.innerHTML = '';
    if (!perdidas_list.length) {
      tbPerd.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#888;">Nenhuma proposta perdida</td></tr>';
    } else {
      let rows = '';
      perdidas_list.forEach(p => {
        const cli = clientesCache.find(c => c.id === p.cliId);
        const nomeCli = cli ? cli.nome : '—';
        rows += `<tr>
          <td>${esc(p.data || '')}</td>
          <td>${esc(nomeCli)}</td>
          <td>${esc(p.perfilNome || '—')}</td>
          <td>${esc(p.filial || '—')}</td>
          <td>${esc(p.motivoPerda || '—')}</td>
        </tr>`;
      });
      tbPerd.innerHTML = rows;
    }
  }

  renderizarGraficoDashboard(lista);
}

// ─── Dashboard Export ─────────────────────────────────────────────────────────
function exportarRelatorioDashboard() {
  if (!isAdmin() && !isGerente()) return;

  const filtroFilial   = document.getElementById('dash_filial')?.value   || '';
  const filtroVendedor = document.getElementById('dash_vendedor')?.value || '';
  const filtroPeriodo  = document.getElementById('dash_periodo')?.value  || '';

  const agora = new Date();
  const inicioMes       = new Date(agora.getFullYear(), agora.getMonth(), 1);
  const mesInicioTrim   = agora.getMonth() - 2;
  const anoInicioTrim   = agora.getFullYear() + (mesInicioTrim < 0 ? -1 : 0);
  const inicioTrimestre = new Date(anoInicioTrim, ((mesInicioTrim % 12) + 12) % 12, 1);
  const inicioAno       = new Date(agora.getFullYear(), 0, 1);

  let lista = [...propostasCache];
  if (filtroFilial)   lista = lista.filter(p => p.filial === filtroFilial);
  if (filtroVendedor) lista = lista.filter(p => p.perfilNome === filtroVendedor);
  if (filtroPeriodo) {
    const inicio = filtroPeriodo === 'mes' ? inicioMes
                 : filtroPeriodo === 'trimestre' ? inicioTrimestre
                 : inicioAno;
    lista = lista.filter(p => { const d = parseDateBR(p.data); return d && d >= inicio; });
  }

  if (!lista.length) return alert("Nenhuma proposta encontrada com os filtros selecionados.");

  const csvField = v => String(v || '').replace(/;/g, ',').replace(/\n|\r/g, ' ');

  let csv = "\ufeffNro;Data;Cliente;Vendedor;Unidade;Status;Motivo_Perda;Volume_m3;Valor_Total\n";
  lista.forEach(p => {
    const cli    = clientesCache.find(c => c.id === p.cliId);
    const nomeC  = cli ? cli.nome : "Excluído";
    const nro    = p.numeroProposta ? formatNumeroProposta(p.numeroProposta) : '';
    const volume = (p.itens || []).reduce((acc, it) => acc + (parseFloat(it.volume) || 0), 0);
    const total  = calcReceitaProposta(p);
    csv += `${csvField(nro)};${csvField(p.data)};${csvField(nomeC)};${csvField(p.perfilNome)};${csvField(p.filial)};${csvField(p.status)};${csvField(p.motivoPerda)};${volume.toFixed(2)};${total.toFixed(2)}\n`;
  });

  const filtros = [
    filtroFilial   ? `Filial_${filtroFilial}`     : '',
    filtroVendedor ? `Vendedor_${filtroVendedor}` : '',
    filtroPeriodo  ? `Periodo_${filtroPeriodo}`   : ''
  ].filter(Boolean).join('_');
  const sufixo = filtros ? `_${filtros}` : '_todos';
  baixarCSV(csv, `relatorio_dashboard${sufixo}.csv`);
}

// ─── Dashboard Charts ─────────────────────────────────────────────────────────
const _dashCharts = {};

function destruirChart(id) {
  if (_dashCharts[id]) { _dashCharts[id].destroy(); delete _dashCharts[id]; }
}

function renderizarGraficoDashboard(lista) {
  if (typeof Chart === 'undefined') return;

  // ── Gráfico de Status (Donut) ──────────────────────────────────────────────
  destruirChart('status');
  const ctxStatus = document.getElementById('dash_chart_status');
  if (ctxStatus) {
    const andamento = lista.filter(p => p.status === 'andamento').length;
    const fechadas  = lista.filter(p => p.status === 'fechada').length;
    const perdidas  = lista.filter(p => p.status === 'perdida').length;
    _dashCharts['status'] = new Chart(ctxStatus, {
      type: 'doughnut',
      data: {
        labels: ['Em Andamento', 'Fechadas', 'Perdidas'],
        datasets: [{
          data: [andamento, fechadas, perdidas],
          backgroundColor: ['#f1c40f', '#27ae60', '#e74c3c'],
          borderWidth: 2
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } }
      }
    });
  }

  // ── Gráfico por Unidade (Barras Empilhadas) ────────────────────────────────
  destruirChart('unidade');
  const ctxUnidade = document.getElementById('dash_chart_unidade');
  if (ctxUnidade) {
    const porFilial = {};
    lista.forEach(p => {
      const f = p.filial || 'N/A';
      if (!porFilial[f]) porFilial[f] = { and: 0, fech: 0, perd: 0 };
      if (p.status === 'andamento') porFilial[f].and++;
      else if (p.status === 'fechada')  porFilial[f].fech++;
      else if (p.status === 'perdida')  porFilial[f].perd++;
    });
    const labels = Object.keys(porFilial).sort();
    _dashCharts['unidade'] = new Chart(ctxUnidade, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Andamento', data: labels.map(f => porFilial[f].and),  backgroundColor: '#f1c40f' },
          { label: 'Fechadas',  data: labels.map(f => porFilial[f].fech), backgroundColor: '#27ae60' },
          { label: 'Perdidas',  data: labels.map(f => porFilial[f].perd), backgroundColor: '#e74c3c' }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { x: { stacked: true, ticks: { font: { size: 10 } } }, y: { stacked: true, beginAtZero: true } },
        plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } }
      }
    });
  }

  // ── Evolução Mensal (últimos 6 meses) ─────────────────────────────────────
  destruirChart('mensal');
  const ctxMensal = document.getElementById('dash_chart_mensal');
  if (ctxMensal) {
    const agora   = new Date();
    const meses   = [];
    const labels  = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
      meses.push({ ano: d.getFullYear(), mes: d.getMonth() });
      labels.push(d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }));
    }
    const totais  = meses.map(() => 0);
    const fech    = meses.map(() => 0);
    lista.forEach(p => {
      const d = parseDateBR(p.data);
      if (!d) return;
      const idx = meses.findIndex(m => m.ano === d.getFullYear() && m.mes === d.getMonth());
      if (idx === -1) return;
      totais[idx]++;
      if (p.status === 'fechada') fech[idx]++;
    });
    _dashCharts['mensal'] = new Chart(ctxMensal, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Total',    data: totais, backgroundColor: 'rgba(45,106,79,0.25)', borderColor: '#2d6a4f', borderWidth: 2, type: 'line', tension: 0.3, fill: true },
          { label: 'Fechadas', data: fech,   backgroundColor: '#27ae60' }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { y: { beginAtZero: true } },
        plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } }
      }
    });
  }
}


const EMPRESA_ADMIN_KEY = 'solomix_empresa_admin';
const EMPRESA_ADMIN_MIGRATED_ID = 'legacy_migrated_company';
const PERFIL_VINCULADO_KEY = 'solomix_perfil_vinculado';

async function carregarEmpresa() {
  // Load empresaCache from the first/linked company for print purposes
  await carregarEmpresas();
  if (empresasCache.length > 0 && !empresaCache.razaoSocial) {
    const e = empresasCache[0];
    empresaCache = {
      razaoSocial: e.razaoSocial,
      cnpj:        e.cnpj,
      endereco:    e.endereco,
      telefone:    e.telefone,
      email:       e.email
    };
  }
  // Populate form with first company data if only one exists
  if (empresasCache.length === 1) {
    const e = empresasCache[0];
    const setInputValue = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    setInputValue('emp_razao', e.razaoSocial);
    setInputValue('emp_cnpj',  e.cnpj);
    setInputValue('emp_end',   e.endereco);
    setInputValue('emp_tel',   e.telefone);
    setInputValue('emp_email', e.email);
  }
}

async function carregarEmpresas() {
  empresasCache = [];
  if (!currentUser) return;
  try {
    if (currentUser.username === ADMIN_USER) {
      const saved = localStorage.getItem(EMPRESA_ADMIN_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          empresasCache = parsed;
        } else if (parsed && parsed.razaoSocial) {
          // Migrate old single-company format
          empresasCache = [{ ...parsed, id: EMPRESA_ADMIN_MIGRATED_ID }];
          localStorage.setItem(EMPRESA_ADMIN_KEY, JSON.stringify(empresasCache));
        }
      }
    } else if (currentUser.id) {
      const snap = await getDocs(query(collection(db, 'empresas'), where('userId', '==', currentUser.username)));
      snap.forEach(d => empresasCache.push({ id: d.id, ...d.data() }));
    }
  } catch(e) { console.error('Erro ao carregar empresas:', e); }
  atualizarListaEmpresas();
}

function atualizarListaEmpresas() {
  const l = document.getElementById('listaEmpresas');
  if (!l) return;
  l.innerHTML = '';
  if (!empresasCache.length) {
    l.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#888;">Nenhuma empresa cadastrada.</td></tr>';
    return;
  }
  empresasCache.forEach((e, i) => {
    l.innerHTML += `<tr>
      <td>${esc(e.razaoSocial || '')}</td>
      <td>${esc(e.cnpj || '')}</td>
      <td>${esc(e.telefone || '')}</td>
      <td>${esc(e.email || '')}</td>
      <td class="actions">
        <span onclick="editarEmpresa('${esc(e.id)}')" title="Editar">✏️</span>
        <span onclick="vincularEmpresaAoLayout('${esc(e.id)}')" title="Vincular ao layout" style="cursor:pointer">🔗</span>
        <span onclick="excluirEmpresa('${esc(e.id)}')" title="Excluir">🗑️</span>
      </td>
    </tr>`;
  });
}

function editarEmpresa(id) {
  const e = empresasCache.find(x => x.id === id);
  if (!e) return;
  const set = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val || ''; };
  set('emp_razao', e.razaoSocial);
  set('emp_cnpj',  e.cnpj);
  set('emp_end',   e.endereco);
  set('emp_tel',   e.telefone);
  set('emp_email', e.email);
  const idxEl = document.getElementById('idx_empresa');
  if (idxEl) idxEl.value = e.id;
}

async function excluirEmpresa(id) {
  if (!confirm("Excluir empresa?")) return;
  try {
    if (currentUser.username === ADMIN_USER) {
      const all = Array.isArray(empresasCache) ? empresasCache.filter(e => e.id !== id) : [];
      localStorage.setItem(EMPRESA_ADMIN_KEY, JSON.stringify(all));
    } else {
      await deleteDoc(doc(db, 'empresas', id));
    }
    await carregarEmpresas();
  } catch(e) { alert('Erro ao excluir empresa: ' + e.message); }
}

function vincularEmpresaAoLayout(id) {
  const e = empresasCache.find(x => x.id === id);
  if (!e) return;
  empresaCache = {
    razaoSocial: e.razaoSocial,
    cnpj:        e.cnpj,
    endereco:    e.endereco,
    telefone:    e.telefone,
    email:       e.email
  };
  alert(`Empresa "${e.razaoSocial}" vinculada ao layout da proposta!`);
}

function limparEmpresaForm() {
  ['emp_razao','emp_cnpj','emp_end','emp_tel','emp_email'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const idxEl = document.getElementById('idx_empresa');
  if (idxEl) idxEl.value = '-1';
}

async function salvarEmpresa() {
  if (!currentUser) return alert('Sessão inválida. Faça login novamente.');
  const idx = document.getElementById('idx_empresa')?.value || '-1';
  const obj = {
    razaoSocial: (document.getElementById('emp_razao')?.value || '').trim(),
    cnpj:        (document.getElementById('emp_cnpj')?.value  || '').trim(),
    endereco:    (document.getElementById('emp_end')?.value   || '').trim(),
    telefone:    (document.getElementById('emp_tel')?.value   || '').trim(),
    email:       (document.getElementById('emp_email')?.value || '').trim(),
    userId:      currentUser.username,
    data:        new Date().toLocaleDateString('pt-BR')
  };
  if (!obj.razaoSocial) return alert('Informe a Razão Social da empresa!');
  try {
    if (currentUser.username === ADMIN_USER) {
      const all = Array.isArray(empresasCache) ? [...empresasCache] : [];
      if (idx === '-1') {
        obj.id = generateLocalId();
        all.push(obj);
      } else {
        const found = all.findIndex(e => e.id === idx);
        if (found >= 0) { obj.id = idx; all[found] = obj; }
        else { obj.id = generateLocalId(); all.push(obj); }
      }
      localStorage.setItem(EMPRESA_ADMIN_KEY, JSON.stringify(all));
    } else if (currentUser.id) {
      if (idx === '-1') {
        await addDoc(collection(db, 'empresas'), obj);
      } else {
        await updateDoc(doc(db, 'empresas', idx), obj);
      }
    } else {
      throw new Error('ID de usuário não encontrado.');
    }
    limparEmpresaForm();
    await carregarEmpresas();
    alert('Dados da empresa salvos!');
  } catch (e) {
    alert('Erro ao salvar empresa: ' + e.message);
  }
}

// ─── Initialization ───────────────────────────────────────────────────────────
async function inicializar() {
  const fcks = ["10 MPa","15 MPa","20 MPa","25 MPa","30 Mpa (HE)","30 Mpa","30 Mpa (PISO)","40 MPa"];
  const fs = document.getElementById('fck');
  if (fs) { fs.innerHTML = ''; fcks.forEach(v => fs.innerHTML += `<option value="${v}">${v}</option>`); }

  await carregarClientesCache();
  await carregarPerfisCache();
  await carregarVendedor();
  await carregarEmpresa();
  await atualizarC();
  await listarP();
  popularSelectProposta();
  await listarProgramacoes();
  filtrarPerfis();
  atualizarExtratoProgramacao();
  if (podeGerenciarUsuarios()) await carregarUsuarios();
  inicializarGcalClienteId();
  atualizarUiGcal();
}

// ─── Expose all functions to window (needed for inline onclick handlers) ──────
window.alternarMotivPerda    = alternarMotivPerda;
window.renderizarDashboard   = renderizarDashboard;
window.exportarRelatorioDashboard = exportarRelatorioDashboard;
window.fazerLogin            = fazerLogin;
window.fazerLogout           = fazerLogout;
window.abrirModalSenha       = abrirModalSenha;
window.fecharModalSenha      = fecharModalSenha;
window.trocarSenha           = trocarSenha;
window.trocarSenhaPerfil     = trocarSenhaPerfil;
window.tab                   = tab;
window.mascaraTel            = mascaraTel;
window.mascaraDoc            = mascaraDoc;
window.mascaraCEP            = mascaraCEP;
window.autoCEP               = autoCEP;
window.salvarC               = salvarC;
window.atualizarC            = atualizarC;
window.editarC               = editarC;
window.excluirC              = excluirC;
window.limparC               = limparC;
window.atualizarDadosClienteProposta = atualizarDadosClienteProposta;
window.addLinha              = addLinha;
window.renderItens           = renderItens;
window.removerItem           = removerItem;
window.salvarP               = salvarP;
window.listarP               = listarP;
window.editarP               = editarP;
window.excluirP              = excluirP;
window.filtrarPropostas      = filtrarPropostas;
window.salvarV               = salvarV;
window.excluirPerfil         = excluirPerfil;
window.editarPerfil          = editarPerfil;
window.filtrarPerfis         = filtrarPerfis;
window.limparPerfil          = limparPerfil;
window.salvarProgramacao     = salvarProgramacao;
window.listarProgramacoes    = listarProgramacoes;
window.editarProgramacao     = editarProgramacao;
window.excluirProgramacao    = excluirProgramacao;
window.carregarClienteProgramacao = carregarClienteProgramacao;
window.popularSelectProposta = popularSelectProposta;
window.carregarPropostaNaProgramacao = carregarPropostaNaProgramacao;
window.atualizarExtratoProgramacao = atualizarExtratoProgramacao;
window.gerarTxtProgramacao   = gerarTxtProgramacao;
window.adicionarGoogleAgenda = adicionarGoogleAgenda;
window.salvarGcalClientId    = salvarGcalClientId;
window.conectarGoogle        = conectarGoogle;
window.desconectarGoogle     = desconectarGoogle;
window.imprimir              = imprimir;
window.visualizarProposta    = visualizarProposta;
window.fecharPreviewProposta = fecharPreviewProposta;
window.enviarWhatsApp        = enviarWhatsApp;
window.enviarWhatsAppComPDF  = enviarWhatsAppComPDF;
window.exportarClientesExcel = exportarClientesExcel;
window.exportarPropostasExcel= exportarPropostasExcel;
window.salvarUsuario         = salvarUsuario;
window.editarUsuario         = editarUsuario;
window.excluirUsuario        = excluirUsuario;
window.limparUsuario         = limparUsuario;
window.salvarEmpresa         = salvarEmpresa;
window.carregarEmpresas      = carregarEmpresas;
window.atualizarListaEmpresas= atualizarListaEmpresas;
window.editarEmpresa         = editarEmpresa;
window.excluirEmpresa        = excluirEmpresa;
window.vincularEmpresaAoLayout = vincularEmpresaAoLayout;
window.limparEmpresaForm     = limparEmpresaForm;
window.pedirSenhaParaInativar= pedirSenhaParaInativar;
window.fecharModalConfirmarSenha = fecharModalConfirmarSenha;
window.confirmarOperacaoComSenha = confirmarOperacaoComSenha;
window.inativarUsuario       = inativarUsuario;
window.reativarUsuario       = reativarUsuario;
window.autoCEPObra           = autoCEPObra;
window.carregarObrasCliente  = carregarObrasCliente;
window.atualizarListaObras   = atualizarListaObras;
window.editarObra            = editarObra;
window.limparObra            = limparObra;
window.salvarObra            = salvarObra;
window.excluirObra           = excluirObra;
window.filtrarClientes       = filtrarClientes;
window.atualizarEnderecoObra = atualizarEnderecoObra;
window.editarItem            = editarItem;
window.usarItemProgramacao   = usarItemProgramacao;
window.vincularPerfilAoLayout = vincularPerfilAoLayout;

// ─── Startup ──────────────────────────────────────────────────────────────────
window.onload = () => {
  const sess = sessionStorage.getItem(SESSION_KEY);
  if (sess) {
    try {
      currentUser = JSON.parse(sess);
      document.getElementById('tela-login').style.display = 'none';
      document.getElementById('app').style.display = 'block';
      configurarUI();
      inicializar();
    } catch (e) {
      sessionStorage.removeItem(SESSION_KEY);
    }
  }
};
