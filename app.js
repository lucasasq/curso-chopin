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
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  /* ------------------------------------------------------------ armazenamento */
  const store = {
    get(k, d) { try { const v = localStorage.getItem('cursoChopin.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('cursoChopin.' + k, JSON.stringify(v)); } catch (e) { /* sem armazenamento */ } }
  };
  const estado = {
    sessoes: store.get('sessoes', []),
    status: store.get('status', {}),
    prefs: Object.assign({ tempo: 1, metronomo: false, nomes: false, repetir: false }, store.get('prefs', {}))
  };
  const salvar = () => { store.set('sessoes', estado.sessoes); store.set('status', estado.status); store.set('prefs', estado.prefs); };
  const hojeStr = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  function statusAula(id) {
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
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
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
      const vozes = speechSynthesis.getVoices();
      const v = vozes.find(x => /luciana/i.test(x.name)) || vozes.find(x => x.lang === 'pt-BR') || vozes.find(x => /^pt/i.test(x.lang));
      if (v) u.voice = v;
      u.onend = acabou; u.onerror = acabou;
      speechSynthesis.speak(u);
    }
  };
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
    },
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
      const rot = (mk && mk.rotulo) || (opts.nomes ? NOMES[m % 12] : (m % 12 === 0 ? nomeMidi(m) : ''));
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
  function avaliar(aula, eventos, recs) {
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
    // veredito
    const p = aula.passa || {};
    const faltas = [];
    if (p.acertos != null && out.acertos < p.acertos) faltas.push(`notas certas ${out.acertos}% (meta ${p.acertos}%)`);
    if (p.regularidade != null && (out.regularidade ?? 0) < p.regularidade) faltas.push(`regularidade ${out.regularidade ?? '—'}% (meta ${p.regularidade}%)`);
    if (p.bpm != null && (out.bpm ?? 0) < p.bpm) faltas.push(`tempo ♩ = ${out.bpm ?? '—'} (meta ♩ = ${p.bpm})`);
    if (p.buracosMax != null && (out.buracos ?? 0) > p.buracosMax) faltas.push(`${out.buracos} buracos no legato (máximo ${p.buracosMax})`);
    if (p.dinamica != null && (out.dinamica ?? 0) < p.dinamica) faltas.push(`dinâmica ${out.dinamica ?? 0}% (meta ${p.dinamica}%)`);
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
      d.push(`O tempo variou em média ${r.variacao}% de uma nota para outra. Ligue o metrônomo e toque um pouco mais devagar, contando junto.`);
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
    if (!d.length) d.push(r.passou ? 'Tudo dentro da meta. Na próxima, tente o mesmo com os olhos fechados nas últimas repetições.' : 'Continue praticando: os números vão subir.');
    return d;
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
      this.parar(); Midi.ouvintes.delete(this.ouvinte); this.ro.disconnect();
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
      this.errosLista = [];
      this.idx = 0;
      this.abertos = new Map();
      this.terminou = false;
      this.parcial = false;
    }
    // ---- controle
    definirModo(m) { this.parar(); this.modo = m; this.reiniciar(); }
    definirMaos(h) { this.parar(); this.maos = h; this.prepararNotas(); this.batida = this.inicio - 0.4; this.desenhar(); this.atualizarStatus(); }
    get fator() { return estado.prefs.tempo; }
    get bps() { return this.bpm * this.fator / 60; }
    reiniciar() { this.parar(); this.prepararNotas(); this.batida = this.inicio - 0.4; this.resultado = null; this.desenhar(); this.atualizarStatus(); this.atualizarTransporte(); }
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
    tocar() {
      const ctx = Som.iniciar(); if (!ctx) return;
      if (this.modo === 'praticar' && (this.terminou || this.idx >= this.eventos.length)) this.reiniciar();
      if (this.modo === 'ouvir' && this.batida >= this.fim - 0.01) this.reiniciar();
      this.terminou = false;
      this.tocando = true;
      if (this.batida <= this.inicio) this.batida = this.inicio - this.compasso; // um compasso de contagem
      this.ancora = { b: this.batida, t: ctx.currentTime + 0.08 };
      this.agendadoAte = this.batida;
      this.ultimoQuadro = performance.now();
      if (this.modo === 'praticar') {
        if (!this.sessaoInicio) this.sessaoInicio = Date.now();
        if (estado.prefs.metronomo) Player.metronomoLivre(this.bpm * this.fator, this.compasso, this.batida < this.inicio ? this.tempoDe(this.inicio) : ctx.currentTime + 0.05);
      }
      this.atualizarTransporte();
      requestAnimationFrame(this.loop);
    }
    parar() {
      if (!this.tocando) return;
      this.tocando = false;
      Player.metro && Player.metro.parar();
      if (this.modo === 'praticar' && this.sessaoInicio && !this.terminou) this.registrarParcial();
      this.atualizarTransporte();
    }
    batidaEm(t) { return this.ancora.b + (t - this.ancora.t) * this.bps; }
    tempoDe(b) { return this.ancora.t + (b - this.ancora.b) / this.bps; }
    reancorar() { if (this.tocando && Som.ctx) { this.ancora = { b: this.batida, t: Som.ctx.currentTime }; this.agendadoAte = this.batida; } }
    loop(agora) {
      if (!this.tocando) return;
      const ctx = Som.ctx;
      if (this.modo === 'ouvir') {
        this.batida = this.batidaEm(ctx.currentTime);
        const horizonte = this.batidaEm(ctx.currentTime + 0.15);
        for (const n of this.aula.notas) {
          if (n.t >= this.agendadoAte && n.t < horizonte) {
            if (this.maos !== 'todas' && n.h !== this.maos) continue;
            const ini = Math.max(this.tempoDe(n.t), ctx.currentTime);
            Som.nota(n.m, ini, n.d / this.bps * (n.a === 'stac' ? 0.9 : 0.98), n.v);
          }
        }
        this.cliques(horizonte, estado.prefs.metronomo);
        this.agendadoAte = horizonte;
        if (this.batida > this.fim + 0.6) {
          if (estado.prefs.repetir) { this.tocando = false; this.batida = this.inicio; this.tocar(); return; }
          this.tocando = false; this.batida = this.fim; this.atualizarTransporte();
        }
      } else {
        const dt = Math.min(0.1, (agora - this.ultimoQuadro) / 1000);
        this.ultimoQuadro = agora;
        if (this.batida < this.inicio) {
          this.batida = this.batidaEm(ctx.currentTime);
          const horizonte = this.batidaEm(ctx.currentTime + 0.15);
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
      const ini = Math.ceil(this.agendadoAte - 1e-6);
      for (let k = ini; k < horizonte; k++) {
        const contagem = k < this.inicio;
        if (!sempre && !contagem) continue;
        if (k < this.inicio - this.compasso - 0.01) continue;
        const forte = (((k - this.inicio) % this.compasso) + this.compasso) % this.compasso === 0;
        Som.clique(Math.max(this.tempoDe(k), Som.ctx.currentTime), forte);
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
          if (!ev.pendentes.size) { ev.ok = true; this.idx++; this.atualizarStatus(); }
        } else if (ev.feitos.has(m)) {
          /* repetiu nota do mesmo acorde: ignora */
        } else {
          ev.erros++;
          this.errosLista.push({ esperado: ev.notas.filter(x => ev.pendentes.has(x.m)).map(x => x.n).join(' + '), tocou: NOMES[m % 12] });
          this.flash.set(m, { ate: performance.now() + 450, cor: css('--bad') });
        }
      } else if (tipo === 'off') {
        const rec = this.abertos.get(m);
        if (rec) { rec.off = ts; this.abertos.delete(m); }
      }
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
      Player.metro && Player.metro.parar();
      const fimTs = performance.now();
      this.recs.forEach(r => { if (r.off == null) r.off = fimTs; });
      const r = avaliar(this.aula, this.eventos, this.recs);
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
      if (this.modo === 'ouvir') { st.innerHTML = 'Modo <b>Ouvir</b>: o site toca o exercício. Observe os dedos e cante junto.'; return; }
      if (this.terminou && this.resultado) { st.innerHTML = this.resultado.r.passou ? '<b>Passou.</b> Veja o relatório abaixo.' : 'Exercício terminado. Veja o relatório abaixo.'; return; }
      const ev = this.eventos[this.idx];
      if (!ev) { st.textContent = ''; return; }
      const alvo = ev.notas.map(n => `<b>${esc(n.n)}</b> (${n.h === 'D' ? 'MD' : 'ME'} ${n.f})`).join(' + ');
      const conectado = Midi.estado === 'conectado';
      st.innerHTML = (this.tocando ? 'Esperando: ' : 'Primeira nota: ') + alvo + (conectado ? '' : ' · <span class="suave">sem piano conectado: toque nas teclas da tela</span>');
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
          ctx.font = `700 ${clamp(ww * 0.55, 10, 16)}px ${css('--font-mono')}`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(String(n.f), x + ww / 2, base - 10);
          if (estado.prefs.nomes && base - topo > 40) {
            ctx.font = `600 ${clamp(ww * 0.3, 9, 12)}px ${css('--font-body')}`;
            ctx.fillText(n.n, x + ww / 2, base - 28);
          }
        }
        ctx.globalAlpha = 1;
        // tecla acesa enquanto a nota soa (modo ouvir) ou nota esperada (praticar)
        if (!fora && this.modo === 'ouvir' && this.batida >= n.t && this.batida < n.t + n.d) marcas.set(n.m, { cor, rotulo: String(n.f), textoCor: '#10121a' });
      }
      if (evAtual) for (const n of evAtual.notas) if (evAtual.pendentes.has(n.m)) marcas.set(n.m, { cor: (n.h === 'D' ? corD : corE), contorno: '#ffffff', rotulo: String(n.f), textoCor: '#10121a' });
      const agora = performance.now();
      for (const [m, v] of Midi.teclas) if (!marcas.has(m) || this.modo === 'ouvir') marcas.set(m, { cor: css('--press'), rotulo: estado.prefs.nomes ? NOMES[m % 12] : '', textoCor: '#10121a' });
      for (const [m, f] of this.flash) { if (f.ate < agora) { this.flash.delete(m); continue; } if (f.cor) marcas.set(m, { cor: f.cor, rotulo: NOMES[m % 12], textoCor: '#ffffff' }); }
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
    const h = (location.hash || '#curso').slice(1);
    let vista = 'curso', aulaId = null;
    if (h.startsWith('aula-')) { aulaId = h.slice(5); vista = AULAS.has(aulaId) ? 'aula' : 'curso'; }
    else if (h === 'progresso') vista = 'progresso';
    Narr.parar();
    if (playerAtual) { playerAtual.destruir(); playerAtual = null; }
    $$('.vista').forEach(v => { v.hidden = v.id !== 'vista-' + vista; });
    $$('.nav a').forEach(a => { if (a.dataset.nav === vista) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    $('#nav-aula').href = '#aula-' + (aulaId || proximaAula());
    if (vista === 'curso') renderCurso();
    if (vista === 'aula') renderAula(aulaId);
    if (vista === 'progresso') renderProgresso();
    window.scrollTo(0, 0);
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
          <span class="rotulo">Piano em casa, pelo método de Chopin</span>
          <h1>A mão e o som primeiro. A partitura vem depois.</h1>
          <p class="texto">Um curso de 26 semanas para quem já toca algumas músicas e quer técnica de verdade. Cada aula tem explicação falada, um teclado animado com as notas e os dedos, e um modo de prática que escuta o seu piano pelo cabo e espera você acertar.</p>
          ${blocoNarracao('intro', 'Apresentação do curso', C.intro)}
          <div class="acoes">
            <a class="btn primario" href="#aula-${prox}">${algumaFeita ? 'Continuar' : 'Começar'}: aula ${idTexto(prox)}</a>
            <a class="btn" href="#progresso">Ver progresso</a>
          </div>
        </div>
        <figure class="posicao" style="margin:0">
          <canvas id="cv-posicao" aria-label="Teclado mostrando a posição de Chopin: mão esquerda em Fá, Sol bemol, Lá bemol, Si bemol, Dó; mão direita em Mi, Fá sustenido, Sol sustenido, Lá sustenido, Si"></canvas>
          <p>A posição de Chopin. Direita: Mi, Fá#, Sol#, Lá#, Si (dedos 1 a 5). Esquerda, em espelho: Dó, Si♭, Lá♭, Sol♭, Fá.</p>
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

      <div class="secao">
        <h2>Os módulos</h2>
        <div class="modulos">
          ${C.modulos.map(m => {
            const aulas = C.aulas.filter(a => a.modulo === m.n);
            return `<article class="modulo" data-pronto="${m.pronto}">
              <div class="num">${m.n}</div>
              <div class="cab"><h3 style="font-size:1.15rem">${esc(m.titulo)}</h3><span class="rotulo">${esc(m.semanas)}</span>${m.pronto ? '' : '<span class="chip">em preparação</span>'}</div>
              <div class="corpo">
                <p class="ideia">${esc(m.ideia)}</p>
                <p class="texto"><b>Objetivo:</b> ${esc(m.objetivo)}</p>
                ${m.narracao ? blocoNarracao('modulo-' + m.n, 'Explicação do módulo ' + m.n, m.narracao) : ''}
                <ul class="aulas">
                  ${m.pronto ? aulas.map(a => `<li><a href="#aula-${a.id}"><span class="id">${idTexto(a.id)}</span><span class="t">${esc(a.titulo)}</span></a>${chipStatus(a.id)}</li>`).join('')
                    : (m.aulas || []).map((t, i) => `<li><span class="plano"><span class="id">${m.n}.${i + 1}</span><span class="t">${esc(t)}</span></span></li>`).join('')}
                </ul>
                <a class="ouvir-link" href="${esc(m.ouvir.url)}" target="_blank" rel="noopener">Para ouvir: ${esc(m.ouvir.rotulo)}</a>
              </div>
            </article>`;
          }).join('')}
        </div>
      </div>

      <div class="secao">
        <h2>Depois do curso</h2>
        <ul class="depois">${C.depois.map(d => `<li>${esc(d)}</li>`).join('')}</ul>
      </div>

      <div class="secao">
        <h2>Fontes</h2>
        <ul class="fontes">${C.fontes.map(f => `<li>${f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.t)}</a>` : esc(f.t)}</li>`).join('')}</ul>
      </div>`;
    desenharPosicao();
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
        <div class="figuras" id="figuras">
          ${['postura', 'braco-peso', 'mao-concha'].map(f => `<img src="img/${f}.png" alt="" data-fig="${f}" loading="lazy">`).join('')}
        </div>
        <div class="guia"><ol>${a.passos.map(p => `<li><span>${esc(p)}</span></li>`).join('')}</ol></div>
        <div class="linha-botoes">
          <button class="btn primario" type="button" id="fiz-hoje" ${diasFeitos.has(hojeStr()) ? 'disabled' : ''}>${diasFeitos.has(hojeStr()) ? 'Feito hoje' : 'Fiz a rotina hoje'}</button>
          <span class="aviso">${diasFeitos.size} de 3 dias feitos${statusAula(id) === 'ok' ? ' · aula concluída' : ''}</span>
        </div>
        <div class="criterio"><span class="rotulo">Para passar</span><p>${esc(a.criterio)}</p></div>
        ${navAulas}</div>`;
      $$('#figuras img').forEach(img => img.addEventListener('error', () => img.remove()));
      $('#fiz-hoje').addEventListener('click', () => {
        registrarSessao({ quando: new Date().toISOString(), dia: hojeStr(), aula: id, minutos: a.minutos, completa: true });
        const dias = new Set(estado.sessoes.filter(s => s.aula === id).map(s => s.dia));
        if (dias.size >= 3) { estado.status[id] = { concluida: hojeStr() }; salvar(); }
        renderAula(id);
      });
      return;
    }

    const p = estado.prefs;
    el.innerHTML = `<div style="display:grid;gap:22px">${cab}
      ${blocoNarracao('aula-' + id, 'Explicação da aula', a.narracao)}
      <div class="player" id="player">
        <div class="controles">
          <div class="seg" role="group" aria-label="Modo">
            <button type="button" data-modo="ouvir" aria-pressed="true">Ouvir</button>
            <button type="button" data-modo="praticar" aria-pressed="false">Praticar</button>
          </div>
          ${maosOp ? `<div class="seg" role="group" aria-label="Mãos">
            <button type="button" data-maos="todas" aria-pressed="true">Ambas</button>
            <button type="button" data-maos="D" aria-pressed="false">Direita</button>
            <button type="button" data-maos="E" aria-pressed="false">Esquerda</button>
          </div>` : ''}
          <label class="campo" for="tempo">Tempo <input id="tempo" type="range" min="0.5" max="1.25" step="0.05" value="${p.tempo}"> <b id="tempo-txt">♩ = ${Math.round(a.bpm * p.tempo)}</b></label>
          <label class="chk"><input type="checkbox" id="metronomo" ${p.metronomo ? 'checked' : ''}> Metrônomo</label>
          <label class="chk"><input type="checkbox" id="nomes" ${p.nomes ? 'checked' : ''}> Nomes das notas</label>
          <label class="chk"><input type="checkbox" id="repetir" ${p.repetir ? 'checked' : ''}> Repetir</label>
        </div>
        <div class="palco"><canvas aria-label="Teclado animado: as notas descem até as teclas, com o número do dedo"></canvas></div>
        <div class="transporte">
          <button class="btn primario tocar" type="button" data-acao="tocar"></button>
          <button class="btn" type="button" data-acao="reiniciar">Do início</button>
          <div class="barra-prog" aria-hidden="true"><div></div></div>
          ${a.secoes.length ? `<div class="secoes-chips">${a.secoes.map(s => `<button type="button" data-ir="${s.t}">${esc(s.rotulo)}</button>`).join('')}</div>` : ''}
        </div>
        <p class="status" aria-live="polite"></p>
      </div>
      <div id="resultado"></div>
      ${info}
      ${historicoAula(id)}
      ${navAulas}</div>`;

    const raiz = $('#player');
    const pl = playerAtual = new Player(raiz, a);
    pl.atualizarTransporte();
    raiz.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.modo) {
        $$('[data-modo]', raiz).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        pl.definirModo(b.dataset.modo);
        if (b.dataset.modo === 'praticar' && Midi.estado === 'pedir') Midi.iniciar(true);
      }
      if (b.dataset.maos) { $$('[data-maos]', raiz).forEach(x => x.setAttribute('aria-pressed', String(x === b))); pl.definirMaos(b.dataset.maos); }
      if (b.dataset.acao === 'tocar') { if (pl.tocando) pl.parar(); else { Narr.parar(); pl.tocar(); } pl.atualizarStatus(); }
      if (b.dataset.acao === 'reiniciar') { pl.reiniciar(); $('#resultado').innerHTML = ''; }
      if (b.dataset.ir != null) pl.irPara(+b.dataset.ir);
    });
    $('#tempo').addEventListener('input', e => {
      p.tempo = +e.target.value; salvar();
      $('#tempo-txt').textContent = `♩ = ${Math.round(a.bpm * p.tempo)}`;
      pl.reancorar();
    });
    $('#metronomo').addEventListener('change', e => {
      p.metronomo = e.target.checked; salvar();
      if (pl.tocando && pl.modo === 'praticar') { if (p.metronomo) Player.metronomoLivre(pl.bpm * pl.fator, pl.compasso, Som.ctx.currentTime + 0.05); else Player.metro && Player.metro.parar(); }
    });
    $('#nomes').addEventListener('change', e => { p.nomes = e.target.checked; salvar(); pl.desenhar(); });
    $('#repetir').addEventListener('change', e => { p.repetir = e.target.checked; salvar(); });
    raiz.addEventListener('resultado', ev => mostrarResultado(a, ev.detail));
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
    const linhas = ['D', 'E'].filter(h => [1, 2, 3, 4, 5].some(k => r.forca[h + k] != null)).map(h => {
      const vs = [1, 2, 3, 4, 5].map(k => r.forca[h + k]);
      return `<div class="linha ${h}"><span>${h === 'D' ? 'Mão direita' : 'Mão esquerda'}</span>${vs.map((v, k) => `<div class="col"><i style="height:${v == null ? 0 : Math.round(8 + 52 * v / 127)}px"></i>${v == null ? '—' : v}<span>dedo ${k + 1}</span></div>`).join('')}</div>`;
    }).join('');
    $('#resultado').innerHTML = `<div class="resultado" data-passou="${r.passou}">
      <div class="veredito"><span class="selo">${r.passou ? 'Passou' : 'Ainda não'}</span><h3>${r.passou ? (r.parcial ? 'Trecho dentro da meta. Para concluir a aula, toque do início ao fim.' : 'Aula concluída. Pode seguir para a próxima.') : 'Falta: ' + esc(r.faltas.join(' · '))}</h3></div>
      <div class="metricas">${met.join('')}</div>
      ${linhas ? `<div class="dedos"><span class="rotulo">Força média por dedo (0 a 127)</span>${linhas}</div>` : ''}
      <div><span class="rotulo">O que fazer agora</span><ul class="dicas">${ds.map(d => `<li>${esc(d)}</li>`).join('')}</ul></div>
      <p class="aviso">${Nuvem.logado ? 'Salvo neste aparelho e enviado para a nuvem.' : Nuvem.estado === 'sem-config' ? 'Salvo neste aparelho.' : 'Salvo só neste aparelho. Entre na aba Progresso para guardar também na nuvem.'}</p>
    </div>`;
    $('#resultado').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
      '', 'Últimas sessões avaliadas:'
    ];
    estado.sessoes.filter(s => s.r).slice(-12).forEach(s => {
      const r = s.r;
      const f = r.forca || {};
      const forca = ['D', 'E'].map(h => [1, 2, 3, 4, 5].some(k => f[h + k] != null) ? `${h === 'D' ? 'MD' : 'ME'} ${[1, 2, 3, 4, 5].map(k => `${k}:${f[h + k] ?? '-'}`).join(' ')}` : '').filter(Boolean).join(' | ');
      const onde = r.ondeBuracos ? Object.entries(r.ondeBuracos).map(([k, v]) => `${k}×${v}`).join(', ') : '';
      linhas.push(`- ${s.dia} · aula ${idTexto(s.aula)} (${{ todas: 'ambas', D: 'MD', E: 'ME' }[s.maos] || '-'}, tempo pedido ♩=${s.tempo}) · certas ${r.acertos}% · regularidade ${r.regularidade ?? '-'}% · ♩=${r.bpm ?? '-'}`
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
  document.addEventListener('nuvem-estado', () => {
    if ($('#vista-progresso').hidden) return;
    const foco = document.activeElement;
    if (foco && foco.closest && foco.closest('#nuvem') && foco.tagName === 'INPUT') return; // não apaga o que está sendo digitado
    renderNuvem();
  });

  /* ------------------------------------------------------------ início */
  window.__curso = { avaliar, Midi, Nuvem, estado, get player() { return playerAtual; } };
  if ('speechSynthesis' in window) { try { speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = () => {}; } catch (e) { /* nada */ } }
  Midi.iniciar(false);
  Nuvem.iniciar();
  rota();
})();
