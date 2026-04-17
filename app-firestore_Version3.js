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
let perfisCache = [];
let propostasCache = [];
let programacoesCache = [];

function mascaraTel(i) {
  let v = i.value.replace(/\D/g, "");
  if (v.length <= 10) v = v.replace(/^(\d{2})(\d{4})(\d{0,4}).*/, "($1) $2-$3");
  else v = v.replace(/^(\d{2})(\d{5})(\d{0,4}).*/, "($1) $2-$3");
  i.value = v;
}

async function carregarClientesCache() {
  const snap = await getDocs(query(collection(db, "clientes"), orderBy("data", "desc")));
  clientesCache = [];
  snap.forEach(d => clientesCache.push({ id: d.id, ...d.data() }));
  return clientesCache;
}

async function carregarPerfisCache() {
  const snap = await getDocs(query(collection(db, "perfis_vendedor"), orderBy("data", "desc")));
  perfisCache = [];
  snap.forEach(d => perfisCache.push({ id: d.id, ...d.data() }));

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

  tbody.innerHTML = '';
  perfisCache
    .filter(p => !filtro || (p.nome || '').toLowerCase().includes(filtro) || (p.cel || '').toLowerCase().includes(filtro))
    .forEach((p, i) => {
      tbody.innerHTML += `<tr>
        <td>${p.nome || ''}</td>
        <td>${p.cel || ''}</td>
        <td class="actions">
          <span onclick="editarPerfil(${i})">✏️</span>
          <span onclick="excluirPerfil('${p.id}')">🗑️</span>
        </td>
      </tr>`;
    });
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

  const ids = ['nome', 'doc_c', 'tel_c', 'end', 'num', 'comp', 'cep'];
  const values = [c.nome || '', c.doc || '', c.tel || '', c.end || '', c.num || '', c.comp || '', c.cep || ''];

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
    const cep = document.getElementById('cep')?.value || '';
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
      comp,
      cep
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
  await listarP();
  await listarProgramacoes();
}

function editarPerfil(i) {
  const p = perfisCache[i];
  if (!p) return;
  document.getElementById('v_nome').value = p.nome || '';
  document.getElementById('v_cel').value = p.cel || '';
  document.getElementById('idx_v').value = i;
}

function limparPerfil() {
  document.getElementById('idx_v').value = '-1';
  document.getElementById('v_nome').value = '';
  document.getElementById('v_cel').value = '';
}

async function salvarV() {
  const idx = document.getElementById('idx_v')?.value || '-1';
  const obj = {
    data: new Date().toLocaleDateString('pt-BR'),
    nome: document.getElementById('v_nome')?.value || '',
    cel: document.getElementById('v_cel')?.value || ''
  };

  if (!obj.nome) return alert("Informe o nome do perfil!");

  if (idx === '-1') {
    await addDoc(collection(db, "perfis_vendedor"), obj);
  } else {
    const refId = perfisCache[Number(idx)]?.id;
    if (!refId) return alert("Perfil não encontrado para atualização.");
    await updateDoc(doc(db, "perfis_vendedor", refId), obj);
  }

  await carregarPerfisCache();
  filtrarPerfis();
  limparPerfil();
  alert("Perfil salvo!");
}

async function excluirPerfil(id) {
  if (!confirm("Excluir perfil?")) return;
  await deleteDoc(doc(db, "perfis_vendedor", id));
  await carregarPerfisCache();
  filtrarPerfis();
}

function atualizarDadosClienteProposta() {
  const cliId = document.getElementById('selC').value;
  const cli = clientesCache.find(c => c.id === cliId) || {};
  document.getElementById('prop_cnpj').value = cli.doc || '';
  document.getElementById('prop_tel').value = cli.tel || '';
}

async function salvarP() {
  const cliente = document.getElementById('selC').value;
  if (cliente === "") return alert("Selecione um cliente!");
  if (itensProposta.length === 0) return alert("Adicione itens!");

  const perfilId = document.getElementById('selV').value;
  const perfil = perfisCache.find(p => p.id === perfilId) || {};

  const obj = {
    data: new Date().toLocaleDateString('pt-BR'),
    cliId: cliente,
    perfilId: perfilId,
    perfilNome: perfil.nome || '',
    status: document.getElementById('status').value,
    itens: [...itensProposta],
    resp: document.getElementById('contato_obra').value,
    filial: document.getElementById('filial').value,
    obs: document.getElementById('obs').value,
    cfg: {
      b: document.getElementById('cfg_bomba').value,
      mb: document.getElementById('cfg_min_b').value,
      f: document.getElementById('cfg_fibra').value,
      fal: document.getElementById('cfg_faltante').value,
      p: document.getElementById('cfg_perm').value,
      rac: document.getElementById('cfg_rac').value,
      roc: document.getElementById('cfg_roc').value,
      prz: document.getElementById('cfg_prazo').value,
      hu: document.getElementById('cfg_h_uteis').value,
      hs: document.getElementById('cfg_h_sab').value,
      hd: document.getElementById('cfg_h_dom').value,
      md: document.getElementById('cfg_min_dom').value
    }
  };

  const idx = document.getElementById('idx_p').value;
  if (idx === "-1") {
    await addDoc(collection(db, "propostas"), obj);
  } else {
    const refId = propostasCache[Number(idx)]?.id;
    if (!refId) return alert("Proposta não encontrada para atualizar.");
    await updateDoc(doc(db, "propostas", refId), obj);
  }

  await listarP();
  alert("Proposta salva!");
}

function filtrarPropostas() {
  const filtroCliente = (document.getElementById('filtroPropostaCliente')?.value || '').toLowerCase();
  const filtroPerfil = document.getElementById('filtroPropostaPerfil')?.value || '';
  const filtroStatus = document.getElementById('filtroPropostaStatus')?.value || '';

  const l = document.getElementById('listaP');
  if (!l) return;

  l.innerHTML = '';

  propostasCache
    .filter(p => {
      const cli = clientesCache.find(c => c.id === p.cliId);
      const nomeCli = (cli?.nome || '').toLowerCase();
      const perfilNome = (p.perfilNome || '');
      const status = p.status || '';

      return (
        (!filtroCliente || nomeCli.includes(filtroCliente)) &&
        (!filtroPerfil || perfilNome === filtroPerfil) &&
        (!filtroStatus || status === filtroStatus)
      );
    })
    .forEach((p, i) => {
      const cli = clientesCache.find(c => c.id === p.cliId);
      const nomeCli = cli ? cli.nome : "Excluído";
      const perfilNome = p.perfilNome || "—";
      l.innerHTML += `<tr>
        <td>${p.data || ''}</td>
        <td>${nomeCli}</td>
        <td>${perfilNome}</td>
        <td><span class="badge bg-${p.status}">${p.status}</span></td>
        <td class="actions">
          <span onclick="editarP(${i})">✏️</span>
          <span onclick="excluirP('${p.id}')">🗑️</span>
        </td>
      </tr>`;
    });
}

async function listarP() {
  const dbP = document.getElementById('listaP');
  dbP.innerHTML = '';
  const snap = await getDocs(query(collection(db, "propostas"), orderBy("data", "desc")));
  propostasCache = [];
  snap.forEach(d => propostasCache.push({ id: d.id, ...d.data() }));
  filtrarPropostas();
}

function editarP(i) {
  const p = propostasCache[i];
  if (!p) return;
  document.getElementById('selC').value = p.cliId || '';
  document.getElementById('selV').value = p.perfilId || '';
  document.getElementById('status').value = p.status || 'andamento';
  document.getElementById('contato_obra').value = p.resp || '';
  document.getElementById('filial').value = p.filial || 'Divinopolis';
  document.getElementById('obs').value = p.obs || '';
  itensProposta = [...(p.itens || [])];
  renderItens();

  if (p.cfg) {
    document.getElementById('cfg_bomba').value = p.cfg.b || '';
    document.getElementById('cfg_min_b').value = p.cfg.mb || '';
    document.getElementById('cfg_fibra').value = p.cfg.f || '';
    document.getElementById('cfg_faltante').value = p.cfg.fal || '';
    document.getElementById('cfg_perm').value = p.cfg.p || '';
    document.getElementById('cfg_rac').value = p.cfg.rac || '';
    document.getElementById('cfg_roc').value = p.cfg.roc || '';
    document.getElementById('cfg_prazo').value = p.cfg.prz || '';
    document.getElementById('cfg_h_uteis').value = p.cfg.hu || '';
    document.getElementById('cfg_h_sab').value = p.cfg.hs || '';
    document.getElementById('cfg_h_dom').value = p.cfg.hd || '';
    document.getElementById('cfg_min_dom').value = p.cfg.md || '';
  }

  document.getElementById('idx_p').value = i;
  document.getElementById('btn_prop').innerText = "ATUALIZAR";
}

async function excluirP(id) {
  if (confirm("Excluir proposta?")) {
    await deleteDoc(doc(db, "propostas", id));
    await listarP();
  }
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

async function salvarProgramacao() {
  const obj = {
    data: new Date().toLocaleDateString('pt-BR'),
    cliId: document.getElementById('selProgC').value,
    obra_nome: document.getElementById('prog_obra_nome').value,
    contrato: document.getElementById('prog_contrato').value,
    solicitante: document.getElementById('prog_solicitante').value,
    cno: document.getElementById('prog_cno').value,
    email: document.getElementById('prog_email').value,
    contato_obra: document.getElementById('prog_contato_obra').value,
    volume: document.getElementById('prog_volume').value,
    fck: document.getElementById('prog_fck').value,
    slp: document.getElementById('prog_slp').value,
    brita: document.getElementById('prog_brita').value,
    preco: document.getElementById('prog_preco').value,
    bomba: document.getElementById('prog_bomba').value,
    pagamento: document.getElementById('prog_pagamento').value,
    end_obra: document.getElementById('prog_end_obra').value,
    obs: document.getElementById('prog_obs').value
  };

  const idx = document.getElementById('idx_prog').value;
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
  l.innerHTML = '';
  const snap = await getDocs(query(collection(db, "programacoes"), orderBy("data", "desc")));
  programacoesCache = [];
  snap.forEach(d => programacoesCache.push({ id: d.id, ...d.data() }));

  for (let i = 0; i < programacoesCache.length; i++) {
    const p = programacoesCache[i];
    const cli = clientesCache.find(c => c.id === p.cliId);
    const nomeCli = cli ? cli.nome : "Excluído";
    l.innerHTML += `<tr>
      <td>${p.data || ''}</td>
      <td>${nomeCli}</td>
      <td>${p.obra_nome || ''}</td>
      <td class="actions">
        <span onclick="editarProgramacao(${i})">✏️</span>
        <span onclick="excluirProgramacao('${p.id}')">🗑️</span>
      </td>
    </tr>`;
  }
  atualizarExtratoProgramacao();
}

function editarProgramacao(i) {
  const p = programacoesCache[i];
  if (!p) return;
  document.getElementById('selProgC').value = p.cliId || '';
  document.getElementById('prog_obra_nome').value = p.obra_nome || '';
  document.getElementById('prog_contrato').value = p.contrato || '';
  document.getElementById('prog_solicitante').value = p.solicitante || '';
  document.getElementById('prog_cno').value = p.cno || '';
  document.getElementById('prog_email').value = p.email || '';
  document.getElementById('prog_contato_obra').value = p.contato_obra || '';
  document.getElementById('prog_volume').value = p.volume || '';
  document.getElementById('prog_fck').value = p.fck || '';
  document.getElementById('prog_slp').value = p.slp || '';
  document.getElementById('prog_brita').value = p.brita || '';
  document.getElementById('prog_preco').value = p.preco || '';
  document.getElementById('prog_bomba').value = p.bomba || '';
  document.getElementById('prog_pagamento').value = p.pagamento || '';
  document.getElementById('prog_end_obra').value = p.end_obra || '';
  document.getElementById('prog_obs').value = p.obs || '';
  document.getElementById('idx_prog').value = i;
}

async function excluirProgramacao(id) {
  if (confirm("Excluir programação?")) {
    await deleteDoc(doc(db, "programacoes", id));
    await listarProgramacoes();
  }
}

async function carregarClienteProgramacao(id) {
  atualizarExtratoProgramacao();
}

function atualizarExtratoProgramacao() {
  const cliId = document.getElementById('selProgC').value;
  const cli = clientesCache.find(c => c.id === cliId) || {};

  document.getElementById('pp_obra_nome').innerText = document.getElementById('prog_obra_nome').value || '';
  document.getElementById('pp_contrato').innerText = document.getElementById('prog_contrato').value || '';
  document.getElementById('pp_cliente').innerText = cli.nome || '';
  document.getElementById('pp_cnpj').innerText = cli.doc || '';
  document.getElementById('pp_end_cliente').innerText = `${cli.end || ''}${cli.num ? ', ' + cli.num : ''}${cli.comp ? ' - ' + cli.comp : ''}`;
  document.getElementById('pp_cno').innerText = document.getElementById('prog_cno').value || '';
  document.getElementById('pp_email').innerText = document.getElementById('prog_email').value || '';
  document.getElementById('pp_contato_obra').innerText = document.getElementById('prog_contato_obra').value || '';
  document.getElementById('pp_solicitante').innerText = document.getElementById('prog_solicitante').value || '';
  document.getElementById('pp_end_obra').innerText = document.getElementById('prog_end_obra').value || '';
  document.getElementById('pp_fck').innerText = document.getElementById('prog_fck').value || '';
  document.getElementById('pp_slp').innerText = document.getElementById('prog_slp').value || '';
  document.getElementById('pp_brita').innerText = document.getElementById('prog_brita').value || '';
  document.getElementById('pp_preco').innerText = document.getElementById('prog_preco').value || '';
  document.getElementById('pp_bomba').innerText = document.getElementById('prog_bomba').value || '';
  document.getElementById('pp_volume').innerText = document.getElementById('prog_volume').value || '';
  document.getElementById('pp_pagamento').innerText = document.getElementById('prog_pagamento').value || '';
  document.getElementById('pp_obs').innerText = document.getElementById('prog_obs').value || '';
}

function imprimir() {
  try {
    const cliId = document.getElementById('selC').value;
    if (cliId === "" || itensProposta.length === 0) {
      alert("Selecione o cliente e adicione itens!");
      return;
    }

    const cli = clientesCache.find(c => c.id === cliId) || {};
    const vend = {
      nome: document.getElementById('v_nome').value || '',
      cel: document.getElementById('v_cel').value || ''
    };

    document.getElementById('p_cidade').innerText = document.getElementById('filial').value;
    document.getElementById('p_data').innerText = new Date().toLocaleDateString('pt-BR');
    document.getElementById('p_cliente').innerText = (cli.nome || '').toUpperCase();
    document.getElementById('p_cnpj').innerText = cli.doc || '';
    document.getElementById('p_tel').innerText = cli.tel || '';
    document.getElementById('p_obra').innerText = `${cli.end || ''}, ${cli.num || ''} ${cli.comp ? '- ' + cli.comp : ''}`.toUpperCase();
    document.getElementById('p_responsavel').innerText = document.getElementById('contato_obra').value || "RESPONSÁVEL";

    const tb = document.getElementById('p_tabela_itens');
    tb.innerHTML = '';
    itensProposta.forEach(it => {
      tb.innerHTML += `<tr>
        <td>${it.volume}</td>
        <td>${it.fck}</td>
        <td>${it.brita}</td>
        <td>120±20</td>
        <td>R$ ${Number(it.preco).toFixed(2)}</td>
      </tr>`;
    });

    document.getElementById('pr_bomba').innerText = document.getElementById('cfg_bomba').value;
    document.getElementById('pr_min_b').innerText = document.getElementById('cfg_min_b').value;
    document.getElementById('pr_fibra').innerText = document.getElementById('cfg_fibra').value;
    document.getElementById('pr_faltante').innerText = document.getElementById('cfg_faltante').value;
    document.getElementById('pr_perm').innerText = document.getElementById('cfg_perm').value;
    document.getElementById('pr_h_uteis').innerText = document.getElementById('cfg_h_uteis').value;
    document.getElementById('pr_h_sab').innerText = document.getElementById('cfg_h_sab').value;
    document.getElementById('pr_h_dom').innerText = document.getElementById('cfg_h_dom').value;
    document.getElementById('pr_min_dom').innerText = document.getElementById('cfg_min_dom').value;
    document.getElementById('pr_rac').innerText = document.getElementById('cfg_rac').value;
    document.getElementById('pr_roc').innerText = document.getElementById('cfg_roc').value;
    document.getElementById('pr_prazo').innerText = document.getElementById('cfg_prazo').value;
    document.getElementById('p_obs').innerText = document.getElementById('obs').value || "A COMBINAR";
    document.getElementById('p_vend').innerText = (vend.nome || '').toUpperCase();
    document.getElementById('p_v_cel').innerText = vend.cel || '';

    setTimeout(() => window.print(), 100);
  } catch (e) {
    alert("Erro ao gerar impressão: " + e.message);
  }
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
  let csv = "\ufeffData;Cliente;Perfil;Filial;Status;Responsavel;Valor_Total\n";
  propostasCache.forEach(p => {
    const cli = clientesCache.find(c => c.id === p.cliId);
    const nomeCli = cli ? cli.nome : "Excluido";
    const total = (p.itens || []).reduce((acc, it) => acc + Number(it.preco || 0), 0).toFixed(2);
    csv += `${p.data || ''};${nomeCli};${p.perfilNome || ''};${p.filial || ''};${p.status || ''};${p.resp || ''};${total}\n`;
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

async function inicializar() {
  const fcks = ["10 MPa","15 MPa","20 MPa","25 MPa","30 Mpa (HE)","30 Mpa","30 Mpa (PISO)","40 MPa"];
  const fs = document.getElementById('fck');
  fs.innerHTML = '';
  fcks.forEach(v => fs.innerHTML += `<option value="${v}">${v}</option>`);
  await carregarClientesCache();
  await carregarPerfisCache();
  await carregarVendedor();
  await atualizarC();
  await listarP();
  await listarProgramacoes();
  filtrarPerfis();
  atualizarExtratoProgramacao();
}

window.salvarC = salvarC;
window.atualizarC = atualizarC;
window.editarC = editarC;
window.excluirC = excluirC;
window.limparC = limparC;
window.salvarP = salvarP;
window.listarP = listarP;
window.editarP = editarP;
window.excluirP = excluirP;
window.salvarV = salvarV;
window.salvarProgramacao = salvarProgramacao;
window.listarProgramacoes = listarProgramacoes;
window.editarProgramacao = editarProgramacao;
window.excluirProgramacao = excluirProgramacao;
window.carregarClienteProgramacao = carregarClienteProgramacao;
window.gerarTxtProgramacao = gerarTxtProgramacao;
window.imprimir = imprimir;
window.exportarClientesExcel = exportarClientesExcel;
window.exportarPropostasExcel = exportarPropostasExcel;
window.mascaraTel = mascaraTel;
window.mascaraDoc = mascaraDoc;
window.mascaraCEP = mascaraCEP;
window.autoCEP = autoCEP;
window.tab = tab;
window.addLinha = addLinha;
window.renderItens = renderItens;
window.removerItem = removerItem;
window.atualizarExtratoProgramacao = atualizarExtratoProgramacao;
window.filtrarPropostas = filtrarPropostas;
window.filtrarPerfis = filtrarPerfis;
window.editarPerfil = editarPerfil;
window.excluirPerfil = excluirPerfil;
window.atualizarDadosClienteProposta = atualizarDadosClienteProposta;

function gerarTxtProgramacao() {
  const cliId = document.getElementById('selProgC').value;
  const cli = clientesCache.find(c => c.id === cliId) || {};
  const txt = [
    `Nome da obra: ${document.getElementById('prog_obra_nome').value || ''}`,
    `Contrato: ${document.getElementById('prog_contrato').value || ''}`,
    `Cliente: ${cli.nome || ''}`,
    `CNPJ: ${cli.doc || ''}`,
    `Endereço Cliente: ${(cli.end || '')}${cli.num ? ', ' + cli.num : ''}${cli.comp || ''}`,
    `CNO: ${document.getElementById('prog_cno').value || ''}`,
    `Email: ${document.getElementById('prog_email').value || ''}`,
    `Contato da obra: ${document.getElementById('prog_contato_obra').value || ''}`,
    `Solicitante: ${document.getElementById('prog_solicitante').value || ''}`,
    `End. Obra: ${document.getElementById('prog_end_obra').value || ''}`,
    `FCK: ${document.getElementById('prog_fck').value || ''}`,
    `SLP: ${document.getElementById('prog_slp').value || ''}`,
    `Brita: ${document.getElementById('prog_brita').value || ''}`,
    `Preço: ${document.getElementById('prog_preco').value || ''}`,
    `Bomba: ${document.getElementById('prog_bomba').value || ''}`,
    `Volume: ${document.getElementById('prog_volume').value || ''}`,
    `Forma pagamento: ${document.getElementById('prog_pagamento').value || ''}`,
    `Observação: ${document.getElementById('prog_obs').value || ''}`
  ].join('\n');

  const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'programacao.txt';
  link.click();
}
window.gerarTxtProgramacao = gerarTxtProgramacao;

window.onload = async () => {
  await inicializar();
};