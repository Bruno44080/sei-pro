/**
 * SEI Pro - Editor / Feature: Adicionar Link de Documento Publico
 *
 * Pesquisa um processo na Pesquisa Publica do SEI (modulo md_pesq), lista os
 * documentos publicos e insere no editor uma ancora <a class="ancoraSei"> para
 * o documento escolhido (ou para o processo inteiro).
 *
 * Como funciona:
 *  - A tela de pesquisa abre num iframe oculto da MESMA origem (nao e o iframe
 *    do editor: e uma pagina independente da versao do CKEditor). Assim o
 *    JavaScript da propria pesquisa roda (campos ocultos, validacao).
 *  - O codigo de verificacao (captcha) e copiado da imagem JA carregada no
 *    iframe, por canvas. Pedir a imagem de novo poderia gerar outro codigo.
 *  - Ao pesquisar, preenche e clica no botao da PROPRIA pagina (o JavaScript
 *    dela roda; em alguns SEIs o resultado chega depois, por AJAX, com um
 *    "Pesquisando..."). Depois espera o resultado aparecer no iframe, com
 *    prazo. alert() da pagina vira mensagem na janela; sem resultado, a
 *    mensagem do SEI aparece e um codigo novo e carregado.
 *  - A pagina do processo e lida por DOMParser: todas as linhas de
 *    #tblDocumentos (o SEI alterna infraTrClara e infraTrEscura), colunas pelo
 *    cabecalho, links resolvidos pela URL da pagina.
 *
 * Entrada (global, chamada por sei-pro-editor.js): openDialogProcessoPublicoPro.
 * Helpers do monolito usados no clique: setParamEditor, resetDialogBoxPro,
 * initChosenReplace, alertaBoxPro, sanitizeHTML, removeAcentos, getCitacaoDoc;
 * estado compartilhado: dadosProcessoPro, delayCrash.
 */
(function () {
    'use strict';

    var ID_IFRAME = 'frmCheckerProcessoPublicoPro';
    var ESPERA_MS = 15000;
    var estado = { botao: null, objetoCaptcha: null, enviando: false, geracao: 0 };

    // ------------------------------------------------------------ utilidades

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function texto(el) {
        return el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '';
    }

    function absoluta(url, base) {
        try { return new URL(url, base).href; } catch (e) { return ''; }
    }

    // Raiz do SEI a partir da pagina atual (/sei/controlador.php -> /sei/).
    function raizSei() {
        var p = window.location.pathname;
        var i = p.indexOf('/sei/');
        return window.location.origin + (i >= 0 ? p.slice(0, i + 5) : p.replace(/[^\/]*$/, ''));
    }

    function urlPesquisa() {
        return raizSei() + 'modulos/pesquisa/md_pesq_processo_pesquisar.php?acao_externa=protocolo_pesquisar&acao_origem_externa=protocolo_pesquisar&id_orgao_acesso_externo=0';
    }

    function marcarOcupado(sim) {
        estado.enviando = sim;
        if (typeof delayCrash !== 'undefined') delayCrash = sim;
        $('#searchPub_load').toggle(!!sim);
    }

    // Linha de status da janela. `link` = true mostra "Abrir a Pesquisa Publica".
    function avisar(msg, tipo, link) {
        var cor = tipo === 'erro' ? '#b3261e' : (tipo === 'ok' ? '#1e7b34' : '#616161');
        var html = msg ? '<span style="color:' + cor + '">' + esc(msg) + '</span>' : '';
        if (link) {
            html += ' <a class="linkDialog" href="' + esc(urlPesquisa()) + '" target="_blank" rel="noopener noreferrer">Abrir a Pesquisa P\u00FAblica</a>';
        }
        $('#searchPub_result').html(html).toggle(!!html);
    }

    // Mensagem que o SEI deu na pagina (validacao, alert, excecao).
    // Aviso vermelho do infra (SEI 5: #divInfraMensagens > .alert-danger, ex.: "Desafio nao foi
    // resolvido." quando o codigo de confirmacao nao confere). Sem o "X" de fechar.
    function avisoDeErro(doc) {
        var el = doc.querySelector('#divInfraMensagens .alert-danger, [id^="divInfraMsg"].alert-danger, #divInfraMensagens .alert-warning');
        if (!el) return '';
        var copia = el.cloneNode(true);
        Array.prototype.forEach.call(copia.querySelectorAll('button'), function (b) { b.remove(); });
        return texto(copia);
    }

    function mensagemDaPagina(doc, html) {
        var val = doc.querySelector('#txaInfraValidacao');
        if (val && texto(val)) return texto(val);
        var aviso = avisoDeErro(doc);
        if (aviso) return aviso;
        var exc = doc.querySelector('#divInfraExcecao, .infraExcecao, #divInfraMsg');
        if (exc && texto(exc)) return texto(exc);
        // alert() solto (mensagem do servidor), nao o de dentro das funcoes de validacao.
        var scripts = doc.querySelectorAll('script:not([src])');
        for (var i = 0; i < scripts.length; i++) {
            var js = scripts[i].textContent || '';
            if (/function\s*[\w$]*\s*\(/.test(js)) continue;
            var m = /alert\(\s*\\?(['"])(.*?)\\?\1\s*\)/.exec(js);
            if (m && m[2].trim()) return m[2].replace(/\\n/g, ' ').replace(/\\(.)/g, '$1').trim();
        }
        var conteudo = doc.querySelector('#conteudo');
        var t = texto(conteudo);
        return t && t.length < 300 ? t : '';
    }

    // Baixa uma pagina do SEI (Latin-1 em geral) e devolve o documento.
    function baixar(url, opcoes) {
        return fetch(url, Object.assign({ credentials: 'same-origin' }, opcoes || {})).then(function (r) {
            if (!r.ok) throw new Error('O SEI respondeu ' + r.status + '.');
            var tipo = r.headers.get('content-type') || '';
            var cs = (/charset=([^;]+)/i.exec(tipo) || [])[1];
            return r.arrayBuffer().then(function (buf) {
                var html;
                try { html = new TextDecoder((cs || 'iso-8859-1').trim()).decode(buf); }
                catch (e) { html = new TextDecoder('iso-8859-1').decode(buf); }
                if (!cs) {
                    var meta = (/<meta[^>]+charset=["']?([\w-]+)/i.exec(html) || [])[1];
                    if (meta && /utf-?8/i.test(meta)) html = new TextDecoder('utf-8').decode(buf);
                }
                return { doc: new DOMParser().parseFromString(html, 'text/html'), html: html, url: r.url || url };
            });
        });
    }

    // ------------------------------------------------------------ tela de pesquisa (iframe)

    window.getCheckerProcessoPublicoPro = function () {
        $('#' + ID_IFRAME).remove();
        $('<iframe>', {
            id: ID_IFRAME,
            frameborder: 0,
            // Fora da tela, mas com layout (display:none deixaria a pagina sem estilos calculados).
            style: 'width: 1024px; height: 768px; position: absolute; left: -12000px; top: 0; visibility: hidden; pointer-events: none;',
            'aria-hidden': 'true',
            tabindex: '-1',
            scrolling: 'no'
        }).appendTo('body');
    };

    function partesDaPesquisa(doc) {
        var prot = doc.querySelector('#txtProtocoloPesquisa') || doc.querySelector('input[name*="rotocolo"]');
        var form = doc.querySelector('#seiSearch') || (prot && prot.form) || null;
        if (!form || !prot) return null;
        var img = form.querySelector('#imgCaptcha') || form.querySelector('#lblCaptcha img') || form.querySelector('img[src*="aptcha" i]') ||
            doc.querySelector('#imgCaptcha') || doc.querySelector('img[src*="aptcha" i]');
        var cap = form.querySelector('#txtCaptcha') || form.querySelector('#txtInfraCaptcha') ||
            form.querySelector('input[name*="aptcha" i]:not([type="hidden"])');
        var recaptcha = !!doc.querySelector('.g-recaptcha, .h-captcha, iframe[src*="recaptcha"], iframe[src*="hcaptcha"], script[src*="recaptcha"]');
        var enviar = form.querySelector('#sbmPesquisar') || form.querySelector('[type="submit"]');
        return { form: form, protocolo: prot, img: img, captcha: cap, recaptcha: recaptcha, enviar: enviar };
    }

    // Copia a imagem ja carregada (sem pedir de novo ao servidor).
    function copiarImagem(img) {
        try {
            var c = document.createElement('canvas');
            c.width = img.naturalWidth || img.width;
            c.height = img.naturalHeight || img.height;
            c.getContext('2d').drawImage(img, 0, 0);
            return c.toDataURL('image/png');
        } catch (e) {
            return img.src;
        }
    }

    function esperarImagem(img, pronto) {
        if (!img || (img.complete && img.naturalWidth)) { pronto(); return; }
        var feito = false;
        var fim = function () { if (!feito) { feito = true; pronto(); } };
        img.addEventListener('load', fim);
        img.addEventListener('error', fim);
        setTimeout(fim, 5000);
    }

    // Carrega (ou recarrega) a tela de pesquisa e mostra o codigo.
    window.getDadosIframeProcessoPublicoPro = function () {
        var geracao = ++estado.geracao;
        estado.aguardandoResultado = false;
        getCheckerProcessoPublicoPro();
        $('#searchPub_captcha').html('');
        $('#captchaPub').val('');
        marcarOcupado(true);
        if (!estado.mensagemPendente) avisar('Abrindo a Pesquisa P\u00FAblica do SEI\u2026');
        var iframe = document.getElementById(ID_IFRAME);
        var desistir = setTimeout(function () {
            if (geracao !== estado.geracao) return;
            marcarOcupado(false);
            avisar('A Pesquisa P\u00FAblica n\u00E3o respondeu. Ela pode n\u00E3o estar instalada neste SEI ou estar fora do ar.', 'erro', true);
        }, ESPERA_MS);
        $(iframe).on('load', function () {
            if (geracao !== estado.geracao) return;
            clearTimeout(desistir);
            prepararJanela(iframe);
            // Depois de pesquisar, a pagina nova e o resultado (ou o erro).
            if (estado.aguardandoResultado) return;
            checkDadosIframeProcessoPublicoPro(geracao);
        });
        iframe.src = urlPesquisa();
    };

    // Cada pagina que abre no iframe: alert() vira mensagem na janela, e a saida marca a navegacao.
    function prepararJanela(iframe) {
        var win = null;
        try { win = iframe.contentWindow; } catch (e) { win = null; }
        if (!win) return;
        try { win.alert = function (m) { estado.mensagemCliente = String(m || ''); }; } catch (e) { /* segue */ }
        try {
            // beforeunload: a navegacao comecou (o pedido ainda vai ao servidor); pagehide: chegou.
            win.addEventListener('beforeunload', function () { estado.navegou = true; });
            win.addEventListener('pagehide', function () { estado.navegou = true; });
        } catch (e) { /* segue */ }
    }

    function docDoIframe() {
        var iframe = document.getElementById(ID_IFRAME);
        try { return iframe && iframe.contentDocument; } catch (e) { return null; }
    }

    window.checkDadosIframeProcessoPublicoPro = function (geracao) {
        if (geracao !== undefined && geracao !== estado.geracao) return;
        var doc = docDoIframe();
        var partes = doc ? partesDaPesquisa(doc) : null;
        marcarOcupado(false);
        if (!partes) {
            avisar('A Pesquisa P\u00FAblica n\u00E3o foi encontrada neste SEI (a tela n\u00E3o tem o campo do processo).', 'erro', true);
            return;
        }
        estado.partes = partes;
        if (!partes.captcha) {
            estado.semCodigo = true;
            if (partes.recaptcha) {
                avisar('A Pesquisa P\u00FAblica deste SEI usa reCAPTCHA, que s\u00F3 funciona na pr\u00F3pria p\u00E1gina. Abra a pesquisa, copie o link do documento e insira com o bot\u00E3o Link do editor.', 'erro', true);
                return;
            }
            mostrarCampoCodigo(false);
            avisarPendente();
            $('#processoPub').focus();
            return;
        }
        estado.semCodigo = false;
        mostrarCampoCodigo(true);
        $('#searchPub_captcha').html('<span class="txt_cinza" style="font-size: 9pt;">Carregando o c\u00F3digo\u2026</span>');
        acompanharCodigo(doc, partes, geracao);
    };

    // A pagina troca o codigo sozinha logo depois de abrir (updateCaptcha() no ready, por AJAX) e
    // depois de cada pesquisa. A imagem mostrada aqui segue a do iframe: so aparece depois que a
    // troca inicial acontece (ou o prazo passa), e se atualiza a cada troca.
    function acompanharCodigo(doc, partes, geracao) {
        var img = partes.img;
        var mostrou = false;
        var mostrar = function () {
            if (geracao !== estado.geracao) return;
            var atual = doc.getElementById(img.id) || img;
            if (atual !== img) img = atual;
            esperarImagem(img, function () {
                if (geracao !== estado.geracao) return;
                var bruto = img.getAttribute('src') || '';
                var src = /^data:/i.test(bruto) ? bruto : copiarImagem(img);
                var $img = $('#searchPub_captcha img.spro-captcha');
                if ($img.length) { $img.attr('src', src); }
                else {
                    $('#searchPub_captcha').html(
                        '<img class="spro-captcha" alt="C\u00F3digo de verifica\u00E7\u00E3o" src="' + esc(src) + '"> ' +
                        '<i class="fas fa-redo" role="button" tabindex="0" title="Outro c\u00F3digo" style="color: #969696; cursor: pointer; padding: 3px 8px;"></i>'
                    );
                    $('#searchPub_captcha .fa-redo').on('click keypress', function (ev) {
                        if (ev.type === 'keypress' && ev.which !== 13) return;
                        estado.mensagemPendente = '';
                        outroCodigo(doc);
                    });
                }
                $('#captchaPub').val('');
                if (!mostrou) {
                    mostrou = true;
                    avisarPendente();
                    $('#captchaPub').focus();
                }
            });
        };
        if (!img) { mostrar(); return; }
        var MO = (doc.defaultView && doc.defaultView.MutationObserver) || window.MutationObserver;
        var prazo = null;
        try {
            var obs = new MO(function () {
                if (geracao !== estado.geracao) { obs.disconnect(); return; }
                clearTimeout(prazo);
                // Espera assentar (a pagina pode trocar mais de uma vez em seguida).
                prazo = setTimeout(mostrar, 250);
            });
            obs.observe(img, { attributes: true, attributeFilter: ['src'] });
        } catch (e) { /* sem observador: mostra pelo prazo */ }
        // Sem troca em 2,5 s: a imagem da pagina ja e a valida.
        prazo = setTimeout(mostrar, 2500);
    }

    // Outro codigo pelo botao da propria pagina (sem recarregar); sem ele, recarrega.
    function outroCodigo(doc) {
        var botao = doc && (doc.querySelector('button[onclick*="infraGerarNovoCaptcha"]') ||
            (doc.getElementById('infraImgRecarregarCaptcha') && doc.getElementById('infraImgRecarregarCaptcha').closest('button')));
        if (botao && doc === docDoIframe()) { botao.click(); $('#captchaPub').val('').focus(); return; }
        getDadosIframeProcessoPublicoPro();
    }

    // Erro na pesquisa: o codigo ja foi usado, entao vem outro.
    function falhou(msg) {
        marcarOcupado(false);
        estado.aguardandoResultado = false;
        estado.mensagemPendente = msg + (estado.semCodigo ? '' : ' Digite o novo c\u00F3digo.');
        getDadosIframeProcessoPublicoPro();
    }

    // Mostra o erro guardado da pesquisa anterior, ou limpa o status.
    function avisarPendente() {
        var m = estado.mensagemPendente;
        estado.mensagemPendente = '';
        avisar(m || '', m ? 'erro' : undefined);
    }

    function mostrarCampoCodigo(sim) {
        $('label[for="captchaPub"]').closest('tr').toggle(!!sim);
        $('#captchaPub').toggle(!!sim);
        $('#searchPub_captcha').toggle(!!sim);
    }

    // ------------------------------------------------------------ pesquisar

    // A propria pagina pesquisa (clique de verdade no botao dela): o JavaScript dela roda,
    // inclusive quando o resultado chega depois, por AJAX ("Pesquisando...").
    window.loadListaProcessoPublicoPro = function () {
        if (estado.enviando) return;
        var processo = String($('#processoPub').val() || '').trim();
        var codigo = String($('#captchaPub').val() || '').trim();
        var partes = estado.partes;
        if (!processo || (!codigo && !estado.semCodigo)) {
            alertaBoxPro('Error', 'exclamation-triangle', estado.semCodigo ? 'Informe o n\u00FAmero do processo.' : 'Informe o n\u00FAmero do processo e o c\u00F3digo de verifica\u00E7\u00E3o.');
            return;
        }
        if (!partes) {
            avisar('A Pesquisa P\u00FAblica ainda n\u00E3o carregou.', 'erro', true);
            return;
        }
        $('.trListDocPublico').hide();
        marcarOcupado(true);
        avisar('Pesquisando\u2026');
        estado.mensagemCliente = '';
        estado.mensagemPendente = '';
        estado.navegou = false;
        estado.aguardandoResultado = true;
        estado.docEnviado = docDoIframe();
        partes.protocolo.value = processo;
        if (partes.captcha) partes.captcha.value = codigo;
        try {
            if (partes.enviar && typeof partes.enviar.click === 'function') partes.enviar.click();
            else HTMLFormElement.prototype.submit.call(partes.form);
        } catch (e) {
            falhou('N\u00E3o foi poss\u00EDvel pesquisar: ' + (e && e.message ? e.message : e));
            return;
        }
        aguardarResultado(estado.geracao, Date.now());
    };

    // Aviso de carregamento visivel (".ajax-loading" com "Pesquisando..." na Pesquisa Publica do SEI 5).
    function carregando(doc) {
        var win = doc.defaultView;
        var avisos = doc.querySelectorAll('.ajax-loading, [class*="loading"], #divInfraAvisoFundo');
        for (var i = 0; i < avisos.length; i++) if (visivel(avisos[i], win)) return true;
        return false;
    }

    function visivel(el, win) {
        for (var n = el; n && n.nodeType === 1 && n.tagName !== 'HTML'; n = n.parentElement) {
            if (n.style && (n.style.display === 'none' || n.style.visibility === 'hidden')) return false;
            var cs = win && win.getComputedStyle ? win.getComputedStyle(n) : null;
            if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return false;
        }
        return true;
    }

    function linkDoProcesso(doc) {
        // O link do PROCESSO primeiro: a lista tambem traz documentos (protocoloNormal).
        return doc.querySelector('a[href*="md_pesq_processo_exibir"]') ||
            doc.querySelector('a[href*="processo_exibir"]') ||
            doc.querySelector('a.protocoloNormal[href]');
    }

    // Espera o resultado aparecer: pagina nova (navegou) ou a mesma, preenchida por AJAX.
    function aguardarResultado(geracao, inicio) {
        var viuCarregando = false;
        var semMudancaDesde = 0;
        var empurrou = false;
        (function olhar() {
            if (geracao !== estado.geracao || !estado.aguardandoResultado) return;
            var agora = Date.now();
            var doc = docDoIframe();
            if (estado.mensagemCliente) {
                falhou(estado.mensagemCliente);
                return;
            }
            if (doc && doc.body) {
                // Pagina nova com o aviso vermelho do SEI (codigo errado etc.): erro na hora.
                var erroSei = doc !== estado.docEnviado ? avisoDeErro(doc) : '';
                if (erroSei) {
                    falhou(/desafio/i.test(erroSei) ? 'O c\u00F3digo de confirma\u00E7\u00E3o n\u00E3o conferiu (' + erroSei + ').' : erroSei);
                    return;
                }
                if (doc.querySelector('#tblDocumentos')) {
                    estado.aguardandoResultado = false;
                    mostrarDocumentos({ doc: doc, url: doc.location.href });
                    return;
                }
                var a = linkDoProcesso(doc);
                if (a) {
                    estado.aguardandoResultado = false;
                    abrirProcesso(absoluta(a.getAttribute('href'), doc.location.href));
                    return;
                }
                var pronto = doc.readyState === 'complete';
                var mesmaPagina = doc === estado.docEnviado;
                if (carregando(doc)) { viuCarregando = true; semMudancaDesde = 0; }
                else if (pronto && !semMudancaDesde) semMudancaDesde = agora;
                // Terminou sem resultado: pagina nova ja quieta, ou a mesma depois do "Pesquisando...".
                var quieta = semMudancaDesde && agora - semMudancaDesde > 1500;
                if (quieta && (!mesmaPagina || viuCarregando)) {
                    falhou(mensagemDaPagina(doc, '') || 'Nenhum processo p\u00FAblico encontrado com esse n\u00FAmero (ou c\u00F3digo incorreto).');
                    return;
                }
                // O botao nao fez nada: envia o formulario direto, uma vez.
                if (mesmaPagina && !estado.navegou && !viuCarregando && !empurrou && agora - inicio > 2000) {
                    empurrou = true;
                    try { HTMLFormElement.prototype.submit.call(estado.partes.form); } catch (e) { /* segue */ }
                }
            }
            if (agora - inicio > ESPERA_MS + 10000) {
                estado.aguardandoResultado = false;
                marcarOcupado(false);
                try { console.warn('[SEIPro/processo-publico] sem resultado; pagina da pesquisa:', doc && doc.body ? doc.body.innerHTML.slice(0, 4000) : null); } catch (e) { /* segue */ }
                avisar('A Pesquisa P\u00FAblica n\u00E3o devolveu resultado. Tente de novo ou abra a pesquisa.', 'erro', true);
                return;
            }
            setTimeout(olhar, 300);
        })();
    }

    // Pagina do processo: lida direto; se a lista vier por JavaScript, abre no iframe e espera.
    function abrirProcesso(url) {
        avisar('Lendo os documentos do processo\u2026');
        baixar(url).then(function (p) {
            if (p.doc.querySelector('#tblDocumentos')) { mostrarDocumentos(p); return; }
            var geracao = estado.geracao;
            var iframe = document.getElementById(ID_IFRAME);
            estado.aguardandoResultado = true;
            estado.docEnviado = docDoIframe();
            iframe.src = url;
            aguardarResultado(geracao, Date.now());
        }).catch(function (e) {
            marcarOcupado(false);
            avisar('N\u00E3o foi poss\u00EDvel abrir o processo: ' + (e && e.message ? e.message : e), 'erro');
        });
    }

    // ------------------------------------------------------------ documentos do processo

    function colunas(tabela) {
        var nomes = [];
        var cab = tabela.querySelector('tr th') ? tabela.querySelector('tr th').parentNode : null;
        if (cab) nomes = Array.prototype.map.call(cab.children, function (c) { return texto(c).toLowerCase(); });
        var achar = function (re, fora) {
            for (var i = 0; i < nomes.length; i++) if (re.test(nomes[i]) && !(fora && fora.test(nomes[i]))) return i;
            return -1;
        };
        return { numero: achar(/documento|protocolo|n[u\u00FA]mero/, /tipo/), tipo: achar(/tipo/) };
    }

    function linkDaLinha(tr, base) {
        var a = tr.querySelector('a.ancoraPadraoAzul') || tr.querySelector('a[onclick*="documento"]') || tr.querySelector('a[href*="documento"]');
        if (!a) return { a: null, url: '' };
        var onclick = a.getAttribute('onclick') || '';
        var m = /['"]([^'"]*documento[^'"]*)['"]/i.exec(onclick) || /['"]([^'"]+\.php[^'"]*)['"]/i.exec(onclick);
        var href = a.getAttribute('href') || '';
        var bruto = m ? m[1] : (/^(#|javascript:)/i.test(href) ? '' : href);
        return { a: a, url: bruto ? absoluta(bruto.replace(/&amp;/g, '&'), base) : '' };
    }

    function lerDocumentos(p) {
        var tabela = p.doc.querySelector('#tblDocumentos');
        var lista = [];
        if (!tabela) return lista;
        var col = colunas(tabela);
        Array.prototype.forEach.call(tabela.querySelectorAll('tr'), function (tr) {
            var tds = tr.querySelectorAll('td');
            if (!tds.length) return;
            var l = linkDaLinha(tr, p.url);
            var iNum = col.numero;
            if (l.a) {
                for (var i = 0; i < tds.length; i++) if (tds[i].contains(l.a)) { iNum = i; break; }
            }
            if (iNum < 0) iNum = Math.min(1, tds.length - 1);
            var iTipo = col.tipo >= 0 ? col.tipo : iNum + 1;
            var numero = texto(tds[iNum]);
            var tipo = texto(tds[iTipo]);
            if (!numero && !tipo) return;
            lista.push({ numero: numero, tipo: tipo, url: l.url });
        });
        return lista;
    }

    function nomeDoProcesso(p) {
        var linhas = p.doc.querySelectorAll('#tblCabecalho tr');
        for (var i = 0; i < linhas.length; i++) {
            var tds = linhas[i].querySelectorAll('td');
            if (tds.length > 1 && /processo/i.test(texto(tds[0]))) return texto(tds[1]);
        }
        for (var j = 0; j < linhas.length; j++) {
            var c = linhas[j].querySelectorAll('td');
            if (c.length > 1) return texto(c[1]);
        }
        return String($('#processoPub').val() || '').trim();
    }

    function mostrarDocumentos(p) {
        marcarOcupado(false);
        var docs = lerDocumentos(p);
        var processo = nomeDoProcesso(p);
        var citacao = typeof getCitacaoDoc === 'function' ? getCitacaoDoc() : 'SEI n\u00BA ';
        var $sel = $('#selectDocPublico').empty();
        docs.forEach(function (d) {
            var rotulo = d.tipo + '\u00A0(' + citacao + d.numero + ')';
            $('<option>')
                .attr('data-url', d.url)
                .attr('data-documento', rotulo)
                .text(d.tipo + ' (' + citacao + d.numero + ')' + (d.url ? '' : ' [DOCUMENTO RESTRITO]'))
                .appendTo($sel);
        });
        $('<option>')
            .attr('data-url', p.url)
            .attr('data-documento', processo)
            .text(processo + ' (processo inteiro)')
            .appendTo($sel);
        var publicos = docs.filter(function (d) { return d.url; }).length;
        avisar(docs.length
            ? publicos + ' de ' + docs.length + ' documento(s) com link p\u00FAblico.'
            : 'O processo n\u00E3o tem documentos na lista p\u00FAblica. D\u00E1 para inserir o link do processo.', 'ok');
        $('.trListDocPublico').show();
        $sel.chosen('destroy').chosen({
            placeholder_text_single: ' ',
            no_results_text: 'Nenhum resultado encontrado',
            normalize_search_text: function (t) {
                return typeof removeAcentos === 'function' ? removeAcentos(t.toLowerCase()) : t.toLowerCase();
            }
        }).trigger('chosen:updated').trigger('chosen:activate');
        setTimeout(function () { $sel.trigger('chosen:open'); }, 300);
    }

    // Mantido para quem chamava pelo nome antigo.
    window.getListaProcessoPublicoPro = function () { /* substituido por aguardarResultado */ };
    window.getLinksProcessoPublicoPro = function (href) {
        marcarOcupado(true);
        abrirProcesso(href);
    };

    // ------------------------------------------------------------ janela

    function inserir() {
        var $opt = $('#selectDocPublico option:selected');
        if (!$opt.length) {
            alertaBoxPro('Error', 'exclamation-triangle', 'Pesquise o processo e escolha um documento.');
            return;
        }
        var url = $opt.attr('data-url') || '';
        var nome = $opt.attr('data-documento') || '';
        var html = url
            ? '<a class="ancoraSei" href="' + esc(url) + '" target="_blank">' + esc(nome) + '</a>'
            : esc(nome);
        var ed = (estado.botao && SeiProEditorAdapter.getInstance(estado.botao)) || SeiProEditorAdapter.getInstance();
        if (!ed) {
            alertaBoxPro('Error', 'exclamation-triangle', 'O editor n\u00E3o foi encontrado. Clique no texto e tente de novo.');
            return;
        }
        SeiProEditorAdapter.withEdit(ed, function () { SeiProEditorAdapter.insertHtml(ed, html); });
        fechar();
    }

    function fechar() {
        estado.geracao++;
        estado.partes = null;
        marcarOcupado(false);
        $('#' + ID_IFRAME).remove();
        resetDialogBoxPro('dialogBoxPro');
    }

    window.openDialogProcessoPublicoPro = function (this_) {
        setParamEditor(this_);
        estado.botao = this_ || null;
        const htmlBox = sanitizeHTML(`
            <div class="dialogBoxDiv" style="font-size: 11pt;line-height: 12pt;color: #616161;">
                <table style="font-size: 10pt;width: 100%;" class="seiProForm">
                    <tr>
                        <td style="vertical-align: bottom; text-align: left;" class="label">
                            <label for="processoPub"><i class="iconPopup iconSwitch fas fa-folder-open cinzaColor"></i>Processo:</label>
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <input type="text" id="processoPub">
                        </td>
                    </tr>
                    <tr>
                        <td style="vertical-align: bottom; text-align: left;" class="label">
                            <label for="captchaPub"><i class="iconPopup iconSwitch fas fa-hashtag cinzaColor"></i>Digite o c\u00F3digo:</label>
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <input type="text" id="captchaPub" style="width: 70%;" autocomplete="off">
                            <a id="searchPub_search" class="newLink newLink_active" style="user-select: none;padding-right: 20px;margin: 0 5px;" href="#">
                                <i class="fas fa-search cinzaColor"></i>
                                <span class="txt_cinza" style="font-size: 80%;vertical-align: text-top;">Pesquisar</span>
                            </a>
                            <i id="searchPub_load" class="fas fa-sync-alt fa-spin" style="margin-left: 10px; display:none"></i>
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <div id="searchPub_captcha" style="margin-bottom: 8px;"></div>
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <div id="searchPub_result" role="status" style="display:none; margin-top: 4px; font-size: 9pt; line-height: 12pt;"></div>
                        </td>
                    </tr>
                    <tr class="trListDocPublico" style="display:none;">
                        <td style="vertical-align: bottom; text-align: left;" class="label">
                            <label for="selectDocPublico"><i class="iconPopup iconSwitch fas fa-file cinzaColor"></i>Documentos:</label>
                        </td>
                    </tr>
                    <tr class="trListDocPublico" style="display:none;">
                        <td class="label">
                            <select id="selectDocPublico" style="width: 100%;"></select>
                        </td>
                    </tr>
                </table>
            </div>
        `);

        resetDialogBoxPro('dialogBoxPro');
        dialogBoxPro = $('#dialogBoxPro')
            .html(htmlBox)
            .dialog({
                title: 'Adicionar Link de Documento P\u00FAblico',
                width: 600,
                height: 450,
                open: function () {
                    initChosenReplace('box_multiple', this, true);

                    $(document).off('click', '#searchPub_search').on('click', '#searchPub_search', function (event) {
                        event.preventDefault();
                        loadListaProcessoPublicoPro();
                    });
                    $(document).off('keypress', '#captchaPub, #processoPub').on('keypress', '#captchaPub, #processoPub', function (event) {
                        if (event.which == 13) {
                            event.preventDefault();
                            loadListaProcessoPublicoPro();
                        }
                    });

                    var processo = (typeof dadosProcessoPro !== 'undefined' && dadosProcessoPro && dadosProcessoPro.listAndamento &&
                        typeof dadosProcessoPro.listAndamento.processo !== 'undefined') ? dadosProcessoPro.listAndamento.processo : '';
                    $('#processoPub').val(processo);
                    getDadosIframeProcessoPublicoPro();
                },
                close: function () {
                    estado.geracao++;
                    estado.partes = null;
                    marcarOcupado(false);
                    $('#' + ID_IFRAME).remove();
                },
                buttons: [{
                    text: 'Inserir',
                    class: 'confirm ui-state-active',
                    click: function () { inserir(); }
                }]
            });
    };

    // Leitura das paginas, exposta para verificacao (sem efeito na tela).
    window.SeiProProcessoPublicoLeitura = {
        partesDaPesquisa: partesDaPesquisa,
        lerDocumentos: lerDocumentos,
        nomeDoProcesso: nomeDoProcesso,
        mensagemDaPagina: mensagemDaPagina,
        raizSei: raizSei
    };

    if (window.SeiProEditorAdapter && SeiProEditorAdapter.registerFeature) {
        SeiProEditorAdapter.registerFeature({ id: 'processo-publico' });
    }
})();
