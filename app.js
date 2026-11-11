/* Curso Chopin — aplicação do site (sem dependências). */
(() => {
  'use strict';
  const C = window.CURSO;
  const AULAS = new Map(C.aulas.map(a => [a.id, a]));
  const ORDEM = C.aulas.map(a => a.id);
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const PRETAS = new Set([1, 3, 6, 8, 10]);
  const ehPreta = m => PRETAS.has(((m % 12) + 12) % 12);
  const NOMES = ['Dó', 'Dó#', 'Ré', 'Ré#', 'Mi', 'Fá', 'Fá#', 'Sol', 'Sol#', 'Lá', 'Lá#', 'Si'];
  const nomeMidi = m => NOMES[m % 12] + (Math.floor(m / 12) - 1);
  const idTexto = id => id.replace('-', '.');
  let rotuloAula = id => 'aula ' + idTexto(id); // redefinido na seção de músicas
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const agoraS = () => performance.now() / 1000;
  const rotuloNota = n => (n.m % 12 === 0 && n.n === 'Dó') ? 'Dó' + (Math.floor(n.m / 12) - 1) : n.n;

  /* ------------------------------------------------------------ armazenamento */
  const store = {
    get(k, d) { try { const v = localStorage.getItem('cursoChopin.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('cursoChopin.' + k, JSON.stringify(v)); } catch (e) { /* sem armazenamento */ } }
  };
  const estado = {
    sessoes: store.get('sessoes', []),
    status: store.get('status', {}),
    prefs: Object.assign({ tempo: 1, tempoMusica: 0.6, metronomo: false, nomes: false, repetir: false, partitura: true, fluxo: true }, store.get('prefs', {})),
    musicas: store.get('musicas', []),
    jornada: store.get('jornada', null),
    niveisVistos: store.get('niveisVistos', [])
  };
  const salvar = () => { store.set('sessoes', estado.sessoes); store.set('status', estado.status); store.set('prefs', estado.prefs); store.set('musicas', estado.musicas); store.set('jornada', estado.jornada); store.set('niveisVistos', estado.niveisVistos); };
  const hojeStr = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  function statusAula(id) {
    const a = AULAS.get(id);
    if (a && a.tipo === 'repertorio') {
      const m = musicaDaPeca(a.peca); if (!m) return 'nova';
      const { feitas, total } = progressoMusica(m);
      return total && feitas >= total ? 'ok' : (feitas || estado.sessoes.some(s => s.aula.startsWith('m:' + m.id + ':'))) ? 'andamento' : 'nova';
    }
    const st = estado.status[id];
    if (st && st.concluida) return 'ok';
    if (estado.sessoes.some(s => s.aula === id)) return 'andamento';
    return 'nova';
  }
  function proximaAula() {
    for (const id of ORDEM) if (statusAula(id) !== 'ok') return id;
    return ORDEM[ORDEM.length - 1];
  }
  function registrarSessao(s) {
    if (Jornada.ativa) s.jornada = true;
    estado.sessoes.push(s);
    if (estado.sessoes.length > 5000) estado.sessoes.splice(0, estado.sessoes.length - 5000);
    salvar();
    Nuvem.agendar();
  }


  /* ------------------------------------------------------------ nuvem (Supabase) */
  const idSessao = s => s.quando + '|' + s.aula;
  const Nuvem = {
    cli: null, usuario: null, estado: 'sem-config', erro: '', email: store.get('nuvemEmail', ''),
    ultima: store.get('nuvemUltima', null), ocupada: false, timer: null,
    iniciar() {
      const cfg = window.CURSO_NUVEM || {};
      if (!cfg.url || !cfg.chave || !window.supabase || !window.supabase.createClient) { this.estado = 'sem-config'; return; }
      try {
        this.cli = window.supabase.createClient(cfg.url, cfg.chave, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'cursoChopin.auth' } });
      } catch (e) { this.estado = 'sem-config'; return; }
      this.estado = 'fora';
      this.cli.auth.onAuthStateChange((ev, sessao) => {
        this.usuario = sessao ? sessao.user : null;
        if (!this.usuario) this.estado = 'fora'; else if (this.estado === 'fora') this.estado = 'ligada';
        this.avisar();
      });
      this.cli.auth.getSession().then(({ data }) => {
        this.usuario = data && data.session ? data.session.user : null;
        this.estado = this.usuario ? 'ligada' : 'fora';
        this.avisar();
        if (this.usuario) this.sincronizar();
      }).catch(() => {});
      window.addEventListener('online', () => this.agendar());
    },
    get logado() { return !!(this.cli && this.usuario); },
    avisar() { document.dispatchEvent(new CustomEvent('nuvem-estado')); },
    agendar() { if (!this.logado) return; clearTimeout(this.timer); this.timer = setTimeout(() => this.sincronizar(), 500); },
    traduzir(e) {
      const m = String((e && (e.message || e.error_description || e.msg)) || e || '');
      if (/invalid login credentials|invalid_grant/i.test(m)) return 'E-mail ou senha errados. Se é a primeira vez, use "Criar conta".';
      if (/email not confirmed/i.test(m)) return 'Esta conta foi criada com a confirmação por e-mail ligada. No Supabase, em Authentication → Users, apague esse usuário e crie a conta de novo aqui.';
      if (/already registered|already been registered|user already exists/i.test(m)) return 'Esse e-mail já tem conta. Use "Entrar".';
      if (/signups? not allowed|signup is disabled/i.test(m)) return 'Criar contas está desligado no Supabase. Use "Entrar" com a conta que você já criou.';
      if (/password should be|weak password|at least/i.test(m)) return 'A senha precisa ter pelo menos 6 caracteres.';
      if (/rate limit|too many|seconds/i.test(m)) return 'Muitas tentativas seguidas. Espere um minuto e tente de novo.';
      if (/musicas/i.test(m) && /does not exist|schema cache|relation|not find/i.test(m))
        return 'As aulas estão salvas na nuvem. Para guardar também as músicas, rode o arquivo ferramentas/supabase-musicas.sql no SQL Editor do Supabase e toque em Sincronizar agora.';
      if (/fetch|network|load failed|offline/i.test(m) || !navigator.onLine)
        return 'Sem conexão com a nuvem agora. Seus dados continuam salvos neste aparelho e sobem quando ela voltar. Se isso durar mais de um dia, abra o painel do Supabase: projetos gratuitos parados por uma semana são pausados e precisam ser restaurados lá.';
      return 'A nuvem respondeu com um erro: ' + m;
    },
    async entrar(email, senha) {
      this.email = email.trim(); store.set('nuvemEmail', this.email);
      const { data, error } = await this.cli.auth.signInWithPassword({ email: this.email, password: senha });
      if (error) throw error;
      this.usuario = data.user; this.estado = 'ligada';
      await this.sincronizar(true);
    },
    async criarConta(email, senha) {
      this.email = email.trim(); store.set('nuvemEmail', this.email);
      const { data, error } = await this.cli.auth.signUp({ email: this.email, password: senha });
      if (error) throw error;
      if (!data.session) throw new Error('CONFIRMACAO_LIGADA');
      this.usuario = data.user; this.estado = 'ligada';
      await this.sincronizar(true);
    },
    async sincronizarMusicas(uid) {
      const { data, error } = await this.cli.from('musicas').select('id,dados,atualizado_em');
      if (error) throw error;
      let mudou = false;
      (data || []).forEach(r => {
        const local = estado.musicas.find(x => x.id === r.id);
        const remota = Date.parse(r.atualizado_em) || 0, loc = local ? (Date.parse(local.atualizado_em) || 0) : -1;
        if (!local || (remota > loc && local.sync !== false) || (remota > loc + 1000)) {
          const nova = Object.assign({}, r.dados, { sync: true });
          if (local) Object.assign(local, nova); else estado.musicas.push(nova);
          mudou = true;
        }
      });
      const pend = estado.musicas.filter(x => x.sync === false);
      if (pend.length) {
        const linhas = pend.map(x => { const d = Object.assign({}, x); delete d.sync; return { user_id: uid, id: x.id, titulo: x.titulo, dados: d, removida: !!x.removida, atualizado_em: x.atualizado_em }; });
        const { error: e2 } = await this.cli.from('musicas').upsert(linhas, { onConflict: 'user_id,id' });
        if (e2) throw e2;
        pend.forEach(x => { x.sync = true; });
        mudou = true;
      }
      if (mudou) { cachePlanos.clear(); salvar(); document.dispatchEvent(new CustomEvent('musicas-mudaram')); }
    },
    async sair() { await this.cli.auth.signOut(); this.usuario = null; this.estado = 'fora'; this.avisar(); },
    async sincronizar(baixarTudo) {
      if (!this.logado || this.ocupada) return;
      this.ocupada = true; this.estado = 'sincronizando'; this.avisar();
      try {
        const uid = this.usuario.id;
        if (baixarTudo || !store.get('nuvemBaixou.' + uid, false)) {
          let de = 0, linhas = [];
          for (;;) {
            const { data, error } = await this.cli.from('sessoes').select('id,dados').order('quando').range(de, de + 999);
            if (error) throw error;
            linhas = linhas.concat(data || []);
            if (!data || data.length < 1000) break;
            de += 1000;
          }
          const vistos = new Set(estado.sessoes.map(idSessao));
          linhas.forEach(r => { if (!vistos.has(r.id) && r.dados && r.dados.quando) { estado.sessoes.push(Object.assign({}, r.dados, { sync: true })); vistos.add(r.id); } });
          estado.sessoes.sort((a, b) => a.quando.localeCompare(b.quando));
          const { data: st, error: e2 } = await this.cli.from('status_aulas').select('dados').maybeSingle();
          if (e2) throw e2;
          if (st && st.dados) for (const [k, v] of Object.entries(st.dados)) if (!estado.status[k]) estado.status[k] = v;
          store.set('nuvemBaixou.' + uid, true);
          salvar();
        }
        const pend = estado.sessoes.filter(x => !x.sync);
        for (let i = 0; i < pend.length; i += 200) {
          const lote = pend.slice(i, i + 200);
          const linhas = lote.map(x => { const d = Object.assign({}, x); delete d.sync; return { user_id: uid, id: idSessao(x), quando: x.quando, aula: x.aula, dados: d }; });
          const { error } = await this.cli.from('sessoes').upsert(linhas, { onConflict: 'user_id,id' });
          if (error) throw error;
          lote.forEach(x => { x.sync = true; });
          salvar();
        }
        const { error: e3 } = await this.cli.from('status_aulas').upsert({ user_id: uid, dados: estado.status, atualizado_em: new Date().toISOString() }, { onConflict: 'user_id' });
        if (e3) throw e3;
        this.ultima = new Date().toISOString(); store.set('nuvemUltima', this.ultima);
        this.erro = ''; this.estado = 'ligada';
        try { await this.sincronizarMusicas(uid); }
        catch (e) { this.erro = this.traduzir(e); this.estado = 'erro'; }
      } catch (e) {
        this.erro = this.traduzir(e); this.estado = 'erro';
      } finally {
        this.ocupada = false; this.avisar();
      }
    }
  };

  /* ------------------------------------------------------------ som */
  const Som = {
    ctx: null,
    iniciar() {
      // iPhone/iPad: sem isso, o modo silencioso deixa o som do site mudo
      try { if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback'; } catch (e) { /* nada */ }
      if (!this.destravado && /iP(hone|ad|od)|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document) {
        this.destravado = true;
        try { const a = new Audio('data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA'); a.loop = true; a.setAttribute('playsinline', ''); a.play().catch(() => {}); this.silencio = a; } catch (e) { /* nada */ }
      }
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
        this.saida = this.ctx.createDynamicsCompressor();
        this.mestre = this.ctx.createGain();
        this.mestre.gain.value = 0.7;
        this.mestre.connect(this.saida);
        this.saida.connect(this.ctx.destination);
      }
      if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
      if (!this.ligado) { this.ligado = true; document.dispatchEvent(new CustomEvent('som-ligado')); }
      return this.ctx;
    },
    get precisaToque() {
      // iPhone/iPad (e Macs com tela de toque): o som só sai depois de um toque do usuário
      const toque = 'ontouchend' in document || navigator.maxTouchPoints > 1;
      return toque && (!this.ligado || (this.ctx && this.ctx.state !== 'running'));
    },
    confirmar() {
      // três notas da posição de Chopin, para a pessoa ouvir que o som está ligado
      const ctx = this.iniciar(); if (!ctx) return;
      [64, 68, 71].forEach((m, i) => this.nota(m, ctx.currentTime + 0.05 + i * 0.18, 0.5, 0.6));
    },
    nota(m, quando, dur, v = 0.7) {
      const ctx = this.ctx; if (!ctx) return;
      const f = 440 * Math.pow(2, (m - 69) / 12);
      const g = ctx.createGain();
      const filtro = ctx.createBiquadFilter();
      filtro.type = 'lowpass';
      filtro.frequency.value = Math.min(12000, 900 + f * 2 + v * 3500);
      const o1 = ctx.createOscillator(); o1.type = 'triangle'; o1.frequency.value = f;
      const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2;
      const g2 = ctx.createGain(); g2.gain.value = 0.22;
      o1.connect(g); o2.connect(g2); g2.connect(g); g.connect(filtro); filtro.connect(this.mestre);
      const pico = 0.06 + 0.3 * v;
      const fim = quando + Math.max(dur, 0.09);
      const t1 = quando + 0.006;
      const t2 = Math.min(quando + 0.22, fim);
      const queda = 1.1 + Math.max(0, (84 - m) / 28);
      g.gain.setValueAtTime(0.0001, quando);
      g.gain.exponentialRampToValueAtTime(pico, t1);
      g.gain.exponentialRampToValueAtTime(pico * 0.4, Math.max(t2, t1 + 0.01));
      if (fim > t2 + 0.01) g.gain.exponentialRampToValueAtTime(Math.max(0.0002, pico * 0.4 * Math.exp(-(fim - t2) / queda)), fim);
      g.gain.setTargetAtTime(0.0001, fim, 0.05);
      o1.start(quando); o2.start(quando); o1.stop(fim + 0.4); o2.stop(fim + 0.4);
    },
    clique(quando, forte) {
      const ctx = this.ctx; if (!ctx) return;
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'square'; o.frequency.value = forte ? 1660 : 1100;
      g.gain.setValueAtTime(0.0001, quando);
      g.gain.exponentialRampToValueAtTime(forte ? 0.16 : 0.1, quando + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, quando + 0.04);
      o.connect(g); g.connect(this.mestre); o.start(quando); o.stop(quando + 0.06);
    }
  };

  /* ------------------------------------------------------------ ligar o som (iPad/iPhone) */
  const AtivarSom = {
    el: null,
    montar() {
      if (this.el) return;
      this.el = document.createElement('div');
      this.el.id = 'ativar-som'; this.el.className = 'ativar-som'; this.el.hidden = true;
      this.el.innerHTML = `<button type="button" class="ativar-som-btn" aria-label="Ligar o som do curso">
          <span class="ativar-som-ico" aria-hidden="true">${ICONE_PLAY}</span>
          <span class="ativar-som-txt"><b>Toque aqui para ligar o som</b><span>O iPad só libera o áudio depois de um toque. Você vai ouvir três notas de confirmação.</span></span>
        </button>`;
      document.body.appendChild(this.el);
      this.el.querySelector('button').addEventListener('click', () => { Som.confirmar(); this.esconder(); });
      document.addEventListener('som-ligado', () => this.esconder());
      document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(() => this.conferir(), 300); });
    },
    conferir() {
      this.montar();
      if (Som.precisaToque) { if (Som.ctx && Som.ctx.state !== 'running') Som.ligado = false; this.el.hidden = false; }
      else this.esconder();
    },
    esconder() { if (this.el) this.el.hidden = true; }
  };

  /* ------------------------------------------------------------ narração */
  const Narr = {
    audio: null, temArquivo: new Map(), botao: null,
    verificar(id) {
      if (this.temArquivo.has(id)) return;
      this.temArquivo.set(id, null);
      if (location.protocol === 'file:') { this.temArquivo.set(id, false); return; }
      fetch('audio/' + id + '.m4a', { method: 'HEAD', cache: 'no-store' })
        .then(r => this.temArquivo.set(id, r.ok && !/text\/html/.test(r.headers.get('content-type') || '')))
        .catch(() => this.temArquivo.set(id, false));
    },
    parar() {
      if (this.audio) { this.audio.pause(); this.audio = null; }
      try { window.speechSynthesis && speechSynthesis.cancel(); } catch (e) { /* nada */ }
      if (this.botao) { this.botao.dataset.tocando = 'false'; this.botao.innerHTML = ICONE_PLAY; this.botao.setAttribute('aria-label', 'Ouvir explicação'); }
      this.botao = null;
    },
    tocar(id, texto, botao) {
      const mesmo = this.botao === botao;
      this.parar();
      if (mesmo) return;
      this.botao = botao;
      botao.dataset.tocando = 'true'; botao.innerHTML = ICONE_PAUSA; botao.setAttribute('aria-label', 'Parar explicação');
      const acabou = () => { if (this.botao === botao) this.parar(); };
      if (this.temArquivo.get(id)) {
        this.audio = new Audio('audio/' + id + '.m4a');
        this.audio.onended = acabou;
        this.audio.play().catch(() => this.falar(texto, acabou));
      } else {
        this.falar(texto, acabou);
      }
    },
    falar(texto, acabou) {
      if (!('speechSynthesis' in window)) { acabou(); return; }
      const u = new SpeechSynthesisUtterance(texto);
      u.lang = 'pt-BR'; u.rate = 1;
      const v = vozPt();
      if (v) u.voice = v;
      u.onend = acabou; u.onerror = acabou;
      speechSynthesis.speak(u);
    }
  };
  function vozPt() {
    try {
      const vozes = speechSynthesis.getVoices();
      return vozes.find(x => /luciana/i.test(x.name)) || vozes.find(x => x.lang === 'pt-BR' || x.lang === 'pt_BR') || vozes.find(x => /^pt/i.test(x.lang)) || null;
    } catch (e) { return null; }
  }
  const espera = ms => new Promise(r => setTimeout(r, ms));

  /* ------------------------------------------------------------ aula guiada: fala por passo + demonstração */
  const Guia = {
    ativo: false, cancelado: false, pularPasso: false, atual: null, cache: new Map(),
    async falar(id, texto) {
      const ctx = Som.iniciar();
      let buf = this.cache.get(id);
      if (buf === undefined) {
        buf = null;
        if (ctx && location.protocol !== 'file:') {
          try {
            const r = await fetch('audio/' + id + '.m4a');
            if (r.ok && !/text\/html/.test(r.headers.get('content-type') || '')) buf = await ctx.decodeAudioData(await r.arrayBuffer());
          } catch (e) { buf = null; }
        }
        this.cache.set(id, buf);
      }
      if (this.cancelado || this.pularPasso) return;
      if (buf) {
        return new Promise(res => {
          const fonte = ctx.createBufferSource(); fonte.buffer = buf;
          fonte.connect(ctx.destination);
          let feito = false; const fim = () => { if (!feito) { feito = true; this.atual = null; res(); } };
          fonte.onended = fim;
          this.atual = { parar: () => { try { fonte.stop(); } catch (e) { /* já parou */ } fim(); } };
          fonte.start();
        });
      }
      if ('speechSynthesis' in window) {
        return new Promise(res => {
          const u = new SpeechSynthesisUtterance(texto);
          u.lang = 'pt-BR'; const v = vozPt(); if (v) u.voice = v;
          let feito = false; const fim = () => { if (!feito) { feito = true; this.atual = null; res(); } };
          u.onend = fim; u.onerror = fim;
          this.atual = { parar: () => { try { speechSynthesis.cancel(); } catch (e) { /* nada */ } fim(); } };
          speechSynthesis.speak(u);
          setTimeout(fim, 2500 + texto.length * 85); // alguns navegadores não avisam quando a voz termina
        });
      }
      return espera(1500 + texto.length * 60);
    },
    pular() { this.pularPasso = true; if (this.atual) this.atual.parar(); if (playerAtual) playerAtual.interromperTrecho(); },
    parar() { if (!this.ativo) return; this.cancelado = true; this.pular(); }
  };
  async function rodarGuia(a, pl) {
    Narr.parar();
    Guia.cancelado = false; Guia.ativo = true;
    try { if ('speechSynthesis' in window && !Guia.cache.size) speechSynthesis.speak(new SpeechSynthesisUtterance(' ')); } catch (e) { /* iOS: destrava a voz dentro do toque */ }
    for (let i = 0; i < a.guia.length && !Guia.cancelado; i++) {
      const g = a.guia[i];
      Guia.pularPasso = false;
      barraGuia(a, i);
      pl.mostrarTeclas(g.mostrar);
      await Guia.falar(`aula-${a.id}-g${i + 1}`, g.fala);
      if (Guia.cancelado) break;
      if (g.tocar && !Guia.pularPasso) { await pl.tocarTrecho(g.tocar[0], g.tocar[1]); if (!Guia.cancelado) await espera(500); }
      else if (!Guia.pularPasso) await espera(350);
    }
    const terminou = !Guia.cancelado;
    Guia.ativo = false; Guia.cancelado = false;
    pl.mostrarTeclas(terminou ? a.guia[a.guia.length - 1].mostrar : null);
    barraGuia(a, -1, terminou);
  }
  function barraGuia(a, i, terminou) {
    const el = $('#guia-barra'); if (!el) return;
    if (i < 0) {
      el.innerHTML = `<button class="btn primario" type="button" data-guia="iniciar">▶ Aula guiada</button>
        <span class="aviso">${terminou ? 'Pronto. Agora toque em <b>▶ Praticar</b> e faça você.' : 'A narração explica cada passo e o teclado mostra junto: teclas acesas com os dedos e trechos tocados.'}</span>`;
      return;
    }
    el.innerHTML = `<div class="guia-passo"><span class="rotulo">Aula guiada · passo ${i + 1} de ${a.guia.length}</span>
        <p class="legenda">${esc(a.guia[i].fala)}</p></div>
      <div class="linha-botoes"><button class="btn" type="button" data-guia="pular">Pular ›</button><button class="btn" type="button" data-guia="parar">Parar</button></div>`;
  }


  /* ------------------------------------------------------------ fluxo automático: explica, guia, pratica, avança */
  const rolar = (el, block = 'center') => { if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block }); };
  const Fluxo = {
    ativo: false, pendente: null, timer: null, cancelado: false,
    ligado() { return estado.prefs.fluxo !== false; },
    parar() {
      this.cancelado = true; this.ativo = false; this.pendente = null;
      if (this.timer) { clearInterval(this.timer); this.timer = null; }
      Guia.parar(); if (Guia.atual) Guia.atual.parar();
      const b = $('#fluxo-barra'); if (b) b.remove();
    },
    async falar(id, texto) {
      Guia.cancelado = false; Guia.pularPasso = false; Guia.ativo = true;
      try { await Guia.falar(id, texto); } finally { Guia.ativo = false; }
      return !this.cancelado;
    },
    // começa quando o som estiver destravado; senão, espera o toque no cartão de som
    quandoPuder(fn) {
      if (!this.ligado()) return;
      if (!Som.ligado && navigator.userActivation && navigator.userActivation.hasBeenActive) Som.iniciar();
      if (Som.ligado) { fn(); return; }
      this.pendente = fn;
      const st = $('.status'); if (st) st.innerHTML = 'Toque em <b>Ligar o som</b> e a aula começa sozinha: explicação, demonstração e a sua vez.';
    },
    // aula prática: explicação (ou aula guiada) → praticar → resultado → avança ou repete
    async pratica(a, pl, aoPassar) {
      this.parar(); Narr.parar(); this.cancelado = false; this.ativo = true;
      const raiz = pl.raiz;
      rolar(raiz, 'start');
      pl.atualizarStatus('Explicação: ouça e veja as teclas acesas.');
      if (a.guia && a.guia.length) {
        await rodarGuia(a, pl);
      } else {
        const ev = pl.eventos[0];
        if (ev) pl.mostrarTeclas(ev.notas.filter(n => n.f).map(n => [n.m, n.f, n.h]));
        rolar($('.palco', raiz));
        await this.falar('aula-' + a.id, a.narracao);
      }
      if (this.cancelado || !this.ativo) return;
      await espera(400);
      if (this.cancelado) return;
      // sua vez: entra em Praticar e dispara a contagem
      const bPrat = $('[data-modo="praticar"]', raiz);
      if (bPrat) { this.clicando = true; bPrat.click(); this.clicando = false; }
      rolar($('.palco', raiz));
      pl.atualizarStatus('<b>Sua vez.</b> Toque o exercício no piano; o site espera cada nota.');
    },
    // depois do resultado
    async resultado(a, pl, r, opts) {
      if (!this.ativo || this.cancelado) return;
      rolar($('#resultado'));
      await espera(300);
      const passou = r.passou && !r.parcial;
      const seg = passou ? 6 : 5;
      const caixa = $('#resultado .resultado'); if (!caixa) return;
      const barra = document.createElement('div');
      barra.id = 'fluxo-barra'; barra.className = 'fluxo-barra';
      const titulo = passou ? (opts.ultimo ? 'Jornada concluída' : 'Próxima etapa') : 'Tentar de novo';
      barra.innerHTML = `<div class="fluxo-txt"><b>${titulo}</b> <span id="fluxo-quando">depois do feedback</span></div>
        <div class="linha-botoes">
          <button class="btn primario" type="button" data-fluxo="agora">${passou ? 'Agora →' : 'Tentar agora'}</button>
          ${passou ? '<button class="btn" type="button" data-fluxo="repetir">Repetir esta</button>' : '<button class="btn" type="button" data-fluxo="ouvir">Ouvir o trecho</button>'}
          <button class="btn" type="button" data-fluxo="parar">Parar o automático</button>
        </div>`;
      caixa.prepend(barra);
      let restante = seg;
      const avancar = () => {
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
        barra.remove();
        if (passou) { if (opts.aoPassar) opts.aoPassar(); }
        else { pl.reiniciar(); $('#resultado').innerHTML = ''; const bPrat = $('[data-modo="praticar"]', pl.raiz); if (bPrat) { this.clicando = true; bPrat.click(); this.clicando = false; } rolar($('.palco', pl.raiz)); }
      };
      barra.addEventListener('click', e => {
        const b = e.target.closest('[data-fluxo]'); if (!b) return;
        if (b.dataset.fluxo === 'agora') avancar();
        if (b.dataset.fluxo === 'repetir') { if (this.timer) clearInterval(this.timer); barra.remove(); pl.reiniciar(); $('#resultado').innerHTML = ''; this.pratica(a, pl, opts.aoPassar); }
        if (b.dataset.fluxo === 'ouvir') { if (this.timer) clearInterval(this.timer); barra.remove(); const bO = $('[data-modo="ouvir"]', pl.raiz); if (bO) { this.clicando = true; bO.click(); this.clicando = false; } rolar($('.palco', pl.raiz)); this.ativo = false; }
        if (b.dataset.fluxo === 'parar') { this.parar(); estado.prefs.fluxo = false; salvar(); const chk = $('#fluxo-chk'); if (chk) chk.checked = false; }
      });
      // espera o feedback falado terminar antes de contar
      await (this.feedbackAtual || Promise.resolve());
      if (this.cancelado || !barra.isConnected) return;
      const q = $('#fluxo-quando'); if (q) q.innerHTML = `em <span class="mono" id="fluxo-seg">${seg}</span> s`;
      this.timer = setInterval(() => {
        restante--; const s = $('#fluxo-seg'); if (s) s.textContent = restante;
        if (restante <= 0) avancar();
      }, 1000);
    }
  };
  document.addEventListener('som-ligado', () => { const f = Fluxo.pendente; Fluxo.pendente = null; if (f) setTimeout(f, 300); });
  // o primeiro toque em qualquer lugar destrava o som e dispara o fluxo pendente
  document.addEventListener('pointerdown', () => { if (Fluxo.pendente && !Som.ligado) Som.iniciar(); }, { capture: true, passive: true });

  const ICONE_PLAY = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M4 2.5v11l9.5-5.5z"/></svg>';
  const ICONE_PAUSA = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M3.5 2.5h3.2v11H3.5zm5.8 0h3.2v11H9.3z"/></svg>';
  function blocoNarracao(id, titulo, texto) {
    Narr.verificar(id);
    const seg = Math.round(texto.split(/\s+/).length / 2.6);
    return `<div class="narracao">
      <button class="play" type="button" data-narr="${esc(id)}" aria-label="Ouvir explicação">${ICONE_PLAY}</button>
      <div><span class="qual">${esc(titulo)}</span> <span class="suave mono">· ${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, '0')}</span></div>
      <details><summary>Ler o texto</summary><p>${esc(texto)}</p></details>
    </div>`;
  }
  const TEXTOS_NARR = new Map([['intro', C.intro], ...C.modulos.filter(m => m.narracao).map(m => ['modulo-' + m.n, m.narracao]), ...C.aulas.map(a => ['aula-' + a.id, a.narracao])]);
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-narr]');
    if (!b) return;
    Som.iniciar();
    Narr.tocar(b.dataset.narr, TEXTOS_NARR.get(b.dataset.narr) || '', b);
  });

  /* ------------------------------------------------------------ MIDI */
  const Midi = {
    acesso: null, estado: 'pedir', nome: '', ouvintes: new Set(), teclas: new Map(),
    async iniciar(perguntar) {
      if (!navigator.requestMIDIAccess) { this.definir('sem-suporte'); return; }
      if (!perguntar) {
        try {
          const p = await navigator.permissions.query({ name: 'midi' });
          if (p.state !== 'granted') { this.definir('pedir'); return; }
        } catch (e) { this.definir('pedir'); return; }
      }
      try {
        this.acesso = await navigator.requestMIDIAccess({ sysex: false });
        this.acesso.onstatechange = () => this.ligar();
        this.ligar();
      } catch (e) { this.definir('negado'); }
    },
    ligar() {
      const entradas = [...this.acesso.inputs.values()].filter(i => i.state !== 'disconnected');
      entradas.forEach(i => { i.onmidimessage = ev => this.mensagem(ev.data, ev.timeStamp || performance.now()); });
      this.nome = entradas.map(i => i.name).join(', ');
      this.definir(entradas.length ? 'conectado' : 'sem-piano');
    },
    mensagem(d, ts) {
      const cmd = d[0] & 0xf0;
      if (cmd === 0x90 && d[2] > 0) { this.teclas.set(d[1], d[2]); this.emitir('on', d[1], d[2], ts); }
      else if (cmd === 0x80 || (cmd === 0x90 && d[2] === 0)) { this.teclas.delete(d[1]); this.emitir('off', d[1], 0, ts); }
      else if (cmd === 0xB0 && d[1] === 64) { const baixo = d[2] >= 64; if (baixo !== this.pedal) { this.pedal = baixo; this.emitir('pedal', 64, d[2], ts); } }
    },
    pedal: false,
    emitir(tipo, m, v, ts) { this.ouvintes.forEach(f => f(tipo, m, v, ts)); },
    definir(est) {
      this.estado = est;
      const pill = $('#pill-midi'), t = $('#pill-texto');
      pill.dataset.estado = est;
      t.textContent = {
        pedir: 'Conectar piano', conectado: 'Piano: ' + (this.nome || 'conectado'), 'sem-piano': 'Nenhum piano no cabo',
        'sem-suporte': 'Este navegador não lê MIDI', negado: 'MIDI bloqueado'
      }[est];
      pill.title = est === 'sem-suporte' ? 'No iPad, abra o curso no app MIDIWeb Browser. No Mac, use o Chrome.'
        : est === 'negado' ? 'Permita o acesso a MIDI nas configurações do navegador e recarregue.' : '';
      document.dispatchEvent(new CustomEvent('midi-estado'));
    }
  };
  $('#pill-midi').addEventListener('click', () => {
    Som.iniciar();
    if (Midi.estado === 'pedir' || Midi.estado === 'sem-piano') Midi.iniciar(true);
    else if (Midi.estado === 'sem-suporte') aviso('Este navegador não lê MIDI. No iPad, abra o curso no app MIDIWeb Browser; no Mac, use o Chrome.');
    else if (Midi.estado === 'negado') aviso('O acesso a MIDI foi bloqueado. Libere nas configurações do navegador e recarregue a página.');
  });
  function aviso(txt) {
    const st = $('.status');
    if (st) st.textContent = txt; else alertaInline(txt);
  }
  function alertaInline(txt) {
    let el = $('#aviso-global');
    if (!el) { el = document.createElement('p'); el.id = 'aviso-global'; el.className = 'aviso wrap'; $('main').prepend(el); }
    el.textContent = txt;
  }

  /* ------------------------------------------------------------ teclado (desenho) */
  function faixa(notas, minBrancas = 15) {
    let lo = Math.min(...notas.map(n => n.m)) - 1, hi = Math.max(...notas.map(n => n.m)) + 1;
    const brancas = () => { let c = 0; for (let m = lo; m <= hi; m++) if (!ehPreta(m)) c++; return c; };
    let lado = 0;
    while (brancas() < minBrancas) { if (lado++ % 2) lo--; else hi++; }
    while (ehPreta(lo)) lo--;
    while (ehPreta(hi)) hi++;
    return [lo, hi];
  }
  function geometria(lo, hi, w) {
    const brancas = [];
    for (let m = lo; m <= hi; m++) if (!ehPreta(m)) brancas.push(m);
    const ww = w / brancas.length, bw = ww * 0.6;
    const pos = new Map();
    brancas.forEach((m, i) => pos.set(m, { x: i * ww, w: ww, preta: false }));
    for (let m = lo; m <= hi; m++) if (ehPreta(m)) {
      const ant = pos.get(m - 1);
      if (ant) pos.set(m, { x: ant.x + ww - bw / 2, w: bw, preta: true });
    }
    return { pos, ww, bw };
  }
  function desenharTeclado(ctx, geo, lo, hi, y, h, marcas, opts = {}) {
    const cor = { branca: css('--key-white'), preta: css('--key-black'), borda: css('--key-edge') };
    for (let m = lo; m <= hi; m++) {
      const p = geo.pos.get(m); if (!p || p.preta) continue;
      const mk = marcas.get(m);
      ctx.fillStyle = mk ? mk.cor : cor.branca;
      ctx.fillRect(p.x + 0.5, y, p.w - 1, h);
      ctx.strokeStyle = cor.borda; ctx.lineWidth = 1;
      ctx.strokeRect(p.x + 0.5, y, p.w - 1, h);
      if (mk && mk.contorno) { ctx.strokeStyle = mk.contorno; ctx.lineWidth = 3; ctx.strokeRect(p.x + 2, y + 2, p.w - 4, h - 4); }
      const rot = (mk && mk.rotulo) || (m % 12 === 0 ? nomeMidi(m) : (opts.nomes ? NOMES[m % 12] : ''));
      if (rot && p.w > 18) {
        ctx.fillStyle = mk && mk.textoCor ? mk.textoCor : '#5b5f6a';
        ctx.font = `600 ${Math.min(13, p.w * 0.36)}px ${css('--font-body')}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        ctx.fillText(rot, p.x + p.w / 2, y + h - 8);
      }
      if (m === 60 && !mk) { ctx.fillStyle = '#9aa0ad'; ctx.beginPath(); ctx.arc(p.x + p.w / 2, y + h - 26, 2.5, 0, 7); ctx.fill(); }
    }
    for (let m = lo; m <= hi; m++) {
      const p = geo.pos.get(m); if (!p || !p.preta) continue;
      const mk = marcas.get(m);
      ctx.fillStyle = mk ? mk.cor : cor.preta;
      const bh = h * 0.62;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(p.x, y, p.w, bh, [0, 0, 3, 3]) : ctx.rect(p.x, y, p.w, bh); ctx.fill();
      if (mk && mk.contorno) { ctx.strokeStyle = mk.contorno; ctx.lineWidth = 3; ctx.strokeRect(p.x + 1.5, y + 1.5, p.w - 3, bh - 3); }
      const rot = (mk && mk.rotulo) || (opts.nomes ? NOMES[m % 12] : '');
      if (rot && p.w > 14) {
        ctx.fillStyle = mk ? (mk.textoCor || '#fff') : '#c8ccd6';
        ctx.font = `600 ${Math.min(11, p.w * 0.4)}px ${css('--font-body')}`;
        ctx.textAlign = 'center';
        ctx.fillText(rot, p.x + p.w / 2, y + bh - 7);
      }
    }
  }
  function prepararCanvas(cv) {
    const r = cv.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w: r.width, h: r.height };
  }

  /* ------------------------------------------------------------ avaliação */
  function avaliar(aula, eventos, recs, pedais = []) {
    const n = eventos.length;
    const certos = eventos.filter(e => e.erros === 0).length;
    const erros = eventos.reduce((s, e) => s + e.erros, 0);
    const out = { acertos: Math.round(100 * certos / Math.max(1, n)), erros, eventos: n };
    // tempo
    const r = [];
    for (let i = 1; i < n; i++) {
      const db = eventos[i].t - eventos[i - 1].t;
      if (db <= 0 || db > 2.01 || eventos[i].erros > 0) continue;
      const dt = (eventos[i].onset - eventos[i - 1].onset) / 1000;
      if (dt > 0) r.push(dt / db);
    }
    if (r.length >= 3) {
      const med = r.reduce((a, b) => a + b, 0) / r.length;
      const dp = Math.sqrt(r.reduce((a, b) => a + (b - med) ** 2, 0) / r.length);
      out.regularidade = clamp(Math.round(100 - (dp / med) * 200), 0, 100);
      out.variacao = Math.round((dp / med) * 100);
      out.bpm = Math.round(60 / med);
      // linha do tempo: desvio de cada nota em relação ao andamento médio (1 = no tempo)
      out.linha = eventos.map((e, i) => {
        const nome = e.notas.map(n => rotuloNota(n)).join('+');
        if (i === 0 || e.onset == null || eventos[i - 1].onset == null) return { i, nome, dev: null, erros: e.erros };
        const db = e.t - eventos[i - 1].t;
        if (db <= 0 || db > 2.01) return { i, nome, dev: null, erros: e.erros, pausa: db > 2.01 };
        return { i, nome, dev: ((e.onset - eventos[i - 1].onset) / 1000 / db) / med, erros: e.erros };
      });
      const tarde = out.linha.filter(x => x.dev != null && x.dev > 1.35), cedo = out.linha.filter(x => x.dev != null && x.dev < 0.72);
      out.ondeTempo = { tarde: tarde.map(x => `${x.i + 1} (${x.nome})`), cedo: cedo.map(x => `${x.i + 1} (${x.nome})`) };
    }
    const porMao = { D: [], E: [] };
    recs.forEach(x => porMao[x.h].push(x));
    // legato
    if (aula.metricas.includes('legato')) {
      out.buracos = 0; out.embolou = 0; out.ondeBuracos = {};
      for (const h of ['D', 'E']) {
        const lista = porMao[h].sort((a, b) => a.t - b.t || a.m - b.m);
        for (let i = 0; i < lista.length - 1; i++) {
          const a = lista[i], b = lista[i + 1];
          if (a.a !== 'leg' || b.a !== 'leg' || Math.abs(a.t + a.d - b.t) > 0.05) continue;
          if (lista.filter(x => x.t === a.t).length > 1 || lista.filter(x => x.t === b.t).length > 1) continue;
          if (a.on == null || b.on == null) continue;
          const gap = a.off == null ? -Infinity : b.on - a.off;
          if (gap > 35) {
            out.buracos++;
            const k = `${h === 'D' ? 'MD' : 'ME'} ${a.f}→${b.f} (${a.n}→${b.n})`;
            out.ondeBuracos[k] = (out.ondeBuracos[k] || 0) + 1;
          } else if (gap < -160) out.embolou++;
        }
      }
    }
    // staccato
    if (aula.metricas.includes('staccato')) {
      let tot = 0, curtas = 0;
      for (const h of ['D', 'E']) {
        const lista = porMao[h].sort((a, b) => a.t - b.t);
        for (let i = 0; i < lista.length - 1; i++) {
          const a = lista[i], b = lista[i + 1];
          if (a.a !== 'stac' || a.on == null || a.off == null || b.on == null) continue;
          tot++;
          if ((a.off - a.on) / Math.max(1, b.on - a.on) <= 0.6) curtas++;
        }
      }
      if (tot) out.staccato = Math.round(100 * curtas / tot);
    }
    // força por dedo
    const forca = {};
    recs.forEach(x => { if (x.vel == null) return; const k = x.h + x.f; (forca[k] = forca[k] || []).push(x.vel); });
    out.forca = {};
    Object.entries(forca).forEach(([k, vs]) => { out.forca[k] = Math.round(vs.reduce((a, b) => a + b, 0) / vs.length); });
    // dinâmica: correlação entre o desenho pedido e a força tocada
    if (aula.metricas.includes('dinamica')) {
      const pares = recs.filter(x => x.vel != null);
      if (pares.length > 4) {
        const ex = pares.map(x => x.v), ac = pares.map(x => x.vel);
        const mx = ex.reduce((a, b) => a + b, 0) / ex.length, ma = ac.reduce((a, b) => a + b, 0) / ac.length;
        let num = 0, dx = 0, da = 0;
        for (let i = 0; i < ex.length; i++) { num += (ex[i] - mx) * (ac[i] - ma); dx += (ex[i] - mx) ** 2; da += (ac[i] - ma) ** 2; }
        out.dinamica = dx && da ? Math.max(0, Math.round(100 * num / Math.sqrt(dx * da))) : 0;
      }
    }
    // equilíbrio: a mão direita (melodia) mais forte que a esquerda, em %
    if (aula.metricas.includes('equilibrio')) {
      const med = h => { const vs = recs.filter(x => x.h === h && x.vel != null).map(x => x.vel); return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null; };
      const d = med('D'), e = med('E');
      if (d != null && e != null && e > 0) out.equilibrio = Math.round(100 * (d - e) / e);
    }
    // pedal sincopado: depois de cada ataque novo (exceto o primeiro), o pedal sobe e desce dentro de 600 ms
    if (aula.metricas.includes('pedal') && pedais.length) {
      const ataques = eventos.filter(ev => ev.onset != null).map(ev => ev.onset).sort((a, b) => a - b).slice(1);
      let certas = 0;
      for (const t of ataques) {
        const sobe = pedais.find(pd => !pd.baixo && pd.ts >= t - 80 && pd.ts <= t + 600);
        const desce = sobe && pedais.find(pd => pd.baixo && pd.ts > sobe.ts && pd.ts <= t + 900);
        if (sobe && desce) certas++;
      }
      out.pedal = ataques.length ? Math.round(100 * certas / ataques.length) : null;
      out.pedalTrocas = pedais.filter(pd => !pd.baixo).length;
    } else if (aula.metricas.includes('pedal')) out.pedal = null;
    // veredito
    const p = aula.passa || {};
    const faltas = [];
    if (p.acertos != null && out.acertos < p.acertos) faltas.push(`notas certas ${out.acertos}% (meta ${p.acertos}%)`);
    // trecho curto demais para medir o tempo (menos de 3 intervalos): não conta contra o aluno
    out.tempoMedido = out.regularidade != null;
    if (p.regularidade != null && out.tempoMedido && out.regularidade < p.regularidade) faltas.push(`regularidade ${out.regularidade}% (meta ${p.regularidade}%)`);
    if (p.bpm != null && out.tempoMedido && out.bpm < p.bpm) faltas.push(`tempo ♩ = ${out.bpm} (meta ♩ = ${p.bpm})`);
    if (p.buracosMax != null && (out.buracos ?? 0) > p.buracosMax) faltas.push(`${out.buracos} buracos no legato (máximo ${p.buracosMax})`);
    if (p.dinamica != null && (out.dinamica ?? 0) < p.dinamica) faltas.push(`dinâmica ${out.dinamica ?? 0}% (meta ${p.dinamica}%)`);
    if (p.equilibrio != null && (out.equilibrio ?? -100) < p.equilibrio) faltas.push(`melodia ${out.equilibrio == null ? '—' : out.equilibrio + '%'} mais forte que o acompanhamento (meta ${p.equilibrio}%)`);
    if (p.pedal != null && out.pedal != null && out.pedal < p.pedal) faltas.push(`trocas de pedal certas ${out.pedal}% (meta ${p.pedal}%)`);
    out.faltas = faltas;
    out.passou = faltas.length === 0;
    return out;
  }

  function dicas(aula, r, errosLista) {
    const d = [];
    if (r.acertos < 95 && errosLista.length) {
      const cont = {};
      errosLista.forEach(e => { const k = `esperava ${e.esperado}, tocou ${e.tocou}`; cont[k] = (cont[k] || 0) + 1; });
      const top = Object.entries(cont).sort((a, b) => b[1] - a[1])[0];
      d.push(`O erro mais comum: ${top[0]}${top[1] > 1 ? ` (${top[1]} vezes)` : ''}. Toque só esse trecho bem devagar, olhando o dedo antes de tocar.`);
    }
    if (r.regularidade != null && aula.passa && aula.passa.regularidade && r.regularidade < aula.passa.regularidade) {
      const o = r.ondeTempo || { tarde: [], cedo: [] };
      const onde = [o.tarde.length ? `vieram atrasadas as notas ${o.tarde.slice(0, 4).join(', ')}${o.tarde.length > 4 ? '…' : ''}` : '', o.cedo.length ? `vieram cedo demais as notas ${o.cedo.slice(0, 4).join(', ')}${o.cedo.length > 4 ? '…' : ''}` : ''].filter(Boolean).join('; ');
      d.push(`O tempo variou em média ${r.variacao}% de uma nota para outra${onde ? ': ' + onde : ''}. Veja a linha do tempo abaixo. Ligue o metrônomo, toque mais devagar e, onde atrasou, é quase sempre a mão procurando a tecla: olhe a próxima tecla antes de soltar a anterior.`);
    }
    if (r.bpm != null && aula.passa && aula.passa.bpm && r.bpm < aula.passa.bpm) {
      d.push(`Você tocou a ♩ = ${r.bpm}. Mantenha a regularidade e suba aos poucos até ♩ = ${aula.passa.bpm}; velocidade sem regularidade não conta.`);
    }
    if (r.buracos) {
      const top = Object.entries(r.ondeBuracos).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => `${k}${v > 1 ? ` ×${v}` : ''}`).join('; ');
      d.push(`O legato quebrou em: ${top}. Toque só esse par de notas, segurando a primeira até a segunda afundar.`);
    }
    if (r.embolou) d.push(`Em ${r.embolou} passagens as duas notas ficaram soando juntas demais. Solte a anterior assim que a próxima soar.`);
    if (r.staccato != null && r.staccato < 70) d.push(`Só ${r.staccato}% das notas em staccato ficaram curtas. Deixe o pulso subir logo depois de cada nota.`);
    const f = r.forca || {};
    for (const h of ['D', 'E']) {
      const vs = [1, 2, 3, 4, 5].map(k => f[h + k]).filter(v => v != null);
      if (vs.length >= 4) {
        const med = vs.reduce((a, b) => a + b, 0) / vs.length;
        const fraco = [1, 2, 3, 4, 5].filter(k => f[h + k] != null).sort((a, b) => f[h + a] - f[h + b])[0];
        if (f[h + fraco] < med * 0.8) d.push(`Na ${h === 'D' ? 'mão direita' : 'mão esquerda'}, o dedo ${fraco} saiu ${Math.round(100 - 100 * f[h + fraco] / med)}% mais fraco que a média. Use mais peso do braço nele, sem apertar.`);
      }
    }
    if (r.dinamica != null && aula.passa && aula.passa.dinamica && r.dinamica < aula.passa.dinamica) {
      d.push(`A força das notas acompanhou pouco o desenho pedido (${r.dinamica}%). Exagere: o fraco bem fraco, o forte com o peso do braço.`);
    }
    if (r.equilibrio != null && aula.passa && aula.passa.equilibrio != null && r.equilibrio < aula.passa.equilibrio) {
      d.push(r.equilibrio < 0 ? 'A esquerda ficou mais forte que a direita. Toque a esquerda com o braço pousado, quase sem cair, e a melodia com peso.' : `A melodia ficou só ${r.equilibrio}% mais forte que o acompanhamento. Exagere a diferença: a esquerda sussurra, a direita canta.`);
    }
    if (r.pedal != null && aula.passa && aula.passa.pedal != null && r.pedal < aula.passa.pedal) {
      d.push(`Só ${r.pedal}% das trocas de pedal vieram logo depois do acorde novo. Mãos descem, pé sobe, pé desce: conte “um, e” em cada acorde.`);
    }
    if (aula.metricas.includes('pedal') && r.pedal == null) d.push('Não recebi o pedal pelo cabo: o site não conseguiu avaliar as trocas. Se o seu piano tem pedal, confira se ele envia MIDI (controle 64).');
    if (r.tempoMedido === false && r.eventos <= 3) d.push('Trecho curto demais para medir o tempo (menos de três notas seguidas): a regularidade não entrou no veredito.');
    if (!d.length) d.push(r.passou ? 'Tudo dentro da meta. Na próxima, tente o mesmo com os olhos fechados nas últimas repetições.' : 'Continue praticando: os números vão subir.');
    return d;
  }


  /* ------------------------------------------------------------ mãos desenhadas (dedos 1 a 5) */
  // Mão vista de cima, palma para baixo como no piano: na direita o polegar fica à esquerda, na esquerda, à direita.
  // [dedo, x da base, y da base, x da ponta, y da ponta, espessura]
  const DEDOS_GEO = [[1, 72, 152, 28, 116, 27], [2, 84, 124, 80, 54, 24], [3, 112, 122, 112, 40, 25], [4, 140, 124, 144, 50, 24], [5, 166, 132, 178, 76, 22]];
  function maoSVG(h) {
    const X = x => (h === 'D' ? x : 220 - x);
    const linha = (cls, d, extra = 0) => `<line class="${cls}" x1="${X(d[1])}" y1="${d[2]}" x2="${X(d[3])}" y2="${d[4]}" stroke-width="${d[5] + extra}"/>`;
    return `<svg viewBox="0 0 220 214" class="mao mao-${h}" role="img" aria-label="${h === 'D' ? 'Mão direita' : 'Mão esquerda'}: polegar é o dedo 1, mindinho é o dedo 5">
      ${DEDOS_GEO.map(d => linha('contorno', d, 3)).join('')}
      <rect class="palma" x="${h === 'D' ? 60 : 220 - 60 - 126}" y="112" width="126" height="84" rx="34"/>
      ${DEDOS_GEO.map(d => `<g class="dedo" data-dedo="${h}${d[0]}">${linha('forma', d)}
        <circle class="ponta" cx="${X(d[3])}" cy="${d[4]}" r="11.5"/>
        <text class="num" x="${X(d[3])}" y="${d[4] + 4.6}">${d[0]}</text>
        <text class="nota" x="${X(d[3])}" y="${d[4] - 19}"></text></g>`).join('')}
      <text class="nome-mao" x="${X(124)}" y="${160}">${h === 'D' ? 'direita' : 'esquerda'}</text>
    </svg>`;
  }

  /* ------------------------------------------------------------ player */
  class Player {
    constructor(raiz, aula) {
      this.raiz = raiz; this.aula = aula;
      this.bpm = aula.bpm; this.compasso = aula.compasso || 4;
      this.modo = 'ouvir'; this.maos = 'todas';
      this.tocando = false; this.batida = 0;
      this.secoes = aula.secoes || [];
      this.cv = $('canvas', raiz);
      this.flash = new Map();
      this.destaque = null; this.limite = null; this.semContagem = false; this.aoFimTrecho = null;
      this.nomePorTecla = new Map(aula.notas.map(n => [n.m, rotuloNota(n)]));
      this.assinaturaMaos = '';
      this.prepararNotas();
      this.batida = this.inicio - 0.4;
      this.ouvinte = (tipo, m, v, ts) => this.midi(tipo, m, v, ts);
      Midi.ouvintes.add(this.ouvinte);
      this.ro = new ResizeObserver(() => this.desenhar());
      this.ro.observe(this.cv);
      this.ligarToque();
      this.loop = this.loop.bind(this);
      this.atualizarStatus();
    }
    destruir() {
      this.parar(); document.body.classList.remove('foco'); Midi.ouvintes.delete(this.ouvinte); this.ro.disconnect();
      Player.metro && Player.metro.parar();
    }
    get ativas() { return this.aula.notas.filter(n => this.maos === 'todas' || n.h === this.maos); }
    prepararNotas() {
      const ativas = this.ativas.length ? this.ativas : this.aula.notas;
      this.inicio = Math.min(...ativas.map(n => n.t));
      this.fim = Math.max(...ativas.map(n => n.t + n.d));
      [this.lo, this.hi] = faixa(this.aula.notas);
      const grupos = new Map();
      for (const n of ativas) {
        const k = n.t.toFixed(3);
        if (!grupos.has(k)) grupos.set(k, { t: n.t, notas: [] });
        grupos.get(k).notas.push(n);
      }
      this.eventos = [...grupos.values()].sort((a, b) => a.t - b.t).map(g => ({
        t: g.t, notas: g.notas, pendentes: new Set(g.notas.map(n => n.m)), feitos: new Set(), onset: null, erros: 0, ok: false
      }));
      this.recs = [];
      this.pedais = [];
      this.tempos = [];
      this.bons = 0; this.ultimoAviso = 0;
      this.errosLista = [];
      this.idx = 0;
      this.abertos = new Map();
      this.terminou = false;
      this.parcial = false;
    }
    // ---- controle
    definirModo(m) { this.parar(); this.modo = m; this.reiniciar(); }
    definirMaos(h) { this.parar(); this.maos = h; this.prepararNotas(); this.batida = this.inicio - 0.4; this.desenhar(); this.atualizarStatus(); }
    get fator() { return estado.prefs[this.aula.chaveTempo || 'tempo'] ?? 1; }
    get bps() { return this.bpm * this.fator / 60; }
    reiniciar() { this.parar(); this.prepararNotas(); this.batida = this.inicio - 0.4; this.resultado = null; this.desenhar(); this.atualizarStatus(); this.atualizarTransporte(); const m = $('#tr-msg', this.raiz); if (m) { m.innerHTML = 'O treinador avisa na hora: tecla errada, nota atrasada ou apressada.'; m.dataset.tipo = ''; } const b = $('#tr-barras', this.raiz); if (b) b.innerHTML = ''; }
    irPara(t) {
      const tocava = this.tocando; this.parar(); this.prepararNotas();
      if (this.modo === 'praticar') {
        this.eventos = this.eventos.filter(e => e.t >= t - 0.001);
        this.inicio = t; this.parcial = t > Math.min(...this.ativas.map(n => n.t)) + 0.001;
      }
      this.batida = t - 0.4; this.resultado = null;
      this.desenhar(); this.atualizarStatus(); this.atualizarProgresso();
      if (tocava) this.tocar();
    }
    aplicarFoco() {
      const ligado = estado.prefs.foco !== false && this.tocando && this.modo === 'praticar' && !this.aoFimTrecho;
      const mudou = document.body.classList.contains('foco') !== ligado;
      document.body.classList.toggle('foco', ligado);
      if (ligado && mudou) setTimeout(() => rolar($('.palco', this.raiz) || this.raiz, 'start'), 60);
    }
    tocar() {
      const ctx = Som.iniciar(); if (!ctx) return;
      if (this.modo === 'praticar' && (this.terminou || this.idx >= this.eventos.length)) this.reiniciar();
      if (this.modo === 'ouvir' && this.batida >= this.fim - 0.01) this.reiniciar();
      this.terminou = false;
      this.tocando = true;
      if (!this.semContagem) this.destaque = null;
      if (!this.semContagem && this.batida <= this.inicio) this.batida = this.inicio - this.compasso; // um compasso de contagem
      this.ancora = { b: this.batida, t: agoraS() + 0.08 };
      this.agendadoAte = this.batida;
      this.ultimoQuadro = performance.now();
      if (this.modo === 'praticar') {
        if (!this.sessaoInicio) this.sessaoInicio = Date.now();
        if (estado.prefs.metronomo) Player.metronomoLivre(this.bpm * this.fator, this.compasso, ctx.currentTime + Math.max(0.05, this.batida < this.inicio ? this.tempoDe(this.inicio) - agoraS() : 0.05));
      }
      this.atualizarTransporte();
      this.aplicarFoco();
      requestAnimationFrame(this.loop);
    }
    atualizarMaos(dedos, proxima) {
      const ass = (proxima ? 'p' : '') + dedos.map(d => d.h + d.f + ':' + d.m).sort().join(',');
      if (ass === this.assinaturaMaos) return;
      this.assinaturaMaos = ass;
      const painel = $('.maos', this.raiz); if (!painel) return;
      const porDedo = new Map(dedos.map(d => [d.h + d.f, d]));
      $$('.dedo', painel).forEach(g => {
        const d = porDedo.get(g.dataset.dedo);
        g.classList.toggle('ativo', !!d);
        $('.nota', g).textContent = d ? (this.nomePorTecla.get(d.m) || NOMES[d.m % 12]) : '';
      });
      const ordenados = dedos.slice().sort((a, b) => (a.h === b.h ? a.f - b.f : a.h === 'E' ? -1 : 1));
      const txt = ordenados.length > 5 ? 'Posição: cada dedo com a sua tecla'
        : ordenados.map(d => `${d.h === 'D' ? 'Direita' : 'Esquerda'}, dedo ${d.f}: ${this.nomePorTecla.get(d.m) || NOMES[d.m % 12]}`).join(' · ');
      $('.legenda-mao', painel).textContent = ordenados.length ? (proxima ? 'Primeira nota — ' : '') + txt : '';
    }
    mostrarTeclas(lista) {
      this.destaque = lista && lista.length ? new Map(lista.map(([m, f, h]) => [m, { f, h }])) : null;
      if (!this.tocando) this.desenhar();
    }
    tocarTrecho(t0, t1) {
      return new Promise(res => {
        this.parar();
        if (this.modo !== 'ouvir') { this.modo = 'ouvir'; this.prepararNotas(); $$('[data-modo]', this.raiz).forEach(x => x.setAttribute('aria-pressed', String(x.dataset.modo === 'ouvir'))); }
        this.limite = t1; this.semContagem = true; this.aoFimTrecho = res;
        this.batida = t0 - 1; // um tempo de queda antes da primeira nota
        this.tocar(); this.atualizarStatus();
      });
    }
    interromperTrecho() { if (this.aoFimTrecho) this.parar(); }
    fimTrecho() {
      const r = this.aoFimTrecho; this.aoFimTrecho = null; this.limite = null; this.semContagem = false;
      if (r) r();
    }
    parar() {
      if (this.aoFimTrecho) { this.tocando = false; this.atualizarTransporte(); this.fimTrecho(); return; }
      if (!this.tocando) return;
      this.tocando = false;
      Player.metro && Player.metro.parar();
      if (this.modo === 'praticar' && this.sessaoInicio && !this.terminou) this.registrarParcial();
      this.atualizarTransporte();
      this.aplicarFoco();
    }
    batidaEm(t) { return this.ancora.b + (t - this.ancora.t) * this.bps; }
    tempoDe(b) { return this.ancora.t + (b - this.ancora.b) / this.bps; }
    reancorar() { if (this.tocando) { this.ancora = { b: this.batida, t: agoraS() }; this.agendadoAte = this.batida; } }
    paraAudio(t) { return Som.ctx.currentTime + Math.max(0, t - agoraS()); }
    loop(agora) {
      if (!this.tocando) return;
      const ctx = Som.ctx;
      if (this.modo === 'ouvir') {
        const t0 = agoraS();
        this.batida = this.batidaEm(t0);
        const horizonte = this.batidaEm(t0 + 0.15);
        for (const n of this.aula.notas) {
          if (n.t >= this.agendadoAte && n.t < horizonte) {
            if (this.maos !== 'todas' && n.h !== this.maos) continue;
            if (this.limite != null && n.t >= this.limite - 1e-6) continue;
            Som.nota(n.m, this.paraAudio(this.tempoDe(n.t)), n.d / this.bps * (n.a === 'stac' ? 0.9 : 0.98), n.v);
          }
        }
        this.cliques(horizonte, estado.prefs.metronomo);
        this.agendadoAte = horizonte;
        if (this.limite != null && this.batida > this.limite + 0.4) {
          this.tocando = false; this.atualizarTransporte(); this.desenhar(); this.fimTrecho(); return;
        }
        if (this.batida > this.fim + 0.6) {
          if (estado.prefs.repetir) { this.tocando = false; this.batida = this.inicio; this.tocar(); return; }
          this.tocando = false; this.batida = this.fim; this.atualizarTransporte();
        }
      } else {
        const dt = Math.min(0.1, (agora - this.ultimoQuadro) / 1000);
        this.ultimoQuadro = agora;
        if (this.batida < this.inicio) {
          const t0 = agoraS();
          this.batida = this.batidaEm(t0);
          const horizonte = this.batidaEm(t0 + 0.15);
          this.cliques(Math.min(horizonte, this.inicio - 0.001), false);
          this.agendadoAte = horizonte;
        } else {
          const ev = this.eventos[this.idx];
          let nova = this.batida + dt * this.bps;
          if (ev && nova >= ev.t) nova = ev.t;
          this.batida = nova;
        }
        if (this.idx >= this.eventos.length && !this.terminou) {
          this.terminou = true;
          setTimeout(() => this.finalizar(), 700);
        }
      }
      this.desenhar();
      this.atualizarProgresso();
      if (this.tocando) requestAnimationFrame(this.loop);
    }
    cliques(horizonte, sempre) {
      if (this.semContagem) return;
      const ini = Math.ceil(this.agendadoAte - 1e-6);
      for (let k = ini; k < horizonte; k++) {
        const contagem = k < this.inicio;
        if (!sempre && !contagem) continue;
        if (k < this.inicio - this.compasso - 0.01) continue;
        const forte = (((k - this.inicio) % this.compasso) + this.compasso) % this.compasso === 0;
        Som.clique(this.paraAudio(this.tempoDe(k)), forte);
      }
    }
    static metronomoLivre(bpm, compasso, inicioCtx) {
      Player.metro && Player.metro.parar();
      const ctx = Som.ctx; let prox = inicioCtx ?? ctx.currentTime + 0.1, k = 0, vivo = true;
      const timer = setInterval(() => {
        if (!vivo) return;
        while (prox < ctx.currentTime + 0.2) { Som.clique(prox, k % compasso === 0); prox += 60 / bpm; k++; }
      }, 50);
      Player.metro = { parar() { vivo = false; clearInterval(timer); Player.metro = null; } };
    }
    // ---- entrada
    midi(tipo, m, v, ts) {
      if (tipo === 'pedal') { if (this.modo === 'praticar' && this.tocando && !this.terminou) this.pedais.push({ ts, baixo: v >= 64 }); return; }
      if (tipo === 'on') this.flash.set(m, { ate: performance.now() + 350, cor: null });
      if (this.modo !== 'praticar' || !this.tocando || this.terminou) { if (!this.tocando) this.desenhar(); return; }
      if (tipo === 'on') {
        const ev = this.eventos[this.idx];
        if (!ev) return;
        if (ev.pendentes.has(m)) {
          ev.pendentes.delete(m); ev.feitos.add(m);
          if (ev.onset == null) ev.onset = ts;
          const n = ev.notas.find(x => x.m === m);
          const rec = { ...n, on: ts, off: null, vel: v };
          this.recs.push(rec); this.abertos.set(m, rec);
          this.flash.set(m, { ate: performance.now() + 350, cor: css('--ok') });
          if (!ev.pendentes.size) { ev.ok = true; this.avaliarTempo(ev, this.eventos[this.idx - 1]); this.idx++; this.atualizarStatus(); }
        } else if (ev.feitos.has(m)) {
          /* repetiu nota do mesmo acorde: ignora */
        } else {
          ev.erros++;
          const esperadas = ev.notas.filter(x => ev.pendentes.has(x.m));
          this.errosLista.push({ esperado: esperadas.map(x => x.n).join(' + '), tocou: NOMES[m % 12] });
          this.flash.set(m, { ate: performance.now() + 450, cor: css('--bad') });
          this.avisar('errada', { esperadas, tocou: m });
        }
      } else if (tipo === 'off') {
        const rec = this.abertos.get(m);
        if (rec) { rec.off = ts; this.abertos.delete(m); }
      }
    }
    // ---- treinador em tempo real
    avaliarTempo(ev, prev) {
      if (!prev || prev.onset == null || ev.onset == null) return;
      const db = ev.t - prev.t;
      if (db <= 0 || db > 2.01 || ev.erros > 0) { this.desenharTreinador(); return; }
      const ratio = ((ev.onset - prev.onset) / 1000) / db; // segundos por tempo
      const ant = this.tempos.slice(-6);
      const ref = ant.length >= 2 ? ant.slice().sort((a, b) => a - b)[Math.floor(ant.length / 2)] : 60 / (this.bpm * this.fator);
      const dev = ratio / ref;
      ev.dev = dev;
      this.tempos.push(ratio);
      if (dev > 1.35) { this.bons = 0; this.avisar('atrasou', { ev }); }
      else if (dev < 0.72) { this.bons = 0; this.avisar('apressou', { ev }); }
      else { this.bons++; if (this.bons === 8) this.avisar('bem', {}); }
      this.desenharTreinador(dev);
    }
    avisar(tipo, info) {
      const el = $('#tr-msg', this.raiz); if (!el) return;
      let txt = '', ids = [];
      if (tipo === 'errada') {
        const alvo = info.esperadas[0];
        const dist = alvo ? info.tocou - alvo.m : 0;
        const dica = !alvo ? '' : dist === 0 ? '' : Math.abs(dist) === 1 ? (dist > 0 ? ' Era a tecla logo à esquerda.' : ' Era a tecla logo à direita.') : Math.abs(dist) === 12 ? ' Era a mesma nota, na outra oitava.' : dist > 0 ? ' Era mais para a esquerda.' : ' Era mais para a direita.';
        txt = `<b>Tecla errada.</b> Era <b>${esc(info.esperadas.map(x => rotuloNota(x)).join(' + '))}</b>${alvo && alvo.f ? ` com o dedo ${alvo.f}` : ''}; você tocou ${esc(NOMES[info.tocou % 12])}.${dica}`;
        ids = ['coach-errada'];
        const slug = alvo && C.notasSlug ? C.notasSlug[alvo.n] : null;
        if (slug) ids.push('coach-era-' + slug);
        if (alvo && Math.abs(dist) === 1) ids.push(dist > 0 ? 'coach-abaixo' : 'coach-acima');
        if (alvo && alvo.f) this.mostrarDedo = alvo;
      } else if (tipo === 'atrasou') { txt = '<b>Atrasou.</b> Essa nota veio tarde: mantenha o pulso, sem parar para procurar a tecla.'; ids = ['coach-atrasou']; }
      else if (tipo === 'apressou') { txt = '<b>Apressou.</b> Essa nota veio cedo: espere o tempo inteiro da anterior.'; ids = ['coach-apressou']; }
      else if (tipo === 'bem') { txt = '<b>Muito bem.</b> Oito notas seguidas no tempo.'; ids = ['coach-bem']; }
      el.innerHTML = txt; el.dataset.tipo = tipo;
      el.classList.remove('pisca'); void el.offsetWidth; el.classList.add('pisca');
      // voz: no máximo um aviso a cada 2,5 s
      const agora = performance.now();
      const outraVoz = Guia.ativo || !!Guia.atual || (Narr.audio && !Narr.audio.paused);
      if (estado.prefs.treinadorVoz !== false && !outraVoz && agora - this.ultimoAviso > 2500 && ids.length) {
        this.ultimoAviso = agora;
        (async () => { for (const id of ids) { Guia.cancelado = false; Guia.pularPasso = false; await Guia.falar(id, (C.coach || {})[id.replace('coach-', '')] || ''); } })();
      }
    }
    desenharTreinador(dev) {
      const el = $('#tr-barras', this.raiz); if (!el) return;
      const devs = this.eventos.slice(0, this.idx + 1).filter(e => e.dev != null).slice(-14).map(e => e.dev);
      el.innerHTML = devs.map(d => { const h = Math.max(6, Math.min(40, 20 + 20 * Math.log2(d))); const cls = d > 1.35 ? 'tarde' : d < 0.72 ? 'cedo' : 'ok'; return `<i class="${cls}" style="height:${h}px" title="${d > 1 ? '+' : ''}${Math.round((d - 1) * 100)}%"></i>`; }).join('');
    }
    ligarToque() {
      const notaEm = ev => {
        const r = this.cv.getBoundingClientRect();
        const x = ev.clientX - r.left, y = ev.clientY - r.top;
        const kh = Math.min(120, r.height * 0.24), ky = r.height - kh;
        if (y < ky) return null;
        const geo = geometria(this.lo, this.hi, r.width);
        let achou = null;
        for (const [m, p] of geo.pos) if (p.preta && x >= p.x && x <= p.x + p.w && y <= ky + kh * 0.62) achou = m;
        if (achou == null) for (const [m, p] of geo.pos) if (!p.preta && x >= p.x && x < p.x + p.w) achou = m;
        return achou;
      };
      const ativos = new Map();
      this.cv.addEventListener('pointerdown', ev => {
        const m = notaEm(ev); if (m == null) return;
        ev.preventDefault();
        Som.iniciar(); this.toqueTela = true;
        Som.nota(m, Som.ctx.currentTime, 0.5, 0.65);
        ativos.set(ev.pointerId, m);
        this.midi('on', m, 80, performance.now());
      });
      const soltar = ev => { const m = ativos.get(ev.pointerId); if (m == null) return; ativos.delete(ev.pointerId); this.midi('off', m, 0, performance.now()); };
      this.cv.addEventListener('pointerup', soltar);
      this.cv.addEventListener('pointercancel', soltar);
      this.cv.addEventListener('pointerleave', soltar);
    }
    // ---- resultado
    finalizar() {
      this.tocando = false;
      this.aplicarFoco();
      Player.metro && Player.metro.parar();
      const fimTs = performance.now();
      this.recs.forEach(r => { if (r.off == null) r.off = fimTs; });
      const r = avaliar(this.aula, this.eventos, this.recs, this.pedais);
      const minutos = Math.max(0.2, (Date.now() - this.sessaoInicio) / 60000);
      this.sessaoInicio = null;
      const sessao = { quando: new Date().toISOString(), dia: hojeStr(), aula: this.aula.id, minutos: +minutos.toFixed(1), maos: this.maos, tempo: Math.round(this.bpm * this.fator), completa: true, r };
      registrarSessao(sessao);
      r.parcial = this.parcial;
      if (r.passou && this.maos === 'todas' && !this.parcial) {
        estado.status[this.aula.id] = { concluida: hojeStr() }; salvar();
      }
      this.resultado = { r, dicas: dicas(this.aula, r, this.errosLista) };
      this.atualizarTransporte(); this.atualizarStatus();
      this.raiz.dispatchEvent(new CustomEvent('resultado', { detail: this.resultado }));
    }
    registrarParcial() {
      const minutos = (Date.now() - this.sessaoInicio) / 60000;
      this.sessaoInicio = null;
      if (minutos < 0.3) return;
      registrarSessao({ quando: new Date().toISOString(), dia: hojeStr(), aula: this.aula.id, minutos: +minutos.toFixed(1), maos: this.maos, tempo: Math.round(this.bpm * this.fator), completa: false });
    }
    // ---- interface
    atualizarStatus(msg) {
      const st = $('.status', this.raiz); if (!st) return;
      if (msg) { st.textContent = msg; return; }
      if (this.aoFimTrecho) { st.innerHTML = 'Demonstração: observe as teclas e os dedos.'; return; }
      if (this.modo === 'ouvir') { st.innerHTML = this.aula.notas.some(n => n.f) ? 'Modo <b>Ouvir</b>: o site toca o exercício. Observe os dedos e cante junto.' : 'Modo <b>Ouvir</b>: o site toca o trecho. Observe as teclas e cante a melodia junto.'; return; }
      if (this.terminou && this.resultado) { st.innerHTML = this.resultado.r.passou ? '<b>Passou.</b> Veja o relatório abaixo.' : 'Exercício terminado. Veja o relatório abaixo.'; return; }
      const ev = this.eventos[this.idx];
      if (!ev) { st.textContent = ''; return; }
      const alvo = this.aula.leitura ? '<b>a nota marcada na partitura</b>' : ev.notas.map(n => `<b>${esc(rotuloNota(n))}</b> (${n.h === 'D' ? 'MD' : 'ME'}${n.f ? ' ' + n.f : ''})`).join(' + ');
      const conectado = Midi.estado === 'conectado';
      st.innerHTML = (this.tocando ? 'Esperando: ' : 'Primeira nota: ') + alvo + (conectado ? '' : ' · <span class="suave">sem piano conectado: toque nas teclas da tela</span>')
        + '<br><span class="suave">No modo Praticar o site não toca as notas: o som vem do seu piano. Para ouvir a música, use Ouvir.</span>';
    }
    atualizarTransporte() {
      const b = $('[data-acao="tocar"]', this.raiz); if (!b) return;
      b.innerHTML = this.tocando ? `${ICONE_PAUSA.replace('aria-hidden', 'class="ico" aria-hidden')} Pausar` : `${ICONE_PLAY.replace('aria-hidden', 'class="ico" aria-hidden')} ${this.modo === 'praticar' ? 'Começar' : 'Tocar'}`;
      this.atualizarProgresso();
    }
    atualizarProgresso() {
      const p = $('.barra-prog div', this.raiz); if (!p) return;
      const frac = this.modo === 'praticar' && this.eventos.length ? this.idx / this.eventos.length : (this.batida - this.inicio) / Math.max(0.01, this.fim - this.inicio);
      p.style.width = (clamp(frac, 0, 1) * 100).toFixed(1) + '%';
    }
    desenhar() {
      const { ctx, w, h } = prepararCanvas(this.cv);
      const kh = Math.min(120, h * 0.24), ky = h - kh;
      const janela = 5, ppb = (ky - 8) / janela;
      const geo = geometria(this.lo, this.hi, w);
      const corD = css('--rh'), corE = css('--lh'), linha = css('--stage-line'), textoPalco = css('--stage-text');
      ctx.fillStyle = css('--stage'); ctx.fillRect(0, 0, w, h);
      // colunas das teclas pretas, bem discretas
      ctx.fillStyle = 'rgba(255,255,255,0.025)';
      for (const [, p] of geo.pos) if (p.preta) ctx.fillRect(p.x, 0, p.w, ky);
      // linhas de tempo
      const b0 = this.batida;
      for (let k = Math.ceil(b0 - 1); k < b0 + janela + 1; k++) {
        const y = ky - (k - b0) * ppb;
        if (y < 0 || y > ky) continue;
        const rel = k - this.inicio;
        const forte = ((rel % this.compasso) + this.compasso) % this.compasso === 0;
        ctx.strokeStyle = linha; ctx.lineWidth = forte ? 1.5 : 0.75; ctx.globalAlpha = forte ? 1 : 0.6;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      // notas caindo
      const marcas = new Map();
      const evAtual = this.modo === 'praticar' ? this.eventos[this.idx] : null;
      const feitas = new Set();
      if (this.modo === 'praticar') this.eventos.slice(0, this.idx).forEach(e => e.notas.forEach(n => feitas.add(n)));
      for (const n of this.aula.notas) {
        const yb = ky - (n.t - b0) * ppb, yt = yb - n.d * ppb;
        if (yb < 0 || yt > ky) continue;
        const p = geo.pos.get(n.m); if (!p) continue;
        const fora = this.maos !== 'todas' && n.h !== this.maos;
        const cor = n.h === 'D' ? corD : corE;
        const pad = p.preta ? 1 : p.w * 0.1;
        const x = p.x + pad, ww = p.w - pad * 2;
        const topo = Math.max(yt, -4), base = Math.min(yb, ky) - 1;
        if (base - topo < 1) continue;
        ctx.globalAlpha = fora ? 0.18 : feitas.has(n) ? 0.35 : 0.5 + 0.5 * n.v;
        ctx.fillStyle = cor;
        ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, topo, ww, base - topo, 5) : ctx.rect(x, topo, ww, base - topo); ctx.fill();
        if (evAtual && evAtual.notas.includes(n) && evAtual.pendentes.has(n.m)) {
          ctx.globalAlpha = 1; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, topo, ww, base - topo, 5) : ctx.rect(x, topo, ww, base - topo); ctx.stroke();
        }
        ctx.globalAlpha = fora ? 0.3 : 1;
        if (base - topo > 18 && ww > 12) {
          ctx.fillStyle = '#10121a';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          if (n.f) { ctx.font = `700 ${clamp(ww * 0.55, 10, 16)}px ${css('--font-mono')}`; ctx.fillText(String(n.f), x + ww / 2, base - 10); }
          else { ctx.font = `700 ${clamp(ww * 0.34, 8, 12)}px ${css('--font-body')}`; ctx.fillText(rotuloNota(n), x + ww / 2, base - 10); }
          if (n.f && estado.prefs.nomes && base - topo > 40) {
            ctx.font = `600 ${clamp(ww * 0.3, 9, 12)}px ${css('--font-body')}`;
            ctx.fillText(rotuloNota(n), x + ww / 2, base - 28);
          }
        }
        ctx.globalAlpha = 1;
        // tecla acesa enquanto a nota soa (modo ouvir) ou nota esperada (praticar)
        if (!fora && this.modo === 'ouvir' && this.batida >= n.t && this.batida < n.t + n.d) marcas.set(n.m, { cor, rotulo: n.f ? String(n.f) : rotuloNota(n), textoCor: '#10121a' });
      }
      if (evAtual) for (const n of evAtual.notas) if (evAtual.pendentes.has(n.m)) marcas.set(n.m, { cor: (n.h === 'D' ? corD : corE), contorno: '#ffffff', rotulo: n.f ? String(n.f) : rotuloNota(n), textoCor: '#10121a' });
      if (this.destaque && !this.tocando) for (const [m, d] of this.destaque) marcas.set(m, { cor: d.h === 'D' ? corD : corE, contorno: '#ffffff', rotulo: String(d.f), textoCor: '#10121a' });
      // mãos: quais dedos mostrar agora
      const dedos = [];
      if (this.destaque && !this.tocando) for (const [m, d] of this.destaque) dedos.push({ h: d.h, f: d.f, m });
      else if (this.modo === 'praticar' && evAtual) evAtual.notas.forEach(n => { if (evAtual.pendentes.has(n.m) && n.f) dedos.push({ h: n.h, f: n.f, m: n.m }); });
      else if (this.tocando) this.aula.notas.forEach(n => { if (n.f && (this.maos === 'todas' || n.h === this.maos) && this.batida >= n.t && this.batida < n.t + n.d) dedos.push({ h: n.h, f: n.f, m: n.m }); });
      else { const prox = this.ativas.filter(n => n.f && n.t >= this.batida - 1e-6).sort((a, b) => a.t - b.t); const t0 = prox.length ? prox[0].t : null; prox.forEach(n => { if (n.t === t0) dedos.push({ h: n.h, f: n.f, m: n.m }); }); }
      this.atualizarMaos(dedos, !this.tocando && !this.destaque && this.modo !== 'praticar');
      if (this.partitura) { const tAtual = this.modo === 'praticar' ? (evAtual ? evAtual.t : (this.terminou ? -1 : this.batida)) : this.batida; if (this.tocando || this.modo === 'praticar') this.partitura.marcar(tAtual); else this.partitura.limpar(); }
      const agora = performance.now();
      for (const [m, v] of Midi.teclas) if (!marcas.has(m) || this.modo === 'ouvir') marcas.set(m, { cor: css('--press'), rotulo: estado.prefs.nomes ? NOMES[m % 12] : '', textoCor: '#10121a' });
      for (const [m, f] of this.flash) { if (f.ate < agora) { this.flash.delete(m); continue; } if (f.cor) marcas.set(m, { cor: f.cor, rotulo: NOMES[m % 12], textoCor: '#ffffff' }); }
      // legenda das mãos (canto superior direito)
      const temD = this.aula.notas.some(n => n.h === 'D'), temE = this.aula.notas.some(n => n.h === 'E');
      if (temD || temE) {
        ctx.font = `600 11px ${css('--font-mono')}`; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        let lx = w - 10;
        const item = (cor, txt) => { ctx.fillStyle = textoPalco; ctx.fillText(txt, lx, 14); lx -= ctx.measureText(txt).width + 8; ctx.fillStyle = cor; ctx.beginPath(); ctx.arc(lx - 4, 14, 5, 0, Math.PI * 2); ctx.fill(); lx -= 22; };
        if (temE) item(corE, 'ESQUERDA');
        if (temD) item(corD, 'DIREITA');
      }
      // seções
      ctx.font = `600 12px ${css('--font-mono')}`; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      for (const s of this.secoes) {
        const y = ky - (s.t - b0) * ppb;
        if (y < 14 || y > ky) continue;
        const rot = s.rotulo.toUpperCase(), lw = ctx.measureText(rot).width;
        ctx.fillStyle = css('--stage'); ctx.globalAlpha = 0.85; ctx.fillRect(4, y - 20, lw + 12, 18);
        ctx.globalAlpha = 1; ctx.fillStyle = textoPalco;
        ctx.fillText(rot, 10, y - 5);
      }
      // linha de toque
      ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(0, ky - 3, w, 3);
      desenharTeclado(ctx, geo, this.lo, this.hi, ky, kh, marcas, { nomes: estado.prefs.nomes });
      // contagem
      if (this.tocando && this.batida < this.inicio) {
        const falta = Math.ceil(this.inicio - this.batida - 1e-6);
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.font = `500 ${Math.min(96, ky * 0.4)}px ${css('--font-display')}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(this.compasso - falta + 1), w / 2, ky / 2);
      }
      if (this.flash.size && !this.tocando && !this._rf) { this._rf = true; requestAnimationFrame(() => { this._rf = false; this.desenhar(); }); }
    }
  }

  Player.metro = null;

  /* ------------------------------------------------------------ vistas */
  let playerAtual = null;
  function rota() {
    const h = (location.hash || '#hoje').slice(1);
    let vista = 'curso', aulaId = null;
    if (h === 'hoje' || h === '') vista = 'hoje';
    else if (h.startsWith('aula-')) { aulaId = h.slice(5); vista = AULAS.has(aulaId) ? 'aula' : 'curso'; }
    else if (h === 'progresso') vista = 'progresso';
    else if (h === 'musicas' || h.startsWith('musica-')) vista = 'musicas';
    Narr.parar(); Guia.parar(); Fluxo.parar();
    Jornada.ativa = vista === 'hoje';
    if (vista === 'aula' && Jornada.bloqueado()) { vista = 'hoje'; }
    if (playerAtual) { playerAtual.destruir(); playerAtual = null; }
    // limpa as vistas escondidas: assim nunca existem dois teclados (ou dois #player) na página
    $$('.vista').forEach(v => { v.hidden = v.id !== 'vista-' + vista; if (v.hidden) v.innerHTML = ''; });
    $$('.nav a').forEach(a => { if (a.dataset.nav === vista) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    $('#nav-aula').href = '#aula-' + (aulaId || proximaAula());
    if (vista === 'hoje') renderHoje();
    if (vista === 'curso') renderCurso();
    if (vista === 'aula') renderAula(aulaId);
    if (vista === 'progresso') renderProgresso();
    if (vista === 'musicas') { if (h.startsWith('musica-')) renderMusica(h.slice(7)); else renderMusicas(); }
    window.scrollTo(0, 0);
    if (vista !== 'curso') AtivarSom.conferir();
  }
  window.addEventListener('hashchange', rota);
  document.addEventListener('midi-estado', () => { if (playerAtual) playerAtual.atualizarStatus(); });

  function chipStatus(id) {
    const s = statusAula(id);
    return s === 'ok' ? '<span class="chip ok">concluída</span>' : s === 'andamento' ? '<span class="chip andamento">praticando</span>' : '';
  }

  function renderCurso() {
    const el = $('#vista-curso');
    const prox = proximaAula();
    const algumaFeita = estado.sessoes.length > 0;
    const total = C.rotina.reduce((s, r) => s + r.min, 0);
    el.innerHTML = `
      <div class="abertura">
        <div class="intro">
          <span class="rotulo">${esc((C.curso || {}).rotulo || 'Piano em casa, pelo método de Chopin')}</span>
          <h1>${esc((C.curso || {}).titulo || 'A mão e o som primeiro. A partitura vem depois.')}</h1>
          <p class="texto">${esc((C.curso || {}).resumo || 'Cada aula tem explicação falada, um teclado animado com as notas e os dedos, e um modo de prática que escuta o seu piano pelo cabo e espera você acertar.')}</p>
          ${blocoNarracao('intro', 'Apresentação do curso', C.intro)}
          <div class="acoes">
            <a class="btn primario" href="#aula-${prox}">${algumaFeita ? 'Continuar' : 'Começar'}: aula ${idTexto(prox)}</a>
            <a class="btn" href="#progresso">Ver progresso</a>
          </div>
        </div>
        <figure class="abertura-fig" style="margin:0">
          <img src="img/cantar.jpg" alt="Pianista ao piano cantando a melodia enquanto toca" loading="eager" onerror="this.parentElement.remove()">
          <figcaption>“É preciso cantar se quiser tocar.” A posição de Chopin: direita em Mi, Fá#, Sol#, Lá#, Si; esquerda, em espelho, em Dó, Si♭, Lá♭, Sol♭, Fá.</figcaption>
        </figure>
      </div>

      <div class="secao">
        <h2>Como Chopin ensinava, e como isso vira o seu curso</h2>
        <div class="principios">
          ${C.principios.map(p => `<div><h3>${esc(p.t)}</h3><p>${esc(p.d)}</p></div>`).join('')}
        </div>
      </div>

      <div class="secao">
        <h2>Sua prática diária</h2>
        <div class="rotina">
          <div class="rotina-barra" role="img" aria-label="Rotina de ${total} minutos">
            ${C.rotina.map(r => `<div style="flex:${r.min}"><b>${esc(r.t)}</b><span>${r.min} min</span></div>`).join('')}
          </div>
          <div class="rotina-lista">${C.rotina.map(r => `<div><b>${esc(r.t)}</b> <span>· ${esc(r.d)}</span></div>`).join('')}</div>
        </div>
      </div>

      ${(C.niveis && C.niveis.length ? C.niveis : [{ n: 0, titulo: 'Os módulos' }]).map(nv => {
        const mods = C.modulos.filter(m => (m.nivel || 0) === nv.n);
        if (!mods.length) return '';
        const ids = C.aulas.filter(a => mods.some(m => m.n === a.modulo)).map(a => a.id);
        const feitas = ids.filter(id => statusAula(id) === 'ok').length;
        return `<div class="secao nivel" id="nivel-${nv.n}">
          <div class="nivel-cab">
            <span class="rotulo">${nv.n ? `Nível ${nv.n}` : ''}${nv.semanas ? ` · ${esc(nv.semanas)}` : ''}${ids.length ? ` · ${feitas} de ${ids.length} aulas` : ''}</span>
            <h2>${esc(nv.titulo)}</h2>
            ${nv.descricao ? `<p class="texto suave">${esc(nv.descricao)}</p>` : ''}
            ${nv.meta ? `<p class="texto"><b>Ao terminar:</b> ${esc(nv.meta)}</p>` : ''}
          </div>
          <div class="modulos">${mods.map(moduloHTML).join('')}</div>
        </div>`;
      }).join('')}

      <div class="secao">
        <h2>Depois do curso</h2>
        <ul class="depois">${C.depois.map(d => `<li>${esc(d)}</li>`).join('')}</ul>
      </div>

      <div class="secao">
        <h2>Fontes</h2>
        <ul class="fontes">${C.fontes.map(f => `<li>${f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.t)}</a>` : esc(f.t)}</li>`).join('')}</ul>
      </div>`;
  }
  function moduloHTML(m) {
    const aulas = C.aulas.filter(a => a.modulo === m.n);
    return `<article class="modulo" data-pronto="${m.pronto}">
      <div class="num">${m.n}</div>
      <div class="cab"><h3 style="font-size:1.15rem">${esc(m.titulo)}</h3><span class="rotulo">${esc(m.semanas || '')}</span>${m.pronto ? '' : '<span class="chip">em preparação</span>'}</div>
      <div class="corpo">
        <p class="ideia">${esc(m.ideia)}</p>
        <p class="texto"><b>Objetivo:</b> ${esc(m.objetivo)}</p>
        ${m.narracao ? blocoNarracao('modulo-' + m.n, 'Explicação do módulo ' + m.n, m.narracao) : ''}
        <ul class="aulas">
          ${m.pronto ? aulas.map(a => `<li><a href="#aula-${a.id}"><span class="id">${idTexto(a.id)}</span><span class="t">${esc(a.titulo)}</span></a>${a.tipo === 'repertorio' ? '<span class="chip">peça</span>' : ''}${chipStatus(a.id)}</li>`).join('')
            : (m.aulas || []).map((t, i) => `<li><span class="plano"><span class="id">${m.n}.${i + 1}</span><span class="t">${esc(t)}</span></span></li>`).join('')}
        </ul>
        ${m.ouvir ? `<a class="ouvir-link" href="${esc(m.ouvir.url)}" target="_blank" rel="noopener">Para ouvir: ${esc(m.ouvir.rotulo)}</a>` : ''}
      </div>
    </article>`;
  }
  function desenharPosicao() {
    const cv = $('#cv-posicao'); if (!cv) return;
    const pinta = () => {
      const { ctx, w, h } = prepararCanvas(cv);
      ctx.clearRect(0, 0, w, h);
      const lo = 50, hi = 74;
      const geo = geometria(lo, hi, w);
      const marcas = new Map();
      [[64, 1], [66, 2], [68, 3], [70, 4], [71, 5]].forEach(([m, f]) => marcas.set(m, { cor: css('--rh'), rotulo: String(f), textoCor: '#10121a' }));
      [[60, 1], [58, 2], [56, 3], [54, 4], [53, 5]].forEach(([m, f]) => marcas.set(m, { cor: css('--lh'), rotulo: String(f), textoCor: '#10121a' }));
      desenharTeclado(ctx, geo, lo, hi, 0, h, marcas, {});
    };
    pinta();
    new ResizeObserver(pinta).observe(cv);
  }

  function renderAula(id) {
    const a = AULAS.get(id);
    const el = $('#vista-aula');
    const mod = C.modulos.find(m => m.n === a.modulo);
    const i = ORDEM.indexOf(id);
    const ant = ORDEM[i - 1], prox = ORDEM[i + 1];
    const maosOp = a.maos === 'DE' || a.maos === 'D,E';
    const cab = `
      <div class="aula-cab">
        <span class="rotulo">Módulo ${a.modulo} · ${esc(mod.titulo)}</span>
        <h1>${idTexto(id)} · ${esc(a.titulo)}</h1>
        <p class="texto suave">${esc(a.resumo)}</p>
        <div class="meta">
          ${a.bpm ? `<span>♩ = ${a.bpm}</span>` : ''}${a.compasso ? `<span>${a.compasso}/4</span>` : ''}<span>${a.minutos} min</span>
          ${a.maos ? `<span>${{ D: 'mão direita', E: 'mão esquerda', DE: 'mãos juntas', 'D,E': 'uma mão de cada vez' }[a.maos]}</span>` : ''}
          ${chipStatus(id)}
        </div>
      </div>`;
    const navAulas = `<div class="navaulas">
        ${ant ? `<a class="btn" href="#aula-${ant}">← ${idTexto(ant)}</a>` : '<span></span>'}
        ${prox ? `<a class="btn" href="#aula-${prox}">${idTexto(prox)} →</a>` : '<a class="btn" href="#curso">Ver o curso</a>'}
      </div>`;
    const info = `
      <div class="aula-info">
        <div>
          <h3>Passo a passo</h3>
          <ol>${a.passos.map(p => `<li>${esc(p)}</li>`).join('')}</ol>
        </div>
        <div>
          <h3>O que observar</h3>
          <ul>${a.foco.map(p => `<li>${esc(p)}</li>`).join('')}</ul>
          <div class="criterio"><span class="rotulo">Para passar</span><p>${esc(a.criterio)}</p></div>
        </div>
      </div>`;

    if (a.tipo === 'guia') {
      const diasFeitos = new Set(estado.sessoes.filter(s => s.aula === id).map(s => s.dia));
      el.innerHTML = `<div style="display:grid;gap:22px">${cab}
        ${blocoNarracao('aula-' + id, 'Explicação da aula', a.narracao)}
        ${figurasHTML(a)}
        <div class="guia"><ol>${a.passos.map(p => `<li><span>${esc(p)}</span></li>`).join('')}</ol></div>
        <div class="linha-botoes">
          <button class="btn primario" type="button" id="fiz-hoje" ${diasFeitos.has(hojeStr()) ? 'disabled' : ''}>${diasFeitos.has(hojeStr()) ? 'Feito hoje' : 'Fiz a rotina hoje'}</button>
          <span class="aviso">${diasFeitos.size} de 3 dias feitos${statusAula(id) === 'ok' ? ' · aula concluída' : ''}</span>
        </div>
        <div class="criterio"><span class="rotulo">Para passar</span><p>${esc(a.criterio)}</p></div>
        ${navAulas}</div>`;
      $('#fiz-hoje').addEventListener('click', () => {
        registrarSessao({ quando: new Date().toISOString(), dia: hojeStr(), aula: id, minutos: a.minutos, completa: true });
        const dias = new Set(estado.sessoes.filter(s => s.aula === id).map(s => s.dia));
        if (dias.size >= 3) { estado.status[id] = { concluida: hojeStr() }; salvar(); }
        renderAula(id);
      });
      return;
    }

    if (a.tipo === 'repertorio') {
      const peca = (C.biblioteca || []).find(p => p.id === a.peca);
      const mus = peca ? musicaDaPeca(peca.id) : null;
      const prog = mus ? progressoMusica(mus) : null;
      el.innerHTML = `<div style="display:grid;gap:22px">${cab}
        ${blocoNarracao('aula-' + id, 'Guia de estudo da peça', a.narracao)}
        ${peca ? `<div class="peca-box">
          <div class="peca-info">
            <span class="rotulo">Peça · ${esc(peca.nivelTexto || '')}</span>
            <h3 class="peca-titulo">${esc(peca.compositor)} · ${esc(peca.titulo)}</h3>
            <p class="suave">${esc(peca.descricao || '')}</p>
            ${prog ? `<div class="barra-prog" aria-hidden="true"><div style="width:${prog.total ? Math.round(100 * prog.feitas / prog.total) : 0}%"></div></div><p class="aviso">${prog.feitas} de ${prog.total} etapas do plano de estudo${prog.prox ? ` · próxima: ${esc(prog.prox.titulo)}` : ''}</p>` : '<p class="aviso">O plano de estudo divide a peça em partes: cada parte com uma mão de cada vez, depois juntas, depois ligada à anterior, até a peça inteira no tempo original.</p>'}
            <p class="aviso">Partitura e MIDI: ${peca.fonteUrl ? `<a href="${esc(peca.fonteUrl)}" target="_blank" rel="noopener">${esc(peca.fonte || 'fonte')}</a>` : esc(peca.fonte || '')}${peca.licenca ? ` · ${esc(peca.licenca)}` : ''}</p>
          </div>
          <div class="linha-botoes">
            <button class="btn primario" type="button" id="btn-peca">${mus ? 'Continuar o plano de estudo' : 'Criar o plano de estudo'}</button>
            ${peca.ouvirUrl ? `<a class="btn" href="${esc(peca.ouvirUrl)}" target="_blank" rel="noopener">Ouvir uma gravação</a>` : ''}
            <span class="aviso" id="peca-msg" aria-live="polite"></span>
          </div>
        </div>` : '<p class="aviso">Peça não encontrada na biblioteca.</p>'}
        ${info}
        ${navAulas}</div>`;
      const b = $('#btn-peca');
      if (b) b.addEventListener('click', async () => {
        b.disabled = true; $('#peca-msg').textContent = mus ? '' : 'Carregando a peça…';
        try { const m = await abrirPeca(peca); location.hash = 'musica-' + m.id; }
        catch (e) { $('#peca-msg').textContent = 'Não consegui carregar a peça (' + e.message + '). Verifique a conexão e tente de novo.'; b.disabled = false; }
      });
      return;
    }

    el.innerHTML = `<div style="display:grid;gap:22px">${cab}
      ${blocoNarracao('aula-' + id, a.guia ? 'Só a explicação, em áudio' : 'Explicação da aula', a.narracao)}
      ${figurasHTML(a)}
      ${htmlPlayer(a)}
      <div id="resultado"></div>
      ${info}
      ${historicoAula(id)}
      ${navAulas}</div>`;
    montarPlayer(a, { aoPassar: () => { if (prox && !Jornada.bloqueado()) location.hash = 'aula-' + prox; else location.hash = 'curso'; }, ultimo: !prox });
  }

  function figurasHTML(a) {
    if (!a.figuras || !a.figuras.length) return '';
    return `<div class="figuras">${a.figuras.map(f => `<figure class="figura">
        ${f.img ? `<img class="ilustracao" src="img/${esc(f.img)}" alt="${esc(f.titulo)}, ilustração" loading="lazy" onerror="this.remove()">` : ''}
        ${f.anim ? `<div class="anim" aria-label="${esc(f.titulo)}, animação">${[1, 2, 3].map(k => `<img src="img/${esc(f.anim)}-${k}.jpg" alt="" loading="lazy" style="--k:${k - 1}" onerror="this.parentElement.remove()">`).join('')}</div>` : ''}
        <figcaption><b>${esc(f.titulo)}</b><span>${esc(f.legenda)}</span></figcaption>
      </figure>`).join('')}</div>`;
  }
  function htmlPlayer(a) {
    const p = estado.prefs, chave = a.chaveTempo || 'tempo', tv = p[chave] ?? 1;
    const maosOp = a.maos === 'DE' || a.maos === 'D,E';
    return `<div class="player ${a.leitura ? 'leitura' : ''}" id="player">
        ${a.leitura ? '<p class="aviso leitura-aviso">Leitura à primeira vista: o teclado animado fica escondido. Leia a partitura e toque. Em <b>Ouvir</b> você confere o trecho depois de tentar.</p>' : ''}
        ${a.guia ? `<div class="guia-barra" id="guia-barra"><button class="btn primario" type="button" data-guia="iniciar">▶ Aula guiada</button>
          <span class="aviso">A narração explica cada passo e o teclado mostra junto: teclas acesas com os dedos e trechos tocados.</span></div>` : ''}
        <div class="controles">
          <div class="seg" role="group" aria-label="Modo">
            <button type="button" data-modo="ouvir" aria-pressed="true">▶ Ouvir</button>
            <button type="button" data-modo="praticar" aria-pressed="false">▶ Praticar</button>
          </div>
          ${maosOp ? `<div class="seg" role="group" aria-label="Mãos">
            <button type="button" data-maos="todas" aria-pressed="true">Ambas</button>
            <button type="button" data-maos="D" aria-pressed="false">Direita</button>
            <button type="button" data-maos="E" aria-pressed="false">Esquerda</button>
          </div>` : ''}
          <label class="campo" for="tempo">Tempo <input id="tempo" type="range" min="${a.chaveTempo ? 0.3 : 0.5}" max="1.25" step="0.05" value="${tv}"> <b id="tempo-txt">♩ = ${Math.round(a.bpm * tv)}</b></label>
          <label class="chk"><input type="checkbox" id="metronomo" ${p.metronomo ? 'checked' : ''}> Metrônomo</label>
          <label class="chk"><input type="checkbox" id="nomes" ${p.nomes ? 'checked' : ''}> Nomes das notas</label>
          <label class="chk"><input type="checkbox" id="repetir" ${p.repetir ? 'checked' : ''}> Repetir</label>
          ${window.Partitura && window.Partitura.disponivel() && a.notas.length ? `<label class="chk"><input type="checkbox" id="partitura-chk" ${p.partitura ? 'checked' : ''}> Partitura</label>` : ''}
          <label class="chk" title="Explica, demonstra, entra em Praticar e avança sozinho"><input type="checkbox" id="fluxo-chk" ${p.fluxo !== false ? 'checked' : ''}> Automático</label>
          <label class="chk" title="Avisos falados do treinador a cada erro (o texto continua aparecendo)"><input type="checkbox" id="voz-chk" ${p.treinadorVoz !== false ? 'checked' : ''}> Voz do treinador</label>
          <label class="chk" title="Enquanto você toca, esconde o resto da tela e deixa só o teclado, as mãos e o treinador"><input type="checkbox" id="foco-chk" ${p.foco !== false ? 'checked' : ''}> Foco ao tocar</label>
        </div>
        <div class="palco"><canvas aria-label="Teclado animado: as notas descem até as teclas que você deve apertar"></canvas></div>
        <div class="treinador" id="treinador"><div class="tr-msg" id="tr-msg" aria-live="assertive">O treinador avisa na hora: tecla errada, nota atrasada ou apressada.</div><div class="tr-barras" id="tr-barras" aria-label="Últimas notas: altura da barra = quanto o tempo variou"></div></div>
        <div class="maos">${maoSVG('E')}<p class="legenda-mao" aria-live="polite"></p>${maoSVG('D')}</div>
        ${window.Partitura && window.Partitura.disponivel() && a.notas.length ? `<div class="partitura" id="partitura" ${p.partitura ? '' : 'hidden'} aria-label="Partitura do exercício"></div>` : ''}
        <div class="transporte">
          <button class="btn primario tocar" type="button" data-acao="tocar"></button>
          <button class="btn" type="button" data-acao="reiniciar">Do início</button>
          <div class="barra-prog" aria-hidden="true"><div></div></div>
          ${a.secoes.length ? `<div class="secoes-chips">${a.secoes.map(s => `<button type="button" data-ir="${s.t}">${esc(s.rotulo)}</button>`).join('')}</div>` : ''}
        </div>
        <p class="status" aria-live="polite"></p>
      </div>`;
  }

  function montarPlayer(a, opts = {}) {
    const p = estado.prefs, chave = a.chaveTempo || 'tempo';
    const raiz = $('#player');
    const pl = playerAtual = new Player(raiz, a);
    pl.atualizarTransporte();
    raiz.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (!Fluxo.clicando && Fluxo.ativo && (b.dataset.modo || b.dataset.acao || b.dataset.guia)) { const guiaRodando = Guia.ativo; Fluxo.parar(); if (guiaRodando && b.dataset.guia) { /* o botão da guia ainda age abaixo */ } }
      if (b.dataset.guia) {
        if (b.dataset.guia === 'iniciar' && !Guia.ativo) { Som.iniciar(); rodarGuia(a, pl); }
        if (b.dataset.guia === 'pular') Guia.pular();
        if (b.dataset.guia === 'parar') Guia.parar();
        return;
      }
      if (Guia.ativo) Guia.parar();
      if (b.dataset.modo) {
        const mesmo = pl.modo === b.dataset.modo;
        $$('[data-modo]', raiz).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        if (!mesmo) { pl.definirModo(b.dataset.modo); $('#resultado').innerHTML = ''; }
        if (b.dataset.modo === 'praticar' && Midi.estado === 'pedir') Midi.iniciar(true);
        if (mesmo && pl.tocando) pl.parar(); else { Narr.parar(); pl.tocar(); }
        pl.atualizarStatus();
      }
      if (b.dataset.maos) { $$('[data-maos]', raiz).forEach(x => x.setAttribute('aria-pressed', String(x === b))); pl.definirMaos(b.dataset.maos); }
      if (b.dataset.acao === 'tocar') { if (pl.tocando) pl.parar(); else { Narr.parar(); pl.tocar(); } pl.atualizarStatus(); }
      if (b.dataset.acao === 'reiniciar') { pl.reiniciar(); $('#resultado').innerHTML = ''; }
      if (b.dataset.ir != null) pl.irPara(+b.dataset.ir);
    });
    $('#tempo').addEventListener('input', e => {
      p[chave] = +e.target.value; salvar();
      $('#tempo-txt').textContent = `♩ = ${Math.round(a.bpm * p[chave])}`;
      pl.reancorar();
    });
    $('#metronomo').addEventListener('change', e => {
      p.metronomo = e.target.checked; salvar();
      if (pl.tocando && pl.modo === 'praticar') { if (p.metronomo) Player.metronomoLivre(pl.bpm * pl.fator, pl.compasso, Som.ctx.currentTime + 0.05); else Player.metro && Player.metro.parar(); }
    });
    $('#nomes').addEventListener('change', e => { p.nomes = e.target.checked; salvar(); pl.desenhar(); });
    $('#repetir').addEventListener('change', e => { p.repetir = e.target.checked; salvar(); });
    const vozChk = $('#voz-chk'); if (vozChk) vozChk.addEventListener('change', e => { p.treinadorVoz = e.target.checked; salvar(); });
    const focoChk = $('#foco-chk'); if (focoChk) focoChk.addEventListener('change', e => { p.foco = e.target.checked; salvar(); pl.aplicarFoco(); });
    const fluxoChk = $('#fluxo-chk');
    if (fluxoChk) fluxoChk.addEventListener('change', e => { p.fluxo = e.target.checked; salvar(); if (!p.fluxo) Fluxo.parar(); else Fluxo.quandoPuder(() => Fluxo.pratica(a, pl, opts.aoPassar)); });
    const partEl = $('#partitura');
    if (partEl) {
      let larguraAnt = 0;
      pl.desenharPartitura = () => { if (partEl.hidden) return; const w = partEl.clientWidth; if (w === larguraAnt) return; larguraAnt = w; try { pl.partitura = window.Partitura.render(partEl, a); } catch (e) { partEl.innerHTML = '<p class="aviso">Não consegui desenhar a partitura deste trecho.</p>'; pl.partitura = null; } };
      pl.desenharPartitura();
      new ResizeObserver(() => pl.desenharPartitura()).observe(partEl);
      const chk = $('#partitura-chk');
      if (chk) chk.addEventListener('change', e => { p.partitura = e.target.checked; salvar(); partEl.hidden = !p.partitura; if (p.partitura) { larguraAnt = 0; pl.desenharPartitura(); } });
    }
    raiz.addEventListener('resultado', ev => { mostrarResultado(a, ev.detail); if (opts.aoResultado) opts.aoResultado(ev.detail); Fluxo.resultado(a, pl, ev.detail.r, opts); });
    if (opts.auto !== false && a.tipo === 'pratica') Fluxo.quandoPuder(() => Fluxo.pratica(a, pl, opts.aoPassar));
    return pl;
  }

  function nivel(v, meta) {
    if (v == null || meta == null) return '';
    return v >= meta ? 'ok' : v >= meta - 10 ? 'warn' : 'bad';
  }
  function mostrarResultado(a, { r, dicas: ds }) {
    const p = a.passa || {};
    const met = [];
    met.push(`<div class="metrica" data-nivel="${nivel(r.acertos, p.acertos)}"><span>Notas certas</span><b>${r.acertos}%</b><span>${r.erros} erro${r.erros === 1 ? '' : 's'} em ${r.eventos}</span></div>`);
    if (r.regularidade != null) met.push(`<div class="metrica" data-nivel="${nivel(r.regularidade, p.regularidade)}"><span>Regularidade do tempo</span><b>${r.regularidade}%</b><span>variação de ±${r.variacao}%</span></div>`);
    if (r.bpm != null) met.push(`<div class="metrica" data-nivel="${p.bpm ? (r.bpm >= p.bpm ? 'ok' : 'warn') : ''}"><span>Seu tempo</span><b>♩ = ${r.bpm}</b><span>${p.bpm ? 'meta ♩ = ' + p.bpm : ''}</span></div>`);
    if (r.buracos != null) met.push(`<div class="metrica" data-nivel="${r.buracos <= (p.buracosMax ?? 1) ? 'ok' : r.buracos <= 3 ? 'warn' : 'bad'}"><span>Buracos no legato</span><b>${r.buracos}</b><span>${r.embolou ? r.embolou + ' notas emboladas' : 'silêncios entre notas ligadas'}</span></div>`);
    if (r.staccato != null) met.push(`<div class="metrica" data-nivel="${r.staccato >= 70 ? 'ok' : r.staccato >= 50 ? 'warn' : 'bad'}"><span>Staccato curto</span><b>${r.staccato}%</b><span>notas que soltaram cedo</span></div>`);
    if (r.dinamica != null) met.push(`<div class="metrica" data-nivel="${nivel(r.dinamica, p.dinamica)}"><span>Dinâmica</span><b>${r.dinamica}%</b><span>aderência ao desenho</span></div>`);
    if (r.equilibrio != null) met.push(`<div class="metrica" data-nivel="${p.equilibrio != null ? (r.equilibrio >= p.equilibrio ? 'ok' : r.equilibrio >= 0 ? 'warn' : 'bad') : ''}"><span>Melodia × acompanhamento</span><b>${r.equilibrio > 0 ? '+' : ''}${r.equilibrio}%</b><span>direita em relação à esquerda</span></div>`);
    if (r.pedal != null) met.push(`<div class="metrica" data-nivel="${nivel(r.pedal, p.pedal)}"><span>Pedal sincopado</span><b>${r.pedal}%</b><span>${r.pedalTrocas} troca${r.pedalTrocas === 1 ? '' : 's'} recebida${r.pedalTrocas === 1 ? '' : 's'}</span></div>`);
    const linhas = ['D', 'E'].filter(h => [1, 2, 3, 4, 5].some(k => r.forca[h + k] != null)).map(h => {
      const vs = [1, 2, 3, 4, 5].map(k => r.forca[h + k]);
      return `<div class="linha ${h}"><span>${h === 'D' ? 'Mão direita' : 'Mão esquerda'}</span>${vs.map((v, k) => `<div class="col"><i style="height:${v == null ? 0 : Math.round(8 + 52 * v / 127)}px"></i>${v == null ? '—' : v}<span>dedo ${k + 1}</span></div>`).join('')}</div>`;
    }).join('');
    $('#resultado').innerHTML = `<div class="resultado" data-passou="${r.passou}">
      <div class="veredito"><span class="selo">${r.passou ? 'Passou' : 'Ainda não'}</span><h3>${r.passou ? (r.parcial ? 'Trecho dentro da meta. Para concluir a aula, toque do início ao fim.' : (a.textoPassou || 'Aula concluída. Pode seguir para a próxima.')) : 'Falta: ' + esc(r.faltas.join(' · '))}</h3></div>
      <div class="metricas">${met.join('')}</div>
      ${r.linha ? `<div class="linha-tempo"><span class="rotulo">Linha do tempo · nota a nota (barra para cima = atrasou, para baixo = apressou, vermelho = tecla errada)</span>
        <div class="lt-grade">${r.linha.map(x => { const dev = x.dev; const h = dev == null ? 0 : Math.max(-22, Math.min(22, 22 * Math.log2(dev))); const cls = x.erros ? 'erro' : dev == null ? 'neutro' : dev > 1.35 ? 'tarde' : dev < 0.72 ? 'cedo' : 'ok'; return `<div class="lt-col ${cls}" title="Nota ${x.i + 1}: ${esc(x.nome)}${dev != null ? ` · ${dev > 1 ? '+' : ''}${Math.round((dev - 1) * 100)}%` : ''}${x.erros ? ` · ${x.erros} erro(s)` : ''}"><i style="${h >= 0 ? `height:${h}px;bottom:50%` : `height:${-h}px;top:50%`}"></i><span>${x.i + 1}</span></div>`; }).join('')}</div>
        <p class="aviso">Regularidade mede se o intervalo entre cada nota e a anterior acompanhou o ritmo escrito. Tocar devagar não tira pontos; parar para procurar a tecla, sim.</p></div>` : ''}
      ${linhas ? `<div class="dedos"><span class="rotulo">Força média por dedo (0 a 127)</span>${linhas}</div>` : ''}
      <div><span class="rotulo">O que fazer agora</span><ul class="dicas">${ds.map(d => `<li>${esc(d)}</li>`).join('')}</ul></div>
      <p class="aviso">${Nuvem.logado ? 'Salvo neste aparelho e enviado para a nuvem.' : Nuvem.estado === 'sem-config' ? 'Salvo neste aparelho.' : 'Salvo só neste aparelho. Entre na aba Progresso para guardar também na nuvem.'}</p>
    </div>`;
    $('#resultado').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    falarFeedback(r);
  }
  function falarFeedback(r) {
    if (estado.prefs.feedbackFalado === false) return;
    const cat = r.passou ? (r.parcial ? 'parcial' : 'passou') : (['acertos', 'regularidade', 'bpm', 'buracos', 'dinamica', 'equilibrio', 'pedal'].find(k => r.faltas.some(f => f.startsWith({ acertos: 'notas certas', regularidade: 'regularidade', bpm: 'tempo', buracos: 'buracos', dinamica: 'dinâmica', equilibrio: 'melodia', pedal: 'trocas de pedal' }[k]))) || 'acertos');
    Narr.parar();
    Fluxo.feedbackAtual = Fluxo.falar('feedback-' + cat, (C.feedback && C.feedback[cat]) || '').catch(() => {});
  }

  function historicoAula(id) {
    const ss = estado.sessoes.filter(s => s.aula === id && s.r).slice(-6).reverse();
    if (!ss.length) return '';
    return `<div style="display:grid;gap:10px"><h3>Suas últimas tentativas</h3><div class="tabela-wrap"><table>
      <thead><tr><th>Quando</th><th>Mãos</th><th>Tempo</th><th>Certas</th><th>Regularidade</th><th>Legato</th><th></th></tr></thead>
      <tbody>${ss.map(s => `<tr><td>${new Date(s.quando).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
        <td>${{ todas: 'ambas', D: 'direita', E: 'esquerda' }[s.maos] || '—'}</td><td class="num">♩ = ${s.r.bpm ?? '—'}</td><td class="num">${s.r.acertos}%</td>
        <td class="num">${s.r.regularidade ?? '—'}%</td><td class="num">${s.r.buracos ?? '—'}</td><td>${s.r.passou ? '<span class="chip ok">passou</span>' : ''}</td></tr>`).join('')}</tbody>
    </table></div></div>`;
  }

  function relatorio() {
    const hoje = new Date();
    const limite = new Date(hoje); limite.setDate(limite.getDate() - 6);
    const lim = hojeStr(limite);
    const sem = estado.sessoes.filter(s => s.dia >= lim);
    const dias = new Set(sem.map(s => s.dia));
    const min = Math.round(sem.reduce((a, s) => a + (s.minutos || 0), 0));
    const concl = ORDEM.filter(id => statusAula(id) === 'ok').map(idTexto);
    const linhas = [
      `Relatório do Curso Chopin · ${hojeStr()}`,
      `Últimos 7 dias: ${dias.size} dia(s) de prática, ${min} min, ${sem.length} sessão(ões).`,
      `Aulas concluídas: ${concl.length ? concl.join(', ') : 'nenhuma ainda'}.`,
      `Próxima aula: ${idTexto(proximaAula())}.`,
      ...musicasVisiveis().map(m => { const { feitas, total, prox } = progressoMusica(m); return `Música "${m.titulo}": ${feitas} de ${total} etapas${prox ? ` (próxima: ${prox.titulo})` : ''}; ${m.config.nivel === 'simples' ? 'simplificado' : 'completo'}, partes de ${m.config.tamanho} compassos.`; }),
      '', 'Últimas sessões avaliadas:'
    ];
    estado.sessoes.filter(s => s.r).slice(-12).forEach(s => {
      const r = s.r;
      const f = r.forca || {};
      const forca = ['D', 'E'].map(h => [1, 2, 3, 4, 5].some(k => f[h + k] != null) ? `${h === 'D' ? 'MD' : 'ME'} ${[1, 2, 3, 4, 5].map(k => `${k}:${f[h + k] ?? '-'}`).join(' ')}` : '').filter(Boolean).join(' | ');
      const onde = r.ondeBuracos ? Object.entries(r.ondeBuracos).map(([k, v]) => `${k}×${v}`).join(', ') : '';
      linhas.push(`- ${s.dia} · ${rotuloAula(s.aula)} (${{ todas: 'ambas', D: 'MD', E: 'ME' }[s.maos] || '-'}, tempo pedido ♩=${s.tempo}) · certas ${r.acertos}% · regularidade ${r.regularidade ?? '-'}% · ♩=${r.bpm ?? '-'}`
        + (r.buracos != null ? ` · legato: ${r.buracos} buraco(s)${onde ? ' [' + onde + ']' : ''}` : '')
        + (r.staccato != null ? ` · staccato curto ${r.staccato}%` : '')
        + (r.dinamica != null ? ` · dinâmica ${r.dinamica}%` : '')
        + (forca ? ` · força ${forca}` : '') + (r.passou ? ' · PASSOU' : ''));
    });
    if (!estado.sessoes.some(s => s.r)) linhas.push('(nenhuma ainda)');
    return linhas.join('\n');
  }

  function renderProgresso() {
    const el = $('#vista-progresso');
    const dias = [];
    for (let i = 13; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); dias.push(hojeStr(d)); }
    const porDia = new Map(dias.map(d => [d, 0]));
    estado.sessoes.forEach(s => { if (porDia.has(s.dia)) porDia.set(s.dia, porDia.get(s.dia) + (s.minutos || 0)); });
    const maxMin = Math.max(45, ...porDia.values());
    let seq = 0;
    for (let i = dias.length - 1; i >= 0; i--) { if (porDia.get(dias[i]) > 0) seq++; else if (i !== dias.length - 1) break; }
    const sem = dias.slice(-7).reduce((a, d) => a + porDia.get(d), 0);
    const concl = ORDEM.filter(id => statusAula(id) === 'ok').length;
    const metaY = 100 - (30 / maxMin) * 100;
    el.innerHTML = `<div style="display:grid;gap:28px">
      <div class="aula-cab"><span class="rotulo">Seu acompanhamento</span><h1>Progresso</h1>
        <p class="texto suave">Cada exercício fica salvo neste aparelho e, com a nuvem ligada, também na sua conta. Para eu acompanhar e ajustar o curso, copie o relatório e cole na nossa conversa.</p></div>
      <div id="nuvem"></div>
      <div class="resumo">
        <div><b>${Math.round(sem)}</b><span>minutos nos últimos 7 dias</span></div>
        <div><b>${seq}</b><span>dia${seq === 1 ? '' : 's'} seguido${seq === 1 ? '' : 's'} praticando</span></div>
        <div><b>${concl}<span style="font-size:1rem;color:var(--muted)"> / ${ORDEM.length}</span></b><span>aulas prontas concluídas</span></div>
        <div><b>${estado.sessoes.filter(s => s.r).length}</b><span>exercícios avaliados</span></div>
      </div>
      <div class="grafico">
        <span class="rotulo">Minutos por dia · linha tracejada = 30 min</span>
        <div class="barras">
          <div class="meta-linha" style="top:${metaY}%"></div>
          ${dias.map(d => { const v = porDia.get(d); const hpc = (v / maxMin) * 100; return `<div class="b ${d === hojeStr() ? 'hoje' : ''}" style="--h:${hpc}%"><i style="height:${hpc}%"></i>${v ? `<em>${Math.round(v)}</em>` : ''}</div>`; }).join('')}
        </div>
        <div class="dias">${dias.map(d => `<span>${d.slice(8)}/${d.slice(5, 7)}</span>`).join('')}</div>
      </div>
      <div style="display:grid;gap:10px"><h2>Níveis</h2>
        <div class="niveis-prog">${(C.niveis || []).map(nv => { const ids = C.aulas.filter(a => C.modulos.some(m => m.n === a.modulo && (m.nivel || 0) === nv.n)).map(a => a.id); const ok = ids.filter(id => statusAula(id) === 'ok').length; return `<div class="nivel-prog"><div class="cab"><b>Nível ${nv.n} · ${esc(nv.titulo.split(':')[0])}</b><span class="mono">${ok} / ${ids.length}${ok === ids.length && ids.length ? ' · concluído' : ''}</span></div><div class="barra-prog" aria-hidden="true"><div style="width:${ids.length ? Math.round(100 * ok / ids.length) : 0}%"></div></div></div>`; }).join('')}</div>
      </div>
      <div style="display:grid;gap:10px"><h2>Aulas</h2>
        <div class="tabela-wrap"><table>
          <thead><tr><th>Aula</th><th>Status</th><th>Melhor regularidade</th><th>Melhor tempo</th><th>Minutos</th></tr></thead>
          <tbody>${C.aulas.map(a => {
            const ss = estado.sessoes.filter(s => s.aula === a.id);
            const av = ss.filter(s => s.r);
            const melhorReg = av.length ? Math.max(...av.map(s => s.r.regularidade ?? 0)) : null;
            const melhorBpm = av.length ? Math.max(...av.map(s => s.r.bpm ?? 0)) : null;
            const min = Math.round(ss.reduce((x, s) => x + (s.minutos || 0), 0));
            return `<tr><td><a href="#aula-${a.id}">${idTexto(a.id)} ${esc(a.titulo)}</a></td><td>${chipStatus(a.id) || '<span class="suave">—</span>'}</td>
              <td class="num">${melhorReg != null ? melhorReg + '%' : '—'}</td><td class="num">${melhorBpm ? '♩ = ' + melhorBpm : '—'}</td><td class="num">${min || '—'}</td></tr>`;
          }).join('')}</tbody>
        </table></div>
      </div>
      ${musicasVisiveis().length ? `<div style="display:grid;gap:10px"><h2>Músicas</h2>
        <div class="tabela-wrap"><table>
          <thead><tr><th>Música</th><th>Etapas</th><th>Próxima</th><th>Minutos</th></tr></thead>
          <tbody>${musicasVisiveis().map(m => {
            const { feitas, total, prox } = progressoMusica(m);
            const min = Math.round(estado.sessoes.filter(s => s.aula.startsWith('m:' + m.id + ':')).reduce((x, s) => x + (s.minutos || 0), 0));
            return `<tr><td><a href="#musica-${esc(m.id)}">${esc(m.titulo)}</a></td><td class="num">${feitas} / ${total}</td><td>${prox ? esc(prox.titulo) : '—'}</td><td class="num">${min || '—'}</td></tr>`;
          }).join('')}</tbody>
        </table></div></div>` : ''}
      <div style="display:grid;gap:10px">
        <h2>Relatório para o Claude</h2>
        <p class="texto suave">Cole este texto na conversa a cada semana. Com ele eu ajusto tempos, escolho o que revisar e preparo os próximos módulos para os seus pontos fracos.</p>
        <textarea id="relatorio" readonly>${esc(relatorio())}</textarea>
        <div class="linha-botoes"><button class="btn primario" type="button" id="copiar-rel">Copiar relatório</button><span class="aviso" id="copiar-msg" aria-live="polite"></span></div>
      </div>
      <div style="display:grid;gap:10px">
        <h2>Backup manual</h2>
        <p class="texto suave">Uma cópia extra em texto, para guardar numa nota ou levar para outro aparelho. Com a nuvem ligada, você não precisa disso no dia a dia.</p>
        <textarea id="backup" placeholder="Cole aqui um backup para restaurar"></textarea>
        <div class="linha-botoes">
          <button class="btn" type="button" id="copiar-backup">Copiar backup</button>
          <button class="btn" type="button" id="restaurar">Restaurar do texto colado</button>
          <span class="aviso" id="backup-msg" aria-live="polite"></span>
        </div>
      </div>
    </div>`;
    const copiar = (texto, msgEl, campo) => {
      const ok = () => { msgEl.textContent = 'Copiado.'; };
      const falha = () => { if (campo) { campo.focus(); campo.select(); } msgEl.textContent = 'Selecionei o texto: use Copiar do sistema.'; };
      try { navigator.clipboard.writeText(texto).then(ok, falha); } catch (e) { falha(); }
    };
    renderNuvem();
    $('#copiar-rel').addEventListener('click', () => copiar($('#relatorio').value, $('#copiar-msg'), $('#relatorio')));
    $('#copiar-backup').addEventListener('click', () => {
      const t = JSON.stringify({ v: 1, sessoes: estado.sessoes, status: estado.status });
      $('#backup').value = t; copiar(t, $('#backup-msg'), $('#backup'));
    });
    $('#restaurar').addEventListener('click', () => {
      try {
        const d = JSON.parse($('#backup').value);
        if (!Array.isArray(d.sessoes) || typeof d.status !== 'object') throw new Error('formato');
        const chave = s => s.quando + s.aula;
        const vistos = new Set(estado.sessoes.map(chave));
        d.sessoes.forEach(s => { if (!vistos.has(chave(s))) estado.sessoes.push(Object.assign({}, s, { sync: false })); });
        estado.sessoes.sort((a, b) => a.quando.localeCompare(b.quando));
        Object.assign(estado.status, d.status);
        salvar(); renderProgresso(); Nuvem.agendar();
        $('#backup-msg').textContent = 'Backup juntado ao progresso deste aparelho.';
      } catch (e) {
        $('#backup-msg').textContent = 'Não reconheci esse texto. Cole o backup inteiro, do primeiro { ao último }.';
      }
    });
  }


  function renderNuvem() {
    const el = $('#nuvem'); if (!el) return;
    const N = Nuvem;
    const hora = N.ultima ? new Date(N.ultima).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : null;
    const pend = estado.sessoes.filter(s => !s.sync).length;
    let corpo = '';
    if (N.estado === 'sem-config') {
      corpo = `<p><b>A nuvem ainda não está configurada.</b> Por enquanto, seus dados ficam só neste aparelho. Use o backup manual no fim da página.</p>`;
    } else if (!N.logado) {
      corpo = `
        <p><b>Seus dados estão só neste aparelho.</b> Entre na sua conta para guardar cada exercício na nuvem. Se o app for apagado ou o iPad trocado, é só entrar de novo.</p>
        <form class="form-conta" id="form-conta">
          <label class="campo" for="email">E-mail <input id="email" class="entrada" type="email" autocomplete="username" required value="${esc(N.email)}"></label>
          <label class="campo" for="senha">Senha <input id="senha" class="entrada" type="password" autocomplete="current-password" minlength="6" required></label>
          <div class="linha-botoes"><button class="btn primario" type="submit">Entrar</button><button class="btn" type="button" id="criar-conta">Criar conta</button></div>
        </form>`;
    } else {
      const txt = N.estado === 'sincronizando' ? 'Sincronizando…'
        : N.estado === 'erro' ? esc(N.erro)
        : `Tudo salvo na nuvem${hora ? ' · última sincronização ' + hora : ''}.`;
      corpo = `<p>Conectado como <b>${esc(N.usuario.email || N.email)}</b>.</p>
        <p class="${N.estado === 'erro' ? '' : 'suave'}">${txt}${pend && N.estado !== 'sincronizando' ? ` ${pend} exercício(s) esperando envio.` : ''}</p>
        <div class="linha-botoes"><button class="btn" type="button" id="sincronizar" ${N.estado === 'sincronizando' ? 'disabled' : ''}>Sincronizar agora</button><button class="btn" type="button" id="sair">Sair</button></div>`;
    }
    el.innerHTML = `<div class="nuvem" data-estado="${N.logado ? (N.estado === 'erro' ? 'erro' : 'ok') : 'fora'}">
      <span class="rotulo">Seus dados</span>${corpo}<p class="aviso" id="nuvem-msg" aria-live="polite">${!N.logado && N.estado === 'erro' ? esc(N.erro) : ''}</p></div>`;
    const msg = $('#nuvem-msg');
    const ocupar = (form, sim) => $$('button, input', form).forEach(x => { x.disabled = sim; });
    const fc = $('#form-conta');
    if (fc) {
      const agir = async criar => {
        if (!fc.reportValidity()) return;
        ocupar(fc, true); msg.textContent = criar ? 'Criando a conta…' : 'Entrando…';
        try {
          if (criar) await N.criarConta($('#email').value, $('#senha').value); else await N.entrar($('#email').value, $('#senha').value);
          renderProgresso();
        } catch (e) {
          ocupar(fc, false);
          msg.textContent = e && e.message === 'CONFIRMACAO_LIGADA'
            ? 'A conta foi criada, mas a confirmação por e-mail está ligada no Supabase. Desligue em Authentication → Sign In / Providers → Email → "Confirm email", apague o usuário em Authentication → Users e crie a conta de novo.'
            : N.traduzir(e);
        }
      };
      fc.addEventListener('submit', ev => { ev.preventDefault(); agir(false); });
      $('#criar-conta').addEventListener('click', () => agir(true));
    }
    const sy = $('#sincronizar'); if (sy) sy.addEventListener('click', () => N.sincronizar(true));
    const sa = $('#sair'); if (sa) sa.addEventListener('click', async () => { await N.sair(); renderNuvem(); });
  }
  document.addEventListener('musicas-mudaram', () => {
    const v = $('#vista-musicas');
    if (!v || v.hidden || $('#form-musica') || (playerAtual && playerAtual.tocando)) return;
    const h = location.hash.slice(1);
    if (h === 'musicas') renderMusicas();
    else if (h.startsWith('musica-') && !acharMusica(h.slice(7))) renderMusica(h.slice(7));
  });
  document.addEventListener('nuvem-estado', () => {
    if ($('#vista-progresso').hidden) return;
    const foco = document.activeElement;
    if (foco && foco.closest && foco.closest('#nuvem') && foco.tagName === 'INPUT') return; // não apaga o que está sendo digitado
    renderNuvem();
  });



  /* ------------------------------------------------------------ dedilhado automático (sugestão)
     Programação dinâmica sobre os dedos possíveis de cada nota/acorde. O custo mede o conforto
     entre dedos vizinhos (distâncias confortáveis, inspiradas em Parncutt et al.) e aplica
     preferências do método de Chopin: dedos longos (2, 3, 4) nas teclas pretas, polegar nas brancas,
     passagem do polegar por baixo em vez de cruzar outros dedos. */
  // [mínimo prático, mínimo confortável, mínimo relaxado, máximo relaxado, máximo confortável, máximo prático]
  const VAOS = {
    '1-2': [-5, -3, 1, 5, 8, 10], '1-3': [-4, -2, 3, 7, 10, 12], '1-4': [-3, -1, 5, 9, 12, 14], '1-5': [-1, 1, 7, 10, 13, 15],
    '2-3': [1, 1, 1, 2, 3, 5], '2-4': [1, 1, 3, 4, 5, 7], '2-5': [2, 2, 5, 6, 8, 10],
    '3-4': [1, 1, 1, 2, 2, 4], '3-5': [1, 1, 3, 4, 5, 7], '4-5': [1, 1, 1, 2, 3, 5]
  };
  function custoPar(f1, f2, d) {
    // d: distância em semitons na direção "natural" da mão (positiva = rumo ao mindinho)
    if (f1 === f2) return d === 0 ? 0 : Math.abs(d) <= 4 ? 12 : 2 + 0.3 * Math.abs(d); // mesmo dedo: ruim em notas vizinhas, normal ao mudar de posição
    const inverte = f1 > f2;
    const [a, b] = inverte ? [f2, f1] : [f1, f2];
    let v = VAOS[a + '-' + b];
    if (inverte) v = v.map(x => -x).reverse();
    const [minP, minC, minR, maxR, maxC, maxP] = v;
    let c = 0;
    const passagem = a === 1 && ((f1 !== 1 && f2 === 1 && d > 0) || (f1 === 1 && d < 0)); // polegar por baixo / dedo por cima do polegar
    if (d < minR) c += d >= minC ? (minR - d) : d >= minP ? (minR - minC) + 2 * (minC - d) : 20 + 3 * (minP - d);
    if (d > maxR) c += d <= maxC ? (d - maxR) : d <= maxP ? (maxC - maxR) + 2 * (d - maxC) : 20 + 3 * (d - maxP);
    // cruzamentos: polegar por baixo / dedo por cima do polegar são normais; outros cruzamentos não
    if (a !== 1 && ((!inverte && d < 0) || (inverte && d > 0))) c += 12;
    if (passagem) c = c * 0.6 + 1;
    return c;
  }
  function custoDedo(f, m) {
    const preta = ehPreta(m);
    if (preta && f === 1) return 7;      // polegar na preta: evitar
    if (preta && f === 5) return 1.5;
    if (preta && f >= 2 && f <= 4) return -0.3; // dedos longos nas pretas (Chopin)
    return 0;
  }
  function combinacoes(k) {
    const out = [];
    const rec = (ini, atual) => { if (atual.length === k) { out.push(atual.slice()); return; } for (let f = ini; f <= 5; f++) { atual.push(f); rec(f + 1, atual); atual.pop(); } };
    rec(1, []);
    return out;
  }
  const COMB = [null, combinacoes(1), combinacoes(2), combinacoes(3), combinacoes(4), combinacoes(5)];
  function dedilhar(notas, h) {
    if (!notas.length) return notas;
    const q = m => (h === 'D' ? m : -m); // espelha a mão esquerda: tudo vira "rumo ao mindinho = q maior"
    const grupos = [];
    const porT = new Map();
    notas.forEach(n => { const k = n.t.toFixed(3); if (!porT.has(k)) { porT.set(k, []); grupos.push({ t: n.t, notas: porT.get(k) }); } porT.get(k).push(n); });
    grupos.sort((a, b) => a.t - b.t);
    grupos.forEach(g => { g.notas.sort((a, b) => q(a.m) - q(b.m)); g.cands = COMB[Math.min(5, g.notas.length)]; g.fim = Math.max(...g.notas.map(n => n.t + n.d)); });
    const interno = (g, c) => {
      let s = 0;
      for (let i = 0; i < c.length; i++) s += custoDedo(c[i], g.notas[i].m);
      for (let i = 0; i + 1 < c.length; i++) s += custoPar(c[i], c[i + 1], q(g.notas[i + 1].m) - q(g.notas[i].m)) * 0.8;
      return s;
    };
    let ant = grupos[0].cands.map(c => ({ custo: interno(grupos[0], c), de: -1 }));
    const tabela = [ant];
    for (let i = 1; i < grupos.length; i++) {
      const gp = grupos[i - 1], g = grupos[i];
      const pausa = g.t - gp.fim >= 1.5; // pausa longa: a mão pode se reposicionar à vontade
      const atual = g.cands.map(c => {
        const base = interno(g, c);
        let melhor = Infinity, de = 0;
        gp.cands.forEach((cp, j) => {
          let t = ant[j].custo + base;
          if (!pausa) {
            // transição entre as notas mais próximas do polegar (âncora da posição) e entre as mais externas
            t += custoPar(cp[0], c[0], q(g.notas[0].m) - q(gp.notas[0].m));
            if (c.length > 1 || cp.length > 1) t += 0.15 * custoPar(cp[cp.length - 1], c[c.length - 1], q(g.notas[g.notas.length - 1].m) - q(gp.notas[gp.notas.length - 1].m));
          }
          if (t < melhor) { melhor = t; de = j; }
        });
        return { custo: melhor, de };
      });
      tabela.push(atual); ant = atual;
    }
    let j = ant.reduce((mi, x, i) => (x.custo < ant[mi].custo ? i : mi), 0);
    for (let i = grupos.length - 1; i >= 0; i--) {
      const c = grupos[i].cands[j];
      grupos[i].notas.forEach((n, k) => { n.f = k < c.length ? c[k] : null; });
      j = tabela[i][j].de;
    }
    return notas;
  }

  /* ------------------------------------------------------------ músicas (MIDI importado pelo aluno) */
  const FAMILIAS_GM = ['Piano', 'Percussão melódica', 'Órgão', 'Violão/guitarra', 'Baixo', 'Cordas', 'Cordas', 'Metais', 'Palhetas', 'Flautas', 'Sintetizador', 'Sintetizador', 'Efeitos', 'Étnico', 'Percussão', 'Efeitos'];
  const NOMES_BEMOL = ['Dó', 'Ré♭', 'Ré', 'Mi♭', 'Mi', 'Fá', 'Sol♭', 'Sol', 'Lá♭', 'Lá', 'Si♭', 'Si'];
  const novoId = () => 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const musicasVisiveis = () => estado.musicas.filter(m => !m.removida);
  const acharMusica = id => estado.musicas.find(m => m.id === id && !m.removida);

  function lerMidi(buf, nomeArquivo) {
    const d = new DataView(buf), tam = buf.byteLength;
    let p = 0;
    const txt = (ini, n) => { let s = ''; for (let i = 0; i < n && ini + i < tam; i++) s += String.fromCharCode(d.getUint8(ini + i)); return s; };
    if (tam < 14 || txt(0, 4) !== 'MThd') throw new Error('nao-midi');
    const hlen = d.getUint32(4), formato = d.getUint16(8), ntr = d.getUint16(10), div = d.getUint16(12);
    if (div & 0x8000) throw new Error('smpte');
    p = 8 + hlen;
    const dec = bytes => { try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { return new TextDecoder('latin1').decode(bytes); } };
    const fontes = new Map(), tempos = [];
    let num = null, den = null, tom = null, tituloTrilha0 = '', ultimoTick = 0;
    for (let t = 0; t < ntr && p + 8 <= tam; t++) {
      const id = txt(p, 4), len = d.getUint32(p + 4);
      p += 8;
      const fim = Math.min(p + len, tam);
      if (id !== 'MTrk') { p = fim; continue; }
      let tick = 0, status = 0, nomeTrilha = '';
      const abertas = new Map(), programa = {};
      const vlq = () => { let v = 0, b; do { b = d.getUint8(p++); v = (v * 128) + (b & 0x7f); } while ((b & 0x80) && p < fim); return v; };
      const chaveFonte = ch => (formato === 0 ? 0 : t) + ':' + ch;
      const fonte = ch => {
        const k = chaveFonte(ch);
        if (!fontes.has(k)) fontes.set(k, { chave: k, trilha: formato === 0 ? 0 : t, canal: ch, nome: '', programa: null, notas: [] });
        return fontes.get(k);
      };
      while (p < fim) {
        tick += vlq();
        if (p >= fim) break;
        let b = d.getUint8(p);
        if (b < 0x80) { if (!status) { p++; continue; } b = status; } else { p++; if (b < 0xF0) status = b; }
        if (b === 0xFF) {
          const tipo = d.getUint8(p++); const l = vlq(); const ini = p;
          if (tipo === 0x03) nomeTrilha = dec(new Uint8Array(buf, ini, Math.min(l, fim - ini))).trim();
          else if (tipo === 0x51 && l >= 3) tempos.push({ tick, bpm: 60000000 / ((d.getUint8(ini) << 16) | (d.getUint8(ini + 1) << 8) | d.getUint8(ini + 2)) });
          else if (tipo === 0x58 && l >= 2 && num == null) { num = d.getUint8(ini); den = 2 ** d.getUint8(ini + 1); }
          else if (tipo === 0x59 && l >= 1 && tom == null) tom = d.getInt8(ini);
          p = ini + l; continue;
        }
        if (b === 0xF0 || b === 0xF7) { const l = vlq(); p += l; status = 0; continue; }
        const cmd = b & 0xF0, ch = b & 0x0F;
        const a1 = d.getUint8(p++);
        const a2 = (cmd === 0xC0 || cmd === 0xD0) ? 0 : d.getUint8(p++);
        if (cmd === 0x90 && a2 > 0) {
          const k = ch * 128 + a1;
          if (!abertas.has(k)) abertas.set(k, []);
          abertas.get(k).push({ tick, vel: a2 });
        } else if (cmd === 0x80 || (cmd === 0x90 && a2 === 0)) {
          const pilha = abertas.get(ch * 128 + a1);
          if (pilha && pilha.length) { const o = pilha.shift(); fonte(ch).notas.push([o.tick, Math.max(1, tick - o.tick), a1, o.vel]); }
        } else if (cmd === 0xC0 && programa[ch] == null) programa[ch] = a1;
      }
      for (const [k, pilha] of abertas) for (const o of pilha) fonte(Math.floor(k / 128)).notas.push([o.tick, Math.max(1, tick - o.tick), k % 128, o.vel]);
      ultimoTick = Math.max(ultimoTick, tick);
      for (const f of fontes.values()) {
        if (f.trilha !== (formato === 0 ? 0 : t)) continue;
        if (formato !== 0 && !f.nome) f.nome = nomeTrilha;
        if (f.programa == null && programa[f.canal] != null) f.programa = programa[f.canal];
      }
      if (t === 0) tituloTrilha0 = nomeTrilha;
      p = fim;
    }
    // andamento: média ponderada pela duração de cada trecho
    tempos.sort((a, b) => a.tick - b.tick);
    let bpm = 120;
    if (tempos.length === 1) bpm = tempos[0].bpm;
    else if (tempos.length > 1) {
      let soma = 0, peso = 0;
      tempos.forEach((tp, i) => { const ate = i + 1 < tempos.length ? tempos[i + 1].tick : Math.max(ultimoTick, tp.tick + 1); const w = Math.max(0, ate - tp.tick); soma += tp.bpm * w; peso += w; });
      bpm = peso ? soma / peso : tempos[0].bpm;
    }
    const lista = [...fontes.values()].filter(f => f.notas.length && f.canal !== 9);
    lista.forEach(f => f.notas.sort((a, b) => a[0] - b[0] || a[2] - b[2]));
    if (!lista.length) throw new Error('sem-notas');
    const limpo = s => s && !/^(untitled|sem título|track ?\d*)$/i.test(s) ? s : '';
    const doArquivo = (nomeArquivo || '').replace(/\.(mid|midi)$/i, '').replace(/[-_]+/g, ' ').trim();
    return {
      div, bpm: Math.round(bpm * 10) / 10, num: num || 4, den: den || 4, tom: tom ?? 0,
      titulo: (formato === 0 ? limpo(tituloTrilha0) : limpo(tituloTrilha0)) || doArquivo || 'Música',
      fontes: lista.map(({ chave, nome, canal, programa, notas }) => ({ chave, nome, canal, programa, notas }))
    };
  }

  function rotuloFonte(f) {
    const inst = f.programa == null ? 'Piano' : FAMILIAS_GM[f.programa >> 3];
    const lo = Math.min(...f.notas.map(n => n[2])), hi = Math.max(...f.notas.map(n => n[2]));
    return `${f.nome ? f.nome + ' · ' : ''}${inst}, canal ${f.canal + 1} · ${f.notas.length} notas · ${nomeMidi(lo)}–${nomeMidi(hi)}`;
  }
  function opcoesFontes(midi) {
    const ops = [{ v: '', t: 'Nenhuma' }];
    midi.fontes.forEach(f => {
      ops.push({ v: f.chave, t: rotuloFonte(f) });
      const alto = f.notas.filter(n => n[2] >= 60).length;
      if (alto && alto < f.notas.length) {
        ops.push({ v: f.chave + '|alto', t: `${rotuloFonte(f).split(' · ')[0]} — só do Dó central para cima` });
        ops.push({ v: f.chave + '|baixo', t: `${rotuloFonte(f).split(' · ')[0]} — só abaixo do Dó central` });
      }
    });
    return ops;
  }
  function configPadrao(midi) {
    const base = { nivel: 'simples', tamanho: 4 };
    const media = f => f.notas.reduce((a, n) => a + n[2], 0) / f.notas.length;
    const pianos = midi.fontes.filter(f => (f.programa ?? 0) < 8).sort((a, b) => b.notas.length - a.notas.length);
    const altos = f => f.notas.filter(n => n[2] >= 60).length;
    // um piano que sozinho cobre as duas mãos: divide no Dó central
    for (const f of pianos) if (f.notas.length >= 24 && altos(f) >= 8 && f.notas.length - altos(f) >= 8 && !(pianos.length > 1 && pianos.some(g => g !== f && media(g) < 60 && media(f) >= 60))) return { ...base, md: f.chave + '|alto', me: f.chave + '|baixo' };
    // piano em duas trilhas (uma por mão)
    const pAlto = pianos.find(f => media(f) >= 60 && f.notas.length >= 8), pBaixo = pianos.find(f => media(f) < 60 && f.notas.length >= 8);
    if (pAlto && pBaixo) return { ...base, md: pAlto.chave, me: pBaixo.chave };
    const uteis = midi.fontes.filter(f => f.notas.length >= 8).sort((a, b) => media(b) - media(a));
    if (!uteis.length) return { ...base, md: midi.fontes[0].chave, me: '' };
    if (uteis.length === 1) return media(uteis[0]) >= 60 ? { ...base, md: uteis[0].chave, me: '' } : { ...base, md: '', me: uteis[0].chave };
    return { ...base, md: uteis[0].chave, me: uteis[uteis.length - 1].chave };
  }

  function quantizar(tick, div) {
    let melhor = tick, dist = Infinity;
    for (const g of [div / 4, div / 3, div / 6]) { const q = Math.round(tick / g) * g; const dd = Math.abs(q - tick); if (dd < dist - 1e-9) { dist = dd; melhor = q; } }
    return melhor;
  }
  function notasDaMao(musica, sel, h) {
    if (!sel) return [];
    const { midi, config } = musica;
    const [chave, corte] = sel.split('|');
    const f = midi.fontes.find(x => x.chave === chave);
    if (!f) return [];
    const div = midi.div;
    let ns = f.notas.filter(n => !corte || (corte === 'alto' ? n[2] >= 60 : n[2] < 60)).map(n => {
      const ini = quantizar(n[0], div);
      return { ini, fim: Math.max(ini + div / 6, quantizar(n[0] + n[1], div)), m: n[2], vel: n[3] };
    });
    const vistos = new Set();
    ns = ns.filter(n => { const k = n.ini + ':' + n.m; if (vistos.has(k)) return false; vistos.add(k); return true; });
    ns.sort((a, b) => a.ini - b.ini || a.m - b.m);
    if (config.nivel === 'simples') {
      const porIni = new Map();
      ns.forEach(n => { const g = porIni.get(n.ini); if (!g || (h === 'D' ? n.m > g.m : n.m < g.m)) porIni.set(n.ini, n); });
      ns = [...porIni.values()].sort((a, b) => a.ini - b.ini);
      for (let i = 0; i < ns.length - 1; i++) if (ns[i].fim > ns[i + 1].ini) ns[i].fim = ns[i + 1].ini;
    }
    const nomes = (midi.tom ?? 0) < 0 ? NOMES_BEMOL : NOMES;
    return ns.map(n => ({ t: +(n.ini / div).toFixed(4), d: +Math.max(0.1, (n.fim - n.ini) / div).toFixed(4), m: n.m, f: null, h, v: +(n.vel / 127).toFixed(3), a: 'leg', n: nomes[n.m % 12] }));
  }
  function hashCurto(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

  const cachePlanos = new Map();
  function planoMusica(musica) {
    const chaveCache = musica.id + '|' + musica.atualizado_em;
    if (cachePlanos.has(chaveCache)) return cachePlanos.get(chaveCache);
    const { midi, config } = musica;
    const cb = midi.num * 4 / midi.den;
    const md = dedilhar(notasDaMao(musica, config.md, 'D'), 'D'), me = dedilhar(notasDaMao(musica, config.me, 'E'), 'E');
    const todas = md.concat(me);
    const plano = { cb, md, me, sig: hashCurto(['v2', config.md, config.me, config.nivel, config.tamanho].join('/')), partes: [], etapas: [], compassos: 0 };
    if (todas.length) {
      const c0 = Math.floor(Math.min(...todas.map(n => n.t)) / cb + 1e-6);
      const c1 = Math.floor(Math.max(...todas.map(n => n.t)) / cb + 1e-6);
      plano.compassos = c1 - c0 + 1;
      // partes com notas suficientes para treinar: junta compassos até ter pelo menos MIN notas (até 3× o tamanho)
      const conta = (lista, ini, fim) => lista.filter(n => n.t >= ini * cb - 1e-6 && n.t < fim * cb - 1e-6).length;
      const MIN = 12, MAXB = config.tamanho * 3;
      for (let c = c0, k = 1; c <= c1; k++) {
        let fim = Math.min(c + config.tamanho, c1 + 1);
        while (fim <= c1 && fim - c < MAXB && conta(md, c, fim) + conta(me, c, fim) < MIN) fim++;
        const nD = conta(md, c, fim), nE = conta(me, c, fim);
        plano.partes.push({ k, ini: c, fim, D: nD > 0, E: nE > 0, nD, nE });
        c = fim;
      }
      // última parte magra: funde com a anterior
      if (plano.partes.length > 1) {
        const u = plano.partes[plano.partes.length - 1], a = plano.partes[plano.partes.length - 2];
        if (u.nD + u.nE < MIN) { a.fim = u.fim; a.nD += u.nD; a.nE += u.nE; a.D = a.nD > 0; a.E = a.nE > 0; plano.partes.pop(); }
      }
      const P = plano.partes;
      const add = (chave, titulo, tipo, de, ate, grupo) => plano.etapas.push({ chave, titulo, tipo, de, ate, grupo });
      P.forEach((pt, i) => {
        const nome = `Parte ${pt.k}`;
        const comp = `compassos ${pt.ini + 1}–${pt.fim}`;
        const MIN_MAO = 8; // uma mão com menos de 8 notas na parte só treina junto com a outra
        if (!pt.D && !pt.E) return;
        if (pt.D && pt.E) {
          if (pt.nD >= MIN_MAO) add(`p${pt.k}-D`, `${nome}, mão direita (${comp})`, 'D', i, i, 'mao');
          if (pt.nE >= MIN_MAO) add(`p${pt.k}-E`, `${nome}, mão esquerda (${comp})`, 'E', i, i, 'mao');
          add(`p${pt.k}-DE`, `${nome}, mãos juntas (${comp})`, 'DE', i, i, 'juntas');
        } else add(`p${pt.k}`, `${nome}, ${pt.D ? 'mão direita' : 'mão esquerda'} (${comp})`, pt.D ? 'D' : 'E', i, i, 'mao');
        if (i > 0) add(`p${P[i - 1].k}-${pt.k}`, `Ligar partes ${P[i - 1].k} e ${pt.k}`, 'DE', i - 1, i, 'ligar');
        if (P.length > 4 && i >= 3 && (i + 1) % 4 === 0) add(`b${P[i - 3].k}-${pt.k}`, `Bloco: partes ${P[i - 3].k} a ${pt.k}`, 'DE', i - 3, i, 'bloco');
      });
      if (P.length > 1) add('inteira', 'Música inteira', 'DE', 0, P.length - 1, 'inteira');
      add('final', 'Música inteira no tempo original', 'DE', 0, P.length - 1, 'final');
      plano.etapas.forEach((e, n) => { e.n = n + 1; e.id = `m:${musica.id}:${plano.sig}:${e.chave}`; });
    }
    cachePlanos.set(chaveCache, plano);
    return plano;
  }
  function aulaDaEtapa(musica, plano, e) {
    const cb = plano.cb, P = plano.partes;
    const ini = P[e.de].ini * cb, fim = P[e.ate].fim * cb;
    const fonte = e.tipo === 'D' ? plano.md : e.tipo === 'E' ? plano.me : plano.md.concat(plano.me);
    const notas = fonte.filter(n => n.t >= ini - 1e-6 && n.t < fim - 1e-6)
      .map(n => ({ ...n, t: +(n.t - ini).toFixed(4), d: +Math.min(n.d, fim - n.t).toFixed(4) }));
    const secoes = e.ate > e.de ? P.slice(e.de, e.ate + 1).map(pt => ({ t: +(pt.ini * cb - ini).toFixed(4), rotulo: `Parte ${pt.k}` })) : [];
    const bpm = Math.max(20, Math.round(musica.midi.bpm));
    const final = e.chave === 'final';
    return {
      id: e.id, titulo: e.titulo, tipo: 'pratica', bpm, compasso: Math.max(1, Math.round(cb)), maos: e.tipo, notas, secoes, metro: { num: musica.midi.num, den: musica.midi.den }, tom: musica.midi.tom,
      metricas: ['tempo', 'forca'], chaveTempo: 'tempoMusica',
      passa: final ? { acertos: 90, regularidade: 75, bpm: Math.round(bpm * 0.95) } : { acertos: 90, regularidade: 70 },
      criterio: final ? `Notas certas ≥ 90% e regularidade ≥ 75%, a ♩ = ${Math.round(bpm * 0.95)} ou mais.` : 'Notas certas ≥ 90% e regularidade ≥ 70%, no tempo que for confortável.',
      textoPassou: final ? 'Música concluída no tempo original. Parabéns!' : 'Etapa concluída. Pode seguir para a próxima.'
    };
  }
  function dicaEtapa(e, bpm) {
    return {
      mao: e.tipo === 'D' ? 'Só a mão direita. Comece devagar e só acelere quando a regularidade passar de 80%.'
        : 'Só a mão esquerda. Ela é o chão da música: tempo firme, sem pressa.',
      juntas: 'As duas mãos juntas nesta parte. Se travar, use Direita ou Esquerda no player para separar de novo por alguns minutos.',
      ligar: 'Toque as duas partes em sequência, sem parar na emenda. É na passagem de uma para a outra que a música costuma quebrar.',
      bloco: 'Quatro partes seguidas, para ganhar fôlego. Se errar no meio, continue: o objetivo é não parar.',
      inteira: 'A música inteira, no tempo que for confortável.',
      final: `A música inteira no tempo original (♩ = ${bpm}). Suba o tempo aos poucos: 70%, 80%, 90%, 100%.`
    }[e.grupo];
  }
  function progressoMusica(m) {
    const pl = planoMusica(m);
    const feitas = pl.etapas.filter(e => statusAula(e.id) === 'ok').length;
    const prox = pl.etapas.find(e => statusAula(e.id) !== 'ok') || pl.etapas[pl.etapas.length - 1];
    return { pl, feitas, total: pl.etapas.length, prox };
  }
  rotuloAula = id => {
    if (id === 'ouvir') return 'Ouvir e cantar';
    if (!id.startsWith('m:')) return 'aula ' + idTexto(id);
    const [, mid] = id.split(':');
    const m = estado.musicas.find(x => x.id === mid);
    if (!m) return 'música removida';
    const e = planoMusica(m).etapas.find(x => x.id === id);
    return `${m.titulo} · ${e ? e.titulo : 'etapa de uma divisão anterior'}`;
  };

  const musicaDaPeca = pecaId => estado.musicas.find(m => m.biblioteca === pecaId && !m.removida);
  async function abrirPeca(peca) {
    let m = musicaDaPeca(peca.id); if (m) return m;
    const idFixo = 'b' + peca.id.replace(/[^a-z0-9]/gi, '');
    const antiga = estado.musicas.find(x => x.id === idFixo);
    if (antiga) { antiga.removida = false; antiga.biblioteca = peca.id; salvarMusica(antiga); return antiga; }
    const resp = await fetch('repertorio/' + peca.arquivo, { cache: 'force-cache' });
    if (!resp.ok) throw new Error('arquivo ' + resp.status);
    const midi = lerMidi(await resp.arrayBuffer(), peca.arquivo);
    if (peca.bpm) midi.bpm = peca.bpm;
    const config = Object.assign(configPadrao(midi), peca.config || {});
    m = { id: idFixo, titulo: peca.titulo, criada: new Date().toISOString(), atualizado_em: '', removida: false, biblioteca: peca.id, midi, config };
    salvarMusica(m);
    return m;
  }
  function bibliotecaHTML() {
    const lista = C.biblioteca || [];
    if (!lista.length) return '';
    const niveis = [...new Set(lista.map(p => p.nivel))].sort((a, b) => a - b);
    return `<div style="display:grid;gap:14px">
      <div class="aula-cab"><span class="rotulo">Biblioteca do curso</span><h2>Peças de domínio público, já prontas para estudar</h2>
        <p class="texto suave">Cada peça vem com o MIDI e o plano de estudo. Elas aparecem também nos módulos, na ordem em que Chopin as dava aos alunos.</p></div>
      ${niveis.map(n => `<div style="display:grid;gap:8px"><span class="rotulo">${esc((C.niveis || []).find(x => x.n === n)?.titulo ? `Nível ${n} · ${(C.niveis || []).find(x => x.n === n).titulo}` : `Nível ${n}`)}</span>
        <div class="biblioteca">${lista.filter(p => p.nivel === n).map(p => {
          const m = musicaDaPeca(p.id); const pr = m ? progressoMusica(m) : null;
          return `<article class="peca-card">
            <div><span class="rotulo">${esc(p.compositor)}</span><h3>${esc(p.titulo)}</h3><p class="aviso">${esc(p.descricao || '')}</p></div>
            ${pr ? `<div class="barra-prog" aria-hidden="true"><div style="width:${pr.total ? Math.round(100 * pr.feitas / pr.total) : 0}%"></div></div><p class="aviso">${pr.feitas} de ${pr.total} etapas</p>` : ''}
            <div class="linha-botoes"><button class="btn ${m ? '' : 'primario'}" type="button" data-peca="${esc(p.id)}">${m ? 'Continuar' : 'Estudar'}</button>${p.aula ? `<a class="btn" href="#aula-${esc(p.aula)}">Guia da aula ${idTexto(p.aula)}</a>` : ''}</div>
          </article>`;
        }).join('')}</div></div>`).join('')}
    </div>`;
  }
  function ligarBiblioteca(el, msg) {
    el.addEventListener('click', async e => {
      const b = e.target.closest('[data-peca]'); if (!b) return;
      const peca = (C.biblioteca || []).find(p => p.id === b.dataset.peca); if (!peca) return;
      b.disabled = true; if (msg) msg.textContent = 'Carregando a peça…';
      try { const m = await abrirPeca(peca); location.hash = 'musica-' + m.id; }
      catch (err) { if (msg) msg.textContent = 'Não consegui carregar a peça (' + err.message + ').'; b.disabled = false; }
    });
  }

  function salvarMusica(m) {
    m.atualizado_em = new Date().toISOString(); m.sync = false;
    if (!estado.musicas.includes(m)) estado.musicas.push(m);
    salvar(); Nuvem.agendar();
  }

  function formMusica(alvo, m, aoSalvar, aoCancelar) {
    const ops = opcoesFontes(m.midi);
    const sel = (id, atual) => `<select id="${id}" class="entrada">${ops.map(o => `<option value="${esc(o.v)}" ${o.v === atual ? 'selected' : ''}>${esc(o.t)}</option>`).join('')}</select>`;
    const c = m.config;
    alvo.innerHTML = `<form class="form-musica" id="form-musica">
      <div class="grade">
        <label class="campo" for="m-titulo">Nome da música <input id="m-titulo" class="entrada" value="${esc(m.titulo)}" required maxlength="80"></label>
        <div class="campo"><span>Original</span><b class="mono" style="color:var(--ink)">♩ = ${Math.round(m.midi.bpm)} · ${m.midi.num}/${m.midi.den}</b></div>
      </div>
      <div class="grade">
        <label class="campo" for="m-md">Mão direita toca ${sel('m-md', c.md)}</label>
        <label class="campo" for="m-me">Mão esquerda toca ${sel('m-me', c.me)}</label>
      </div>
      <div class="grade">
        <div class="campo"><span>Nível</span><div class="seg" role="group" aria-label="Nível">
          <button type="button" data-nivel="simples" aria-pressed="${c.nivel === 'simples'}">Simplificado</button>
          <button type="button" data-nivel="completo" aria-pressed="${c.nivel === 'completo'}">Completo</button></div>
          <span class="aviso">Simplificado: uma nota por vez em cada mão (a de cima na direita, a de baixo na esquerda).</span></div>
        <div class="campo"><span>Tamanho de cada parte</span><div class="seg" role="group" aria-label="Tamanho da parte">
          ${[2, 4, 8].map(n => `<button type="button" data-tamanho="${n}" aria-pressed="${c.tamanho === n}">${n} compassos</button>`).join('')}</div></div>
      </div>
      <p class="aviso" id="m-resumo"></p>
      <div class="linha-botoes"><button class="btn primario" type="submit">${aoCancelar ? 'Salvar ajustes' : 'Criar plano de estudo'}</button>
        <button class="btn" type="button" id="m-cancelar">Cancelar</button></div>
    </form>`;
    const rascunho = () => ({ ...m, id: m.id || 'rascunho', atualizado_em: 'r' + Math.random(), config: { md: $('#m-md').value, me: $('#m-me').value, nivel: $('[data-nivel][aria-pressed="true"]').dataset.nivel, tamanho: +$('[data-tamanho][aria-pressed="true"]').dataset.tamanho } });
    const resumo = () => {
      const r = rascunho(); const pl = planoMusica(r); cachePlanos.clear();
      $('#m-resumo').textContent = !r.config.md && !r.config.me ? 'Escolha o que cada mão vai tocar.'
        : `${pl.compassos} compassos com notas · ${pl.partes.length} parte${pl.partes.length === 1 ? '' : 's'} · ${pl.etapas.length} etapas de estudo`;
    };
    alvo.addEventListener('click', e => {
      const b = e.target.closest('button[data-nivel],button[data-tamanho]'); if (!b) return;
      const attr = b.dataset.nivel ? 'data-nivel' : 'data-tamanho';
      $$(`[${attr}]`, alvo).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      resumo();
    });
    $('#m-md').addEventListener('change', resumo); $('#m-me').addEventListener('change', resumo);
    $('#m-cancelar').addEventListener('click', () => { alvo.innerHTML = ''; if (aoCancelar) aoCancelar(); });
    $('#form-musica').addEventListener('submit', ev => {
      ev.preventDefault();
      const r = rascunho();
      if (!r.config.md && !r.config.me) { $('#m-resumo').textContent = 'Escolha o que cada mão vai tocar.'; return; }
      m.titulo = $('#m-titulo').value.trim() || m.titulo; m.config = r.config;
      cachePlanos.clear();
      aoSalvar(m);
    });
    resumo();
  }

  function renderMusicas() {
    const el = $('#vista-musicas');
    const lista = musicasVisiveis();
    el.innerHTML = `<div style="display:grid;gap:28px">
      <div class="aula-cab"><span class="rotulo">Repertório</span><h1>Músicas</h1>
        <p class="texto suave">Escolha uma peça da biblioteca ou importe o arquivo MIDI de uma música. O site divide em partes e monta o caminho: cada parte com uma mão de cada vez, depois juntas, depois ligada à anterior, até a música inteira no tempo original.</p></div>
      <div class="importar">
        <div class="linha-botoes">
          <label class="btn primario" for="arquivo-midi">Importar arquivo MIDI</label>
          <input type="file" id="arquivo-midi" class="oculto">
          <span class="aviso">O arquivo fica neste aparelho e na sua conta. Não vai para o site público.</span>
        </div>
        <p class="aviso" id="import-msg" aria-live="polite"></p>
        <div id="config-musica"></div>
      </div>
      ${bibliotecaHTML()}
      ${lista.length ? `<div class="aula-cab"><span class="rotulo">Em estudo</span><h2>Suas músicas</h2></div><div class="musicas">${lista.map(m => {
        const { feitas, total, prox, pl } = progressoMusica(m);
        const min = Math.round(estado.sessoes.filter(s => s.aula.startsWith('m:' + m.id + ':')).reduce((a, s) => a + (s.minutos || 0), 0));
        return `<article class="musica-card">
          <h3>${esc(m.titulo)}</h3>
          <p class="mono suave" style="font-size:.85rem">♩ = ${Math.round(m.midi.bpm)} · ${pl.compassos} compassos · ${pl.partes.length} partes${min ? ` · ${min} min praticados` : ''}</p>
          <div class="barra-prog" aria-hidden="true"><div style="width:${total ? Math.round(100 * feitas / total) : 0}%"></div></div>
          <p class="aviso">${feitas} de ${total} etapas</p>
          <div class="linha-botoes">
            <a class="btn primario" href="#musica-${esc(m.id)}">${feitas ? 'Continuar' : 'Começar'}${prox ? ': ' + esc(prox.titulo) : ''}</a>
            <button class="btn" type="button" data-remover="${esc(m.id)}">Remover</button>
          </div>
        </article>`;
      }).join('')}</div>` : `<p class="suave">Nenhuma música ainda. Importe um arquivo .mid para começar.${Nuvem.logado ? '' : ' Se você já importou em outro aparelho, entre na sua conta na aba Progresso para trazer as músicas.'}</p>`}
    </div>`;
    const msg = $('#import-msg');
    ligarBiblioteca(el, msg);
    $('#arquivo-midi').addEventListener('change', async ev => {
      const arq = ev.target.files && ev.target.files[0]; if (!arq) return;
      msg.textContent = 'Lendo o arquivo…';
      try {
        const midi = lerMidi(await arq.arrayBuffer(), arq.name);
        const m = { id: novoId(), titulo: midi.titulo, criada: new Date().toISOString(), atualizado_em: '', removida: false, midi, config: configPadrao(midi) };
        msg.textContent = `${midi.fontes.length} instrumento${midi.fontes.length === 1 ? '' : 's'} encontrado${midi.fontes.length === 1 ? '' : 's'}. Já sugeri o que cada mão toca; ajuste se quiser.`;
        formMusica($('#config-musica'), m, salva => { salvarMusica(salva); location.hash = 'musica-' + salva.id; });
      } catch (e) {
        msg.textContent = { 'nao-midi': 'Esse arquivo não é um MIDI (.mid). Escolha outro.', smpte: 'Esse MIDI usa um formato de tempo de vídeo (SMPTE) que o curso não lê. Tente outra versão do arquivo.', 'sem-notas': 'Não encontrei notas de piano nesse arquivo (só bateria ou nada).' }[e.message] || 'Não consegui ler esse arquivo: ' + e.message;
      }
      ev.target.value = '';
    });
    const grade = $('.musicas', el);
    if (grade) grade.addEventListener('click', e => {
      const b = e.target.closest('[data-remover]'); if (!b) return;
      if (b.dataset.confirmar !== 'sim') { b.dataset.confirmar = 'sim'; b.textContent = 'Confirmar remoção'; b.classList.add('perigo'); setTimeout(() => { if (b.isConnected) { b.dataset.confirmar = ''; b.textContent = 'Remover'; b.classList.remove('perigo'); } }, 4000); return; }
      const m = acharMusica(b.dataset.remover); if (!m) return;
      m.removida = true; salvarMusica(m); renderMusicas();
    });
  }

  const etapaEscolhida = new Map();
  function renderMusica(id) {
    const el = $('#vista-musicas');
    const m = acharMusica(id);
    if (!m) { el.innerHTML = `<div style="display:grid;gap:16px"><h1>Música não encontrada</h1><p class="suave">Ela pode ter sido removida, ou ainda não chegou da nuvem neste aparelho.</p><a class="btn" href="#musicas">Ver suas músicas</a></div>`; return; }
    const { pl, feitas, total, prox } = progressoMusica(m);
    if (!pl.etapas.length) { el.innerHTML = `<div style="display:grid;gap:16px"><h1>${esc(m.titulo)}</h1><p class="suave">Nenhuma nota nas mãos escolhidas.</p><button class="btn" id="ajustar">Ajustar mãos e partes</button><div id="config-musica"></div></div>`; $('#ajustar').onclick = () => formMusica($('#config-musica'), m, s => { salvarMusica(s); renderMusica(id); }, () => {}); return; }
    const n = etapaEscolhida.get(id) || prox.n;
    const e = pl.etapas.find(x => x.n === n) || prox;
    const a = aulaDaEtapa(m, pl, e);
    const status = x => statusAula(x.id);
    el.innerHTML = `<div style="display:grid;gap:22px">
      <div class="aula-cab"><span class="rotulo">Música</span><h1>${esc(m.titulo)}</h1>
        <div class="meta"><span>♩ = ${Math.round(m.midi.bpm)}</span><span>${m.midi.num}/${m.midi.den}</span><span>${pl.compassos} compassos</span><span>${pl.partes.length} partes de ${m.config.tamanho}</span><span>${m.config.nivel === 'simples' ? 'simplificado' : 'completo'}</span></div>
        <div class="linha-botoes"><button class="btn" type="button" id="ajustar">Ajustar mãos e partes</button><a class="btn" href="#musicas">Todas as músicas</a></div>
      </div>
      <div id="config-musica"></div>
      <div class="plano-estudo">
        <div class="plano-cab"><span class="rotulo">Plano de estudo</span><span class="mono suave">${feitas} de ${total} etapas</span></div>
        <div class="barra-prog" aria-hidden="true"><div style="width:${Math.round(100 * feitas / total)}%"></div></div>
        <ol class="etapas" id="etapas">${pl.etapas.map(x => `<li><button type="button" class="etapa" data-etapa="${x.n}" ${x.n === e.n ? 'aria-current="step"' : ''}>
          <span class="n">${x.n}</span><span class="t">${esc(x.titulo)}</span>${status(x) === 'ok' ? '<span class="chip ok">passou</span>' : status(x) === 'andamento' ? '<span class="chip andamento">praticando</span>' : x.n === prox.n ? '<span class="chip">próxima</span>' : ''}</button></li>`).join('')}</ol>
      </div>
      <div class="aula-cab"><span class="rotulo">Etapa ${e.n} de ${total}</span><h2>${esc(e.titulo)}</h2><p class="texto suave">${esc(dicaEtapa(e, a.bpm))} O tempo começa em ${Math.round((estado.prefs.tempoMusica ?? 0.6) * 100)}% do original; ajuste no controle Tempo.</p>
        <p class="aviso">Os números nas notas são uma sugestão de dedilhado calculada pelo site, seguindo Chopin: dedos longos nas teclas pretas, polegar nas brancas. Se algum dedo não encaixar na sua mão, use o que for mais natural e mantenha sempre o mesmo.</p></div>
      ${htmlPlayer(a)}
      <div id="resultado"></div>
      <div class="criterio"><span class="rotulo">Para passar</span><p>${esc(a.criterio)}</p></div>
      ${historicoAula(a.id)}
    </div>`;
    const atual = $('#etapas [aria-current="step"]');
    if (atual) atual.parentElement.parentElement.scrollTop = Math.max(0, atual.offsetTop - 80);
    $('#etapas').addEventListener('click', ev => {
      const b = ev.target.closest('[data-etapa]'); if (!b) return;
      etapaEscolhida.set(id, +b.dataset.etapa);
      if (playerAtual) { playerAtual.destruir(); playerAtual = null; }
      renderMusica(id);
      const pl2 = $('#player'); if (pl2) pl2.scrollIntoView({ block: 'center' });
    });
    $('#ajustar').addEventListener('click', () => formMusica($('#config-musica'), m, s => { salvarMusica(s); etapaEscolhida.delete(id); if (playerAtual) { playerAtual.destruir(); playerAtual = null; } renderMusica(id); }, () => {}));
    montarPlayer(a, {
      aoResultado: ({ r }) => {
        const seguinte = pl.etapas.find(x => x.n === e.n + 1);
        if (r.passou && !r.parcial && seguinte) {
          const caixa = $('#resultado .resultado');
          const b = document.createElement('button');
          b.className = 'btn primario'; b.type = 'button'; b.textContent = `Próxima etapa: ${seguinte.titulo}`;
          b.addEventListener('click', () => { etapaEscolhida.set(id, seguinte.n); if (playerAtual) { playerAtual.destruir(); playerAtual = null; } renderMusica(id); $('#player').scrollIntoView({ block: 'center' }); });
          caixa.appendChild(b);
        }
      }
    });
  }


  /* ------------------------------------------------------------ jornada do dia (Hoje) */
  const LIMITE_MIN = 45;
  const Jornada = {
    ativa: false,
    get hoje() { const j = estado.jornada; return j && j.dia === hojeStr() ? j : null; },
    garantir() { if (!this.hoje) { estado.jornada = { dia: hojeStr(), passo: 0, feitos: {} }; salvar(); } return estado.jornada; },
    minutosHoje() { return estado.sessoes.filter(s => s.dia === hojeStr() && (!s.aula.startsWith('m:') || s.jornada)).reduce((a, s) => a + (s.minutos || 0), 0); },
    bloqueado() { return this.minutosHoje() >= LIMITE_MIN; },
    ehTecnica(a) { return a.tipo === 'pratica' && [1, 2, 8, 9, 12].includes(a.modulo) && a.id !== '1-1'; },
    ultimaSessao(id) { let t = ''; estado.sessoes.forEach(s => { if (s.aula === id && s.quando > t) t = s.quando; }); return t; },
    plano() {
      const feita = id => statusAula(id) === 'ok';
      const ordem = ORDEM.filter(id => id !== '1-1');
      // 3) exercício ou peça: a próxima aula do curso ainda não concluída
      let exercicio = ordem.find(id => !feita(id)) || ordem[ordem.length - 1];
      // 2) técnica: enquanto o nível 1 não acabou, a próxima aula dele; depois, rodízio das escalas já liberadas
      const nivel1 = ordem.filter(id => AULAS.get(id).modulo <= 2);
      let tecnica = nivel1.find(id => !feita(id));
      if (tecnica && tecnica === exercicio) {
        exercicio = ordem.find(id => !feita(id) && id !== tecnica) || exercicio;
      }
      if (!tecnica) {
        const modAtual = AULAS.get(exercicio).modulo;
        const pool = ORDEM.filter(id => this.ehTecnica(AULAS.get(id)) && AULAS.get(id).modulo <= Math.max(2, modAtual) && id !== exercicio);
        pool.sort((x, y) => this.ultimaSessao(x).localeCompare(this.ultimaSessao(y)) || ORDEM.indexOf(x) - ORDEM.indexOf(y));
        tecnica = pool[0] || '2-1';
      }
      const modEx = C.modulos.find(m => m.n === AULAS.get(exercicio).modulo);
      const passos = [
        { tipo: 'corpo', aula: '1-1', min: 5, titulo: 'Corpo', sub: 'Soltar ombros, braço e pulso' },
        { tipo: 'aula', aula: tecnica, min: 10, titulo: 'Técnica', sub: AULAS.get(tecnica).titulo },
        { tipo: 'aula', aula: exercicio, min: 15, titulo: 'Exercício ou peça', sub: AULAS.get(exercicio).titulo },
        { tipo: 'ouvir', modulo: modEx, min: 5, titulo: 'Ouvir e cantar', sub: modEx && modEx.ouvir ? modEx.ouvir.rotulo : 'A gravação do módulo' },
      ];
      // 5) revisão: a aula em andamento mais recente que ainda não passou (se houver)
      const emAndamento = ORDEM.filter(id => statusAula(id) === 'andamento' && ![tecnica, exercicio, '1-1'].includes(id));
      emAndamento.sort((x, y) => this.ultimaSessao(y).localeCompare(this.ultimaSessao(x)));
      if (emAndamento[0]) passos.push({ tipo: 'aula', aula: emAndamento[0], min: 10, titulo: 'Revisão', sub: AULAS.get(emAndamento[0]).titulo });
      // aulas extras: depois da jornada, enquanto não bater o limite do dia
      const j = this.hoje;
      (j && j.extras || []).forEach(id => { if (AULAS.has(id)) passos.push({ tipo: 'aula', aula: id, min: 10, titulo: 'Extra', sub: AULAS.get(id).titulo }); });
      return passos;
    },
    proximaExtra(plano) {
      const usadas = new Set(plano.map(p => p.aula).filter(Boolean));
      return ORDEM.find(id => id !== '1-1' && !usadas.has(id) && statusAula(id) !== 'ok') || null;
    },
    adicionarExtra(id) { const j = this.garantir(); j.extras = j.extras || []; j.extras.push(id); j.passo = this.plano().length - 1; salvar(); },
    marcar(passo) { const j = this.garantir(); j.feitos[passo] = true; salvar(); },
    feito(passo) { const j = this.hoje; return !!(j && j.feitos[passo]); },
    inicioPasso(passo) { const j = this.garantir(); j.inicios = j.inicios || {}; if (!j.inicios[passo]) { j.inicios[passo] = Date.now(); salvar(); } return j.inicios[passo]; },
    niveisConcluidos() {
      return (C.niveis || []).filter(nv => { const ids = C.aulas.filter(a => C.modulos.some(m => m.n === a.modulo && (m.nivel || 0) === nv.n)).map(a => a.id); return ids.length && ids.every(id => statusAula(id) === 'ok'); }).map(nv => nv.n);
    }
  };
  let cronometro = null;
  function ligarCronometro(passo, minutos, aoCumprir) {
    if (cronometro) clearInterval(cronometro);
    const el = $('#hoje-cron'); if (!el) return;
    const ini = Jornada.inicioPasso(passo);
    let cumpriu = false;
    const tick = () => {
      const s = Math.floor((Date.now() - ini) / 1000), alvo = minutos * 60;
      const mm = String(Math.floor(s / 60)).padStart(2, '0'), ss = String(s % 60).padStart(2, '0');
      el.textContent = `${mm}:${ss} de ${minutos}:00`;
      el.dataset.estado = s >= alvo ? 'ok' : s >= alvo * 0.6 ? 'quase' : '';
      if (s >= alvo && !cumpriu) { cumpriu = true; if (aoCumprir) aoCumprir(); }
    };
    tick(); cronometro = setInterval(tick, 1000);
  }

  function renderHoje() {
    const el = $('#vista-hoje');
    Jornada.ativa = true;
    if (playerAtual) { playerAtual.destruir(); playerAtual = null; }
    const j = Jornada.garantir();
    const plano = Jornada.plano();
    const min = Jornada.minutosHoje();
    const d = new Date();
    const dataTxt = d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
    const barra = `<div class="hoje-cab">
        <span class="rotulo">Hoje · ${esc(dataTxt)}</span>
        <div class="hoje-tempo"><div class="barra-prog" aria-hidden="true"><div style="width:${Math.min(100, Math.round(100 * min / LIMITE_MIN))}%"></div></div><span class="mono">${Math.round(min)} de ${LIMITE_MIN} min</span></div>
        <ol class="passos-dia">${plano.map((p, i) => `<li class="${i === j.passo ? 'atual' : ''} ${Jornada.feito(i) ? 'feito' : ''}"><span class="n">${i + 1}</span><span><b>${esc(p.titulo)}</b><small>${p.min} min</small></span></li>`).join('')}</ol>
      </div>`;
    if (Jornada.bloqueado()) {
      el.innerHTML = `<div style="display:grid;gap:22px">${barra}
        <div class="hoje-fim">
          <h1>Treino de hoje completo.</h1>
          <p class="texto">Você fez ${Math.round(min)} minutos. Chopin não deixava os alunos passarem do ponto: o curso fecha até amanhã. Se quiser continuar ao piano, toque as músicas da sua lista, como treino à parte.</p>
          <div class="linha-botoes"><a class="btn primario" href="#musicas">Tocar músicas</a><a class="btn" href="#progresso">Ver progresso</a></div>
        </div></div>`;
      return;
    }
    if (j.passo >= plano.length) {
      const prox = Jornada.proximaExtra(plano);
      const restam = Math.max(0, Math.round(LIMITE_MIN - min));
      el.innerHTML = `<div style="display:grid;gap:22px">${barra}
        <div class="hoje-fim">
          <h1>${(j.extras || []).length ? 'Etapa extra concluída.' : 'Jornada de hoje concluída.'}</h1>
          <p class="texto">${Math.round(min)} minutos feitos. Ainda cabem ${restam} minutos no limite de hoje${prox ? ': o curso segue com a próxima aula' : ''}.</p>
          <div class="linha-botoes">
            ${prox ? `<button class="btn primario" type="button" id="hoje-proxima">Próxima aula: ${idTexto(prox)} ${esc(AULAS.get(prox).titulo)} → ${Fluxo.ligado() ? '<span class="mono" id="hoje-proxima-seg">8</span>' : ''}</button>` : ''}
            ${plano.map((p, i) => `<button class="btn" type="button" data-repetir="${i}">Repetir ${esc(p.titulo.toLowerCase())}</button>`).join('')}
            <a class="btn" href="#musicas">Tocar músicas</a>
          </div>
        </div></div>`;
      el.querySelectorAll('[data-repetir]').forEach(b => b.addEventListener('click', () => { if (cronometro) clearInterval(cronometro); j.passo = +b.dataset.repetir; j.feitos[j.passo] = false; salvar(); renderHoje(); }));
      const bp = $('#hoje-proxima');
      if (bp) {
        const seguir = () => { if (cronometro) clearInterval(cronometro); Jornada.adicionarExtra(prox); renderHoje(); window.scrollTo(0, 0); };
        bp.addEventListener('click', seguir);
        if (Fluxo.ligado()) { let n = 8; if (cronometro) clearInterval(cronometro); cronometro = setInterval(() => { n--; const sp = $('#hoje-proxima-seg'); if (sp) sp.textContent = n; if (n <= 0) seguir(); }, 1000); }
      }
      return;
    }
    const novoNivel = Jornada.niveisConcluidos().find(n => !estado.niveisVistos.includes(n));
    if (novoNivel) {
      const nv = C.niveis.find(x => x.n === novoNivel);
      el.innerHTML = `<div style="display:grid;gap:22px">${barra}
        <div class="hoje-fim nivel-fim">
          <span class="rotulo">Marco</span>
          <h1>Nível ${nv.n} concluído: ${esc(nv.titulo.split(':')[0])}.</h1>
          <p class="texto">${esc(nv.meta || '')}</p>
          ${nv.narracao ? blocoNarracao('nivel-' + nv.n, 'Uma palavra sobre o que você conquistou', nv.narracao) : ''}
          <div class="linha-botoes"><button class="btn primario" type="button" id="nivel-ok">Continuar para o nível ${nv.n + 1 <= 5 ? nv.n + 1 : nv.n} →</button></div>
        </div></div>`;
      $('#nivel-ok').addEventListener('click', () => { estado.niveisVistos.push(novoNivel); salvar(); renderHoje(); });
      return;
    }
    const p = plano[j.passo];
    const rodape = (podeContinuar, textoRepetir) => `<div class="hoje-rodape">
        <span class="aviso" id="hoje-aviso"><span class="cron mono" id="hoje-cron"></span> ${podeContinuar ? 'Etapa feita. Pode seguir.' : 'Faça a etapa; o botão Continuar libera quando ela terminar ou quando o tempo dela se cumprir.'}</span>
        <div class="linha-botoes">${textoRepetir ? `<button class="btn" type="button" id="hoje-repetir">${esc(textoRepetir)}</button>` : ''}
          <button class="btn primario" type="button" id="hoje-continuar" ${podeContinuar ? '' : 'disabled'}>${j.passo + 1 < plano.length ? 'Continuar →' : 'Concluir o dia'}</button></div>
      </div>`;
    const cabPasso = `<div class="aula-cab"><span class="rotulo">Etapa ${j.passo + 1} de ${plano.length} · ${esc(p.titulo)} · ${p.min} min</span><h1>${esc(p.sub)}</h1></div>`;
    const liberar = () => { Jornada.marcar(j.passo); const b = $('#hoje-continuar'); if (b) b.disabled = false; const av = $('#hoje-aviso'); if (av) av.textContent = 'Etapa feita. Pode seguir.'; };
    const ligarRodape = () => {
      $('#hoje-continuar').addEventListener('click', () => { if (cronometro) clearInterval(cronometro); if (playerAtual) { playerAtual.destruir(); playerAtual = null; } j.passo++; salvar(); renderHoje(); window.scrollTo(0, 0); });
      ligarCronometro(j.passo, p.min, () => liberar());
    };

    if (p.tipo === 'corpo' || (p.tipo === 'aula' && AULAS.get(p.aula).tipo === 'guia')) {
      const a = AULAS.get(p.aula);
      const feito = Jornada.feito(j.passo);
      el.innerHTML = `<div style="display:grid;gap:22px">${barra}${cabPasso}
        ${blocoNarracao('aula-' + a.id, 'Explicação', a.narracao)}
        ${figurasHTML(a)}
        <div class="guia"><ol>${a.passos.map(x => `<li><span>${esc(x)}</span></li>`).join('')}</ol></div>
        <div class="linha-botoes"><button class="btn primario" type="button" id="hoje-fiz" ${feito ? 'disabled' : ''}>${feito ? 'Feito' : (p.tipo === 'corpo' ? 'Fiz a rotina de corpo' : 'Fiz esta etapa')}</button></div>
        ${rodape(feito, null)}</div>`;
      $('#hoje-fiz').addEventListener('click', () => {
        registrarSessao({ quando: new Date().toISOString(), dia: hojeStr(), aula: a.id, minutos: p.min, completa: true });
        if (a.tipo === 'guia') { const dias = new Set(estado.sessoes.filter(s => s.aula === a.id).map(s => s.dia)); if (dias.size >= 3) { estado.status[a.id] = { concluida: hojeStr() }; salvar(); } }
        $('#hoje-fiz').disabled = true; $('#hoje-fiz').textContent = 'Feito'; liberar(); renderHoje();
      });
      ligarRodape();
      if (!feito) { fluxoEtapaSimples('aula-' + a.id, a.narracao, p.min); ligarCronometro(j.passo, p.min, () => { const b = $('#hoje-fiz'); if (b && !b.disabled && Fluxo.ligado()) b.click(); }); }
      else if (Fluxo.ligado()) { const b = $('#hoje-continuar'); if (b) setTimeout(() => b.click(), 1500); }
      return;
    }
    if (p.tipo === 'ouvir') {
      const feito = Jornada.feito(j.passo);
      const o = p.modulo && p.modulo.ouvir;
      el.innerHTML = `<div style="display:grid;gap:22px">${barra}${cabPasso}
        <div class="peca-box"><img class="ilustracao figura-solta" src="img/ouvir.jpg" alt="Ouvir e cantar" loading="lazy" onerror="this.remove()"><div class="peca-info"><span class="rotulo">Para ouvir e cantar junto</span><h3 class="peca-titulo">${esc(o ? o.rotulo : 'A gravação do módulo')}</h3>
          <p class="suave">Chopin mandava os alunos ouvirem cantores. Ouça cinco minutos e cante a melodia junto, mesmo baixinho: é a sua frase que vai nascer disso.</p></div>
          <div class="linha-botoes">${o ? `<a class="btn primario" href="${esc(o.url)}" target="_blank" rel="noopener">Abrir a gravação</a>` : ''}<button class="btn" type="button" id="hoje-fiz" ${feito ? 'disabled' : ''}>${feito ? 'Feito' : 'Ouvi e cantei'}</button></div></div>
        ${rodape(feito, null)}</div>`;
      $('#hoje-fiz').addEventListener('click', () => {
        registrarSessao({ quando: new Date().toISOString(), dia: hojeStr(), aula: 'ouvir', minutos: p.min, completa: true });
        $('#hoje-fiz').disabled = true; $('#hoje-fiz').textContent = 'Feito'; liberar(); renderHoje();
      });
      ligarRodape();
      if (!feito) { fluxoEtapaSimples(p.modulo ? 'modulo-' + p.modulo.n : null, p.modulo ? p.modulo.narracao : '', p.min); ligarCronometro(j.passo, p.min, () => { const b = $('#hoje-fiz'); if (b && !b.disabled && Fluxo.ligado()) b.click(); }); }
      else if (Fluxo.ligado()) { const b = $('#hoje-continuar'); if (b) setTimeout(() => b.click(), 1500); }
      return;
    }
    // aula prática ou peça
    const a0 = AULAS.get(p.aula);
    if (a0.tipo === 'repertorio') {
      const peca = (C.biblioteca || []).find(x => x.id === a0.peca);
      el.innerHTML = `<div style="display:grid;gap:22px">${barra}${cabPasso}<p class="aviso">Carregando a peça…</p></div>`;
      abrirPeca(peca).then(m => {
        if ($('#vista-hoje').hidden) return;
        const { pl, prox, feitas, total } = progressoMusica(m);
        const e = prox;
        const a = aulaDaEtapa(m, pl, e);
        const feito = Jornada.feito(j.passo);
        el.innerHTML = `<div style="display:grid;gap:22px">${barra}${cabPasso}
          <div class="aula-cab"><span class="rotulo">${esc(peca.compositor)} · ${esc(peca.titulo)} · etapa ${e.n} de ${total}</span><h2>${esc(e.titulo)}</h2><p class="texto suave">${esc(dicaEtapa(e, a.bpm))}</p></div>
          ${blocoNarracao('aula-' + a0.id, 'Guia de estudo da peça', a0.narracao)}
          ${htmlPlayer(a)}<div id="resultado"></div>
          <div class="criterio"><span class="rotulo">Para passar</span><p>${esc(a.criterio)}</p></div>
          ${rodape(feito, 'Repetir a etapa')}</div>`;
        montarPlayer(a, { aoResultado: () => liberar(), aoPassar: () => $('#hoje-continuar') && $('#hoje-continuar').click(), ultimo: j.passo + 1 >= plano.length });
        $('#hoje-repetir').addEventListener('click', () => { if (playerAtual) { playerAtual.reiniciar(); $('#resultado').innerHTML = ''; } });
        ligarRodape();
      }).catch(err => { el.innerHTML = `<div style="display:grid;gap:22px">${barra}${cabPasso}<p class="aviso">Não consegui carregar a peça (${esc(err.message)}).</p>${rodape(true, null)}</div>`; ligarRodape(); });
      return;
    }
    const a = a0;
    const feito = Jornada.feito(j.passo) || statusAula(a.id) === 'ok';
    el.innerHTML = `<div style="display:grid;gap:22px">${barra}${cabPasso}
      ${blocoNarracao('aula-' + a.id, a.guia ? 'Só a explicação, em áudio' : 'Explicação da aula', a.narracao)}
      ${figurasHTML(a)}
      ${htmlPlayer(a)}<div id="resultado"></div>
      <div class="aula-info"><div><h3>Passo a passo</h3><ol>${a.passos.map(x => `<li>${esc(x)}</li>`).join('')}</ol></div>
        <div><h3>O que observar</h3><ul>${a.foco.map(x => `<li>${esc(x)}</li>`).join('')}</ul><div class="criterio"><span class="rotulo">Para passar</span><p>${esc(a.criterio)}</p></div></div></div>
      ${rodape(feito, 'Repetir o exercício')}</div>`;
    montarPlayer(a, { aoResultado: () => liberar(), aoPassar: () => $('#hoje-continuar') && $('#hoje-continuar').click(), ultimo: j.passo + 1 >= plano.length });
    $('#hoje-repetir').addEventListener('click', () => { if (playerAtual) { playerAtual.reiniciar(); $('#resultado').innerHTML = ''; } });
    ligarRodape();
  }
  // etapas sem player (corpo, leitura-guia, ouvir): explicação automática e avanço quando o tempo da etapa se cumpre
  function fluxoEtapaSimples(idNarr, texto, minutos) {
    if (!Fluxo.ligado()) return;
    Fluxo.quandoPuder(async () => {
      Fluxo.parar(); Fluxo.cancelado = false; Fluxo.ativo = true;
      rolar($('.figuras') || $('.peca-box') || $('.guia'), 'start');
      if (idNarr) await Fluxo.falar(idNarr, texto);
    });
  }

  /* ------------------------------------------------------------ início */
  window.__curso = { avaliar, Midi, Nuvem, estado, lerMidi, planoMusica, configPadrao, aulaDaEtapa, Guia, Jornada, get player() { return playerAtual; } };
  if ('speechSynthesis' in window) { try { speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = () => {}; } catch (e) { /* nada */ } }
  if ('serviceWorker' in navigator && location.protocol === 'https:') { try { navigator.serviceWorker.register('sw.js').catch(() => {}); } catch (e) { /* nada */ } }
  Midi.iniciar(false);
  Nuvem.iniciar();
  rota();
  AtivarSom.conferir();
})();
