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
  orderBy
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

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

let clientesCache = [];

function mascaraTel(i) {
  let v = i.value.replace(/\D/g, "");
  v = v.replace(/^(\d{2})(\d)/g, "($1) $2");
  v = v.replace(/(\d)(\d{4})$/, "$1-$2");
  i.value = v;
}

async function carregarClientesCache() {
  const snap = await getDocs(query(collection(db, "clientes"), orderBy("data", "desc")));
  clientesCache = [];
  snap.forEach(d => clientesCache.push({ id: d.id, ...d.data() }));
  return clientesCache;
}

async function atualizarC() {
  const s = document.getElementById('selC');
  const sp = document.getElementById('selProgC');
  const l = document.getElementById('listaC');

  if (s) s.innerHTML = '<option value="">Selecionar Cliente...</option>';
  if (sp) sp.innerHTML = '<option value="">Selecionar Cliente...</option>';
  if (l) l.innerHTML = '';

  await carregarClientesCache();

  clientesCache.forEach((c, i) => {
    if (s) s.innerHTML += `<option value="${c.id}">${c.nome}</option>`;
    if (sp) sp.innerHTML += `<option value="${c.id}">${c.nome}</option>`;
    if (l) {
      l.innerHTML += `<tr>
        <td>${c.data || ''}</td>
        <td>${c.nome || ''}</td>
        <td class="actions">
          <span onclick="editarC(${i})">✏️</span>
          <span onclick="excluirC('${c.id}')">🗑️</span>
        </td>
      </tr>`;
    }
  });
}

function editarC(i) {
  const c = clientesCache[i];
  if (!c) return;

  const ids = ['nome', 'doc_c', 'tel_c', 'end', 'num', 'comp'];
  const values = [c.nome || '', c.doc || '', c.tel || '', c.end || '', c.num || '', c.comp || ''];

  ids.forEach((id, idx) => {
    const el = document.getElementById(id);
    if (el) el.value = values[idx];
  });

  const idxEl = document.getElementById('idx_c');
  const btn = document.getElementById('btn_cli');
  if (idxEl) idxEl.value = i;
  if (btn) btn.innerText = "ATUALIZAR";
}

function limparC() {
  const ids = ['idx_c', 'nome', 'doc_c', 'tel_c', 'end', 'num', 'comp', 'cep'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = id === 'idx_c' ? "-1" : "";
  });

  const btn = document.getElementById('btn_cli');
  if (btn) btn.innerText = "SALVAR CLIENTE";
}

async function salvarC() {
  try {
    const nome = document.getElementById('nome')?.value?.trim();
    const docC = document.getElementById('doc_c')?.value || '';
    const tel = document.getElementById('tel_c')?.value || '';
    const end = document.getElementById('end')?.value || '';
    const num = document.getElementById('num')?.value || '';
    const comp = document.getElementById('comp')?.value || '';
    const idx = document.getElementById('idx_c')?.value || "-1";

    if (!nome) {
      alert("Informe o nome do cliente!");
      return;
    }

    const obj = {
      data: new Date().toLocaleDateString('pt-BR'),
      nome,
      doc: docC,
      tel,
      end,
      num,
      comp
    };

    if (idx === "-1") {
      await addDoc(collection(db, "clientes"), obj);
    } else {
      const refId = clientesCache[Number(idx)]?.id;
      if (!refId) {
        alert("Cliente não encontrado para atualização.");
        return;
      }
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
}

async function carregarVendedor() {
  const snap = await getDoc(doc(db, "perfil_vendedor", "principal"));
  if (snap.exists()) {
    const v = snap.data();
    const nome = document.getElementById('v_nome');
    const cel = document.getElementById('v_cel');
    if (nome) nome.value = v.nome || '';
    if (cel) cel.value = v.cel || '';
  }
}

async function salvarV() {
  const obj = {
    nome: document.getElementById('v_nome')?.value || '',
    cel: document.getElementById('v_cel')?.value || ''
  };
  await setDoc(doc(db, "perfil_vendedor", "principal"), obj, { merge: true });
  alert("Perfil salvo!");
}

function tab(id, btn) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const sec = document.getElementById(id);
  if (sec) sec.classList.add('active');
  if (btn) btn.classList.add('active');
}

function exportarClientesExcel() {
  alert("Função de exportação ainda não foi instalada neste JS.");
}

function exportarPropostasExcel() {
  alert("Função de exportação ainda não foi instalada neste JS.");
}

function addLinha() {
  alert("Função de propostas ainda não foi instalada neste JS.");
}

function renderItens() {}
function removerItem() {}
function salvarP() { alert("Função de proposta ainda não foi instalada neste JS."); }
function listarP() {}
function editarP() {}
function excluirP() {}
function salvarProgramacao() { alert("Função de programação ainda não foi instalada neste JS."); }
function listarProgramacoes() {}
function editarProgramacao() {}
function excluirProgramacao() {}
function carregarClienteProgramacao() {}
function gerarTxtProgramacao() { alert("Função TXT ainda não foi instalada neste JS."); }
function imprimir() { window.print(); }
function atualizarExtratoProgramacao() {}
function autoCEP() {}

window.salvarC = salvarC;
window.atualizarC = atualizarC;
window.editarC = editarC;
window.excluirC = excluirC;
window.limparC = limparC;
window.salvarV = salvarV;
window.carregarVendedor = carregarVendedor;
window.tab = tab;
window.mascaraTel = mascaraTel;
window.exportarClientesExcel = exportarClientesExcel;
window.exportarPropostasExcel = exportarPropostasExcel;
window.addLinha = addLinha;
window.renderItens = renderItens;
window.removerItem = removerItem;
window.salvarP = salvarP;
window.listarP = listarP;
window.editarP = editarP;
window.excluirP = excluirP;
window.salvarProgramacao = salvarProgramacao;
window.listarProgramacoes = listarProgramacoes;
window.editarProgramacao = editarProgramacao;
window.excluirProgramacao = excluirProgramacao;
window.carregarClienteProgramacao = carregarClienteProgramacao;
window.gerarTxtProgramacao = gerarTxtProgramacao;
window.imprimir = imprimir;
window.atualizarExtratoProgramacao = atualizarExtratoProgramacao;
window.autoCEP = autoCEP;

async function inicializar() {
  await carregarClientesCache();
  await atualizarC();
  await carregarVendedor();
}

window.onload = () => {
  inicializar().catch(err => console.error("Erro na inicialização:", err));
};