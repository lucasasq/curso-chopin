/* Curso Chopin — partitura na tela (VexFlow), gerada a partir das notas de cada aula.
   window.Partitura.render(el, aula, opts) desenha a pauta dupla; .marcar(t) acende as notas da batida t. */
(() => {
  'use strict';
  const NOMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
  const NOMES_B = ['c', 'db', 'd', 'eb', 'e', 'f', 'gb', 'g', 'ab', 'a', 'bb', 'b'];
  const PRETAS = new Set([1, 3, 6, 8, 10]);
  // duração em tempos (semínima = 1) -> VexFlow
  const DURS = [[4, 'w', 0], [3, 'h', 1], [2, 'h', 0], [1.5, 'q', 1], [1, 'q', 0], [0.75, '8', 1], [0.5, '8', 0], [0.375, '16', 1], [0.25, '16', 0], [0.125, '32', 0]];
  const LIMITE_NOTAS = 700;

  function vf() { const V = window.Vex && (window.Vex.Flow || window.Vex); return V && V.Stave ? V : (window.VexFlow || null); }

  function duracao(d) {
    // aproxima para a figura mais próxima; terças de tempo (tercinas) viram colcheias/semínimas de tercina
    for (const [v, s, p] of DURS) if (Math.abs(d - v) < 0.02) return { s, p, trip: false };
    if (Math.abs(d - 1 / 3) < 0.02) return { s: '8', p: 0, trip: true };
    if (Math.abs(d - 2 / 3) < 0.02) return { s: 'q', p: 0, trip: true };
    if (Math.abs(d - 1 / 6) < 0.02) return { s: '16', p: 0, trip: true };
    let melhor = DURS[DURS.length - 1];
    for (const x of DURS) if (x[0] <= d + 0.02) { melhor = x; break; }
    return { s: melhor[1], p: melhor[2], trip: false };
  }
  function partir(d) {
    // divide uma duração em figuras simples (ex.: 2.5 -> 2 + 0.5), do maior para o menor
    const out = [];
    let resto = d;
    let guarda = 0;
    while (resto > 0.06 && guarda++ < 8) {
      const x = DURS.find(y => y[0] <= resto + 0.02) || DURS[DURS.length - 1];
      const dur = duracao(x[0]);
      out.push({ ...dur, v: x[0] });
      resto -= x[0];
    }
    if (!out.length) out.push({ ...duracao(d), v: d });
    return out;
  }

  function tonalidadeDe(tom) {
    const sust = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'], bem = ['C', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb'];
    if (tom == null) return null;
    return tom >= 0 ? sust[Math.min(7, tom)] : bem[Math.min(7, -tom)];
  }

  function eventosDaMao(notas, h, cb, c0, c1) {
    // agrupa por ataque; a duração de um evento vai até o próximo ataque da mesma mão (ou até o fim das notas)
    const lista = notas.filter(n => n.h === h).sort((a, b) => a.t - b.t || a.m - b.m);
    const grupos = [];
    for (const n of lista) {
      const g = grupos[grupos.length - 1];
      if (g && Math.abs(g.t - n.t) < 0.02) g.notas.push(n); else grupos.push({ t: n.t, notas: [n] });
    }
    grupos.forEach((g, i) => {
      const fimNota = Math.max(...g.notas.map(n => n.t + n.d));
      const prox = grupos[i + 1] ? grupos[i + 1].t : Infinity;
      g.d = Math.max(0.1, Math.min(fimNota, prox) - g.t);
      g.fim = g.t + g.d;
    });
    // por compasso: [ {c, itens:[{t,d,notas|rest}] } ]
    const compassos = [];
    for (let c = c0; c < c1; c++) {
      const ini = c * cb, fim = (c + 1) * cb;
      const itens = [];
      let cursor = ini;
      for (const g of grupos) {
        if (g.t < ini - 0.02 || g.t >= fim - 0.02) continue;
        if (g.t > cursor + 0.06) itens.push({ t: cursor, d: g.t - cursor, rest: true });
        const d = Math.min(g.d, fim - g.t);
        itens.push({ t: g.t, d, notas: g.notas });
        cursor = g.t + d;
      }
      if (cursor < fim - 0.06) itens.push({ t: cursor, d: fim - cursor, rest: true });
      if (!itens.length) itens.push({ t: ini, d: cb, rest: true });
      compassos.push({ c, itens });
    }
    return compassos;
  }

  function chave(n, bemol) {
    const pc = n.m % 12, oit = Math.floor(n.m / 12) - 1;
    const nome = (bemol || /♭/.test(n.n || '')) && PRETAS.has(pc) && !/#/.test(n.n || '') ? NOMES_B[pc] : NOMES[pc];
    return { chave: `${nome}/${oit}`, acid: nome.length > 1 ? nome[1] : null, letra: nome[0], oit };
  }

  function render(el, aula, opts = {}) {
    const V = vf();
    if (!V || !el) return null;
    const notas = aula.notas || [];
    el.innerHTML = '';
    if (!notas.length) return null;
    if (notas.length > LIMITE_NOTAS) { el.innerHTML = `<p class="aviso">Partitura disponível nas etapas menores (este trecho tem ${notas.length} notas).</p>`; return null; }
    const metro = aula.metro || { num: aula.compasso || 4, den: 4 };
    const cb = metro.num * 4 / metro.den;
    const t0 = Math.min(...notas.map(n => n.t)), t1 = Math.max(...notas.map(n => n.t + n.d));
    const c0 = Math.floor(t0 / cb + 1e-6), c1 = Math.ceil(t1 / cb - 1e-6);
    const temD = notas.some(n => n.h === 'D'), temE = notas.some(n => n.h === 'E');
    const maos = [temD ? 'D' : null, temE ? 'E' : null].filter(Boolean);
    const bemol = (aula.tom != null && aula.tom < 0) || notas.some(n => /♭/.test(n.n || ''));
    const tonal = tonalidadeDe(aula.tom);
    const porMao = Object.fromEntries(maos.map(h => [h, eventosDaMao(notas, h, cb, c0, c1)]));
    const dinamica = (aula.metricas || []).includes('dinamica');
    const ultimaDin = { D: null, E: null };

    const largura = Math.max(300, el.clientWidth || 600);
    const porLinha = largura < 440 ? 1 : largura < 640 ? 2 : largura < 900 ? 3 : 4;
    const nComp = c1 - c0;
    const linhas = Math.ceil(nComp / porLinha);
    const altPauta = 90, entrePautas = 30, entreSistemas = 50;
    const altSistema = maos.length === 2 ? 2 * altPauta + entrePautas + entreSistemas : altPauta + entreSistemas;
    const renderer = new V.Renderer(el, V.Renderer.Backends.SVG);
    renderer.resize(largura, linhas * altSistema + 20);
    const ctx = renderer.getContext();
    ctx.setFont('Instrument Sans, system-ui, sans-serif', 10);
    const corD = getComputedStyle(document.documentElement).getPropertyValue('--rh').trim() || '#A8760C';
    const corE = getComputedStyle(document.documentElement).getPropertyValue('--lh').trim() || '#11737B';
    const tinta = '#2A2E3A'; // o fundo da partitura é sempre claro
    ctx.setFillStyle(tinta); ctx.setStrokeStyle(tinta);
    // armadura: notas já alteradas pela tonalidade não repetem o acidente
    const ORDEM_B = ['b', 'e', 'a', 'd', 'g', 'c', 'f'], ORDEM_S = ['f', 'c', 'g', 'd', 'a', 'e', 'b'];
    const armadura = {};
    if (aula.tom) (aula.tom > 0 ? ORDEM_S : ORDEM_B).slice(0, Math.min(7, Math.abs(aula.tom))).forEach(l => { armadura[l] = aula.tom > 0 ? '#' : 'b'; });
    const marcas = []; // {t, fim, el, h}

    for (let li = 0; li < linhas; li++) {
      const cIni = c0 + li * porLinha, cFim = Math.min(c1, cIni + porLinha);
      const n = cFim - cIni;
      const margem = li === 0 ? 70 : 40;
      const wComp = (largura - margem - 10) / n;
      const y = li * altSistema + 10;
      const pautas = {};
      maos.forEach((h, k) => {
        const yy = y + k * (altPauta + entrePautas);
        pautas[h] = [];
        for (let i = 0; i < n; i++) {
          // a primeira pauta da linha inclui a margem (clave, armadura, fórmula de compasso)
          const st = new V.Stave(i === 0 ? 0 : margem + i * wComp, yy, i === 0 ? margem + wComp : wComp);
          if (i === 0) {
            st.addClef(h === 'D' ? 'treble' : 'bass');
            if (tonal && tonal !== 'C') st.addKeySignature(tonal);
            if (li === 0) st.addTimeSignature(`${metro.num}/${metro.den}`);
          }
          st.setContext(ctx).draw();
          pautas[h].push(st);
        }
      });
      if (maos.length === 2) {
        const con = new V.StaveConnector(pautas.D[0], pautas.E[0]); con.setType(V.StaveConnector.type.BRACE); con.setContext(ctx).draw();
        const con2 = new V.StaveConnector(pautas.D[0], pautas.E[0]); con2.setType(V.StaveConnector.type.SINGLE_LEFT); con2.setContext(ctx).draw();
      }
      for (let i = 0; i < n; i++) {
        const c = cIni + i;
        const vozes = [], notasVF = [];
        const porMaoVozes = {};
        maos.forEach(h => {
          const comp = porMao[h][c - c0];
          const alteradas = new Map(); // memória de acidentes no compasso (por letra+oitava)
          if (tonal && tonal !== 'C') { /* com armadura, mostra acidentes só fora dela (simplificação: compara com a nota natural) */ }
          const tickables = [];
          for (const it of comp.itens) {
            const partes = partir(it.d);
            partes.forEach((pt, pi) => {
              if (it.rest) {
                const r = new V.StaveNote({ keys: [h === 'D' ? 'b/4' : 'd/3'], duration: pt.s + 'r', clef: h === 'D' ? 'treble' : 'bass' });
                if (pt.p) V.Dot.buildAndAttach([r], { all: true });
                tickables.push(r);
                return;
              }
              const ordenadas = it.notas.slice().sort((a, b) => a.m - b.m);
              const chaves = ordenadas.map(nn => chave(nn, bemol));
              const nota = new V.StaveNote({ keys: chaves.map(k => k.chave), duration: pt.s, clef: h === 'D' ? 'treble' : 'bass', auto_stem: true });
              chaves.forEach((k, idx) => {
                const id = k.letra + k.oit;
                const estado = alteradas.has(id) ? alteradas.get(id) : (armadura[k.letra] || null);
                if (k.acid && estado !== k.acid) { nota.addModifier(new V.Accidental(k.acid), idx); alteradas.set(id, k.acid); }
                else if (!k.acid && estado) { nota.addModifier(new V.Accidental('n'), idx); alteradas.set(id, null); }
                const f = ordenadas[idx].f;
                if (f && pi === 0) {
                  const an = new V.Annotation(String(f)).setFont('Instrument Sans, system-ui', 9, 'bold');
                  an.setVerticalJustification(h === 'D' ? V.Annotation.VerticalJustify.TOP : V.Annotation.VerticalJustify.BOTTOM);
                  nota.addModifier(an, idx);
                }
              });
              if (pt.p) V.Dot.buildAndAttach([nota], { all: true });
              if (dinamica && pi === 0) {
                const v = Math.max(...it.notas.map(nn => nn.v));
                const rot = v < 0.3 ? 'pp' : v < 0.45 ? 'p' : v < 0.6 ? 'mp' : v < 0.72 ? 'mf' : v < 0.88 ? 'f' : 'ff';
                if (rot !== ultimaDin[h]) {
                  ultimaDin[h] = rot;
                  const an = new V.Annotation(rot).setFont('Georgia, serif', 12, 'bold italic');
                  an.setVerticalJustification(V.Annotation.VerticalJustify.BOTTOM);
                  nota.addModifier(an, 0);
                }
              }
              nota.setStyle({ fillStyle: h === 'D' ? corD : corE, strokeStyle: h === 'D' ? corD : corE });
              tickables.push(nota);
              marcas.push({ t: it.t, fim: it.t + it.d, nota, h, atual: false });
            });
          }
          const voz = new V.Voice({ num_beats: metro.num, beat_value: metro.den }).setMode(V.Voice.Mode.SOFT);
          voz.addTickables(tickables);
          vozes.push(voz); porMaoVozes[h] = voz;
          notasVF.push(...tickables);
        });
        const fmt = new V.Formatter();
        vozes.forEach(v => fmt.joinVoices([v]));
        const st0 = pautas[maos[0]][i];
        fmt.format(vozes, st0.getWidth() - (i === 0 ? st0.getNoteStartX() - st0.getX() : 0) - 24);
        maos.forEach(h => {
          const feixes = V.Beam.generateBeams(porMaoVozes[h].getTickables().filter(t => !t.isRest()), { maintain_stem_directions: false });
          porMaoVozes[h].draw(ctx, pautas[h][i]);
          feixes.forEach(b => b.setContext(ctx).draw());
        });
      }
    }
    const api = {
      marcar(t) {
        let mudou = false;
        for (const m of marcas) {
          const atual = t >= m.t - 0.02 && t < m.fim - 0.02;
          if (atual !== m.atual) {
            m.atual = atual; mudou = true;
            const g = m.nota.getSVGElement && m.nota.getSVGElement();
            if (g) g.classList.toggle('nota-atual', atual);
          }
        }
        return mudou;
      },
      limpar() { marcas.forEach(m => { if (m.atual) { m.atual = false; const g = m.nota.getSVGElement && m.nota.getSVGElement(); if (g) g.classList.remove('nota-atual'); } }); }
    };
    return api;
  }

  window.Partitura = { render, disponivel: () => !!vf() };
})();
